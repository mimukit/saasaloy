// Tests for permission checking's decision core. This file is NOT in the descriptor's
// `files` list, so `add rbac` never copies it into a user's project — it exists for this
// repo only.
//
// It runs on `node:test`, not on the CLI's vitest instance, for the reason
// `modules/auth/files/src/server.test.ts` spells out: the payload's own tsconfig resolves
// only inside a scaffolded project. Run it with `pnpm test:modules`. The import needs the
// explicit `.ts` extension because Node's type stripping resolves the real file.
//
// `./rbac-rules.ts` carries one `import type` (`./authorize`) and no runtime import at
// all, which is what lets this test load it with nothing installed. Add a runtime import
// there and this file stops loading — that is the guard.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_ROLE_LOCKED,
  allows,
  can,
  emptyDemandDenial,
  findLockedRole,
  permissionDenial,
  roleLockDenial,
} from "./rbac-rules.ts";
import type { PrincipalLike, ResolvedStatements } from "./rbac-rules.ts";

// The three base names from `access.ts`, restated. The real tuple is `BASE_ROLES` there,
// which this file cannot import: it pulls `better-auth/plugins/access`.
const BASE_ROLES = ["owner", "admin", "member"];

function member(statements: ResolvedStatements): PrincipalLike {
  return { kind: "member", statements };
}

describe("can, for a member", () => {
  const viewer = member({ ac: ["read"], project: ["read"] });

  it("allows a permission the role holds", () => {
    assert.deepEqual(can(viewer, { project: ["read"] }), {
      denial: null,
      allowed: true,
    });
  });

  it("refuses an action the role does not hold, naming resource:action", () => {
    // The exact 403 body `apps/admin` reads and the QA script greps for.
    assert.deepEqual(can(viewer, { project: ["delete"] }), {
      denial: { status: 403, message: "permission required: project:delete" },
      allowed: false,
    });
  });

  it("demands every listed action, not any of them", () => {
    // AND, never OR. A route asking for read and delete gets refused on delete even
    // though read passes, and the refusal names the pair that failed.
    const decision = can(viewer, { project: ["read", "delete"] });
    assert.equal(decision.allowed, false);
    assert.equal(
      decision.denial?.message,
      "permission required: project:delete"
    );
  });

  it("refuses a resource the role has never heard of", () => {
    // An unknown resource holds no actions, so it refuses exactly like an empty one.
    // `requireCan` cannot reach this arm — `Permissions` from `access.ts` types the
    // demand — but a stored role parsed at runtime can, and so can `apps/admin`.
    assert.equal(allows(viewer, { billing: ["read"] }), false);
  });

  it("refuses every action of a resource resolved from an empty stored role", () => {
    // A dangling role name resolves to `{}` in `resolveStatements`, and that member is
    // refused everything rather than falling back to `member`.
    assert.equal(allows(member({}), { project: ["read"] }), false);
  });

  it("allows a custom role built from statements the base roles never gave it", () => {
    // A runtime-defined role is just a statement map. Nothing here knows it is custom.
    const auditor = member({ apiKey: ["read"], project: ["read", "update"] });
    assert.equal(allows(auditor, { project: ["update"] }), true);
    assert.equal(allows(auditor, { apiKey: ["create"] }), false);
  });
});

describe("can, for an api key", () => {
  const key: PrincipalLike = {
    kind: "apiKey",
    statements: { project: ["read"] },
  };

  it("runs the same rule as a member", () => {
    // The whole point of the resolver table: a bearer credential resolves the same
    // `Tenant`, so there is no second authorization path to keep in step.
    assert.equal(allows(key, { project: ["read"] }), true);
    assert.equal(allows(key, { project: ["delete"] }), false);
  });
});

describe("can, for a superadmin", () => {
  const superadmin: PrincipalLike = { kind: "superadmin" };

  it("allows anything without reading statements", () => {
    // No `statements` field exists on this kind, so an implementation that reached for
    // one would throw here rather than quietly answering false.
    assert.equal(allows(superadmin, { project: ["delete"] }), true);
    assert.equal(allows(superadmin, { billing: ["refund"] }), true);
  });

  it("allows an empty demand, unlike every other kind", () => {
    // The superadmin arm returns before the demand is inspected at all.
    assert.equal(allows(superadmin, {}), true);
  });
});

describe("an empty demand fails closed", () => {
  it("refuses a member asking for nothing", () => {
    // `{}` is a bug at the call site — a mistyped resource key, or a demand built from
    // an empty loop. Reading it as "no permission needed" would open the route.
    assert.deepEqual(can(member({ project: ["read"] }), {}), {
      denial: emptyDemandDenial(),
      allowed: false,
    });
  });

  it("refuses a resource listed with no actions", () => {
    assert.equal(allows(member({ project: ["read"] }), { project: [] }), false);
  });

  it("skips an undefined value rather than throwing on it", () => {
    // `Permissions` in `access.ts` is a `Partial`, so an explicitly undefined value is
    // a shape the compiler allows. It counts as nothing demanded, so it fails closed.
    assert.equal(
      allows(member({ project: ["read"] }), { project: undefined }),
      false
    );
  });
});

describe("the fixed messages", () => {
  it("keeps the resource:action format", () => {
    assert.deepEqual(permissionDenial("apiKey", "create"), {
      status: 403,
      message: "permission required: apiKey:create",
    });
  });

  it("refuses with 403, never 401", () => {
    // The caller is authenticated. A 401 would bounce them through a login they have
    // already completed and still would not grant the permission.
    assert.equal(emptyDemandDenial().status, 403);
    assert.equal(roleLockDenial("admin").status, 403);
  });

  it("keeps the locked-role message the /roles screen matches on", () => {
    assert.equal(BASE_ROLE_LOCKED, "base role is locked");
    assert.equal(roleLockDenial("admin").message, "base role is locked: admin");
  });
});

describe("findLockedRole", () => {
  it("finds a base name in any of the fields the three endpoints use", () => {
    // create-role carries `role`, update-role carries `roleName` and a nested
    // `data.roleName`, delete-role carries `roleName`. The guard feeds all of them.
    assert.equal(findLockedRole(["viewer", "admin"], BASE_ROLES), "admin");
    assert.equal(findLockedRole([undefined, "owner"], BASE_ROLES), "owner");
    assert.equal(findLockedRole(["member"], BASE_ROLES), "member");
  });

  it("returns null when every candidate is a custom name", () => {
    assert.equal(findLockedRole(["viewer", "auditor"], BASE_ROLES), null);
  });

  it("returns null for an empty candidate list", () => {
    assert.equal(findLockedRole([], BASE_ROLES), null);
  });

  it("ignores a non-string candidate instead of coercing it", () => {
    // A hostile body can carry anything. Skipping it hands the request to the plugin's
    // own validation rather than stringifying it into a false match.
    assert.equal(
      findLockedRole([42, null, { role: "admin" }], BASE_ROLES),
      null
    );
  });

  it("compares exactly, so a near miss is not locked", () => {
    // `===` per entry, like `hasRole`. A fold or a prefix test would lock a customer out
    // of naming a role `administrator`.
    assert.equal(
      findLockedRole(["Admin", "admins", "administrator"], BASE_ROLES),
      null
    );
  });
});
