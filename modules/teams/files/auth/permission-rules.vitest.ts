// Tests for permission checking's decision core. The file ships as
// `permission-rules.test.ts` beside it when testing is on, and `pnpm test:modules` runs
// it in place on Vitest in the saasaloy repo.
//
// `./permission-rules.ts` carries one `import type` (`./authorize`) and no runtime import at
// all, which is what lets this test load it with nothing installed. Add a runtime import
// there and this file stops loading — that is the guard.

import { describe, expect, it } from "vitest";
import {
  BASE_ROLE_LOCKED,
  allows,
  can,
  emptyDemandDenial,
  findLockedRole,
  permissionDenial,
  roleLockDenial,
} from "./permission-rules";
import type { PrincipalLike, ResolvedStatements } from "./permission-rules";

// The three base names from `access.ts`, restated. The real tuple is `BASE_ROLES` there,
// which this file cannot import: it pulls `better-auth/plugins/access`.
const BASE_ROLES = ["owner", "admin", "member"];

function member(statements: ResolvedStatements): PrincipalLike {
  return { kind: "member", statements };
}

describe("can, for a member", () => {
  const viewer = member({ ac: ["read"], project: ["read"] });

  it("allows a permission the role holds", () => {
    expect(can(viewer, { project: ["read"] })).toStrictEqual({
      denial: null,
      allowed: true,
    });
  });

  it("refuses an action the role does not hold, naming resource:action", () => {
    // The exact 403 body `apps/admin` reads and the QA script greps for.
    expect(can(viewer, { project: ["delete"] })).toStrictEqual({
      denial: { status: 403, message: "permission required: project:delete" },
      allowed: false,
    });
  });

  it("demands every listed action, not any of them", () => {
    // AND, never OR. A route asking for read and delete gets refused on delete even
    // though read passes, and the refusal names the pair that failed.
    const decision = can(viewer, { project: ["read", "delete"] });
    expect(decision.allowed).toBeFalsy();
    expect(decision.denial?.message).toBe(
      "permission required: project:delete"
    );
  });

  it("refuses a resource the role has never heard of", () => {
    // An unknown resource holds no actions, so it refuses exactly like an empty one.
    // `requirePermission` cannot reach this arm — `Permissions` from `access.ts` types the
    // demand — but a stored role parsed at runtime can, and so can `apps/admin`.
    expect(allows(viewer, { billing: ["read"] })).toBeFalsy();
  });

  it("refuses every action of a resource resolved from an empty stored role", () => {
    // A dangling role name resolves to `{}` in `resolveStatements`, and that member is
    // refused everything rather than falling back to `member`.
    expect(allows(member({}), { project: ["read"] })).toBeFalsy();
  });

  it("allows a custom role built from statements the base roles never gave it", () => {
    // A runtime-defined role is just a statement map. Nothing here knows it is custom.
    const auditor = member({ apiKey: ["read"], project: ["read", "update"] });
    expect(allows(auditor, { project: ["update"] })).toBeTruthy();
    expect(allows(auditor, { apiKey: ["create"] })).toBeFalsy();
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
    expect(allows(key, { project: ["read"] })).toBeTruthy();
    expect(allows(key, { project: ["delete"] })).toBeFalsy();
  });
});

describe("can, for a superadmin", () => {
  const superadmin: PrincipalLike = { kind: "superadmin" };

  it("allows anything without reading statements", () => {
    // No `statements` field exists on this kind, so an implementation that reached for
    // one would throw here rather than quietly answering false.
    expect(allows(superadmin, { project: ["delete"] })).toBeTruthy();
    expect(allows(superadmin, { billing: ["refund"] })).toBeTruthy();
  });

  it("allows an empty demand, unlike every other kind", () => {
    // The superadmin arm returns before the demand is inspected at all.
    expect(allows(superadmin, {})).toBeTruthy();
  });
});

describe("an empty demand fails closed", () => {
  it("refuses a member asking for nothing", () => {
    // `{}` is a bug at the call site — a mistyped resource key, or a demand built from
    // an empty loop. Reading it as "no permission needed" would open the route.
    expect(can(member({ project: ["read"] }), {})).toStrictEqual({
      denial: emptyDemandDenial(),
      allowed: false,
    });
  });

  it("refuses a resource listed with no actions", () => {
    expect(allows(member({ project: ["read"] }), { project: [] })).toBeFalsy();
  });

  it("skips an undefined value rather than throwing on it", () => {
    // `Permissions` in `access.ts` is a `Partial`, so an explicitly undefined value is
    // a shape the compiler allows. It counts as nothing demanded, so it fails closed.
    expect(
      allows(member({ project: ["read"] }), { project: undefined })
    ).toBeFalsy();
  });
});

describe("the fixed messages", () => {
  it("keeps the resource:action format", () => {
    expect(permissionDenial("apiKey", "create")).toStrictEqual({
      status: 403,
      message: "permission required: apiKey:create",
    });
  });

  it("refuses with 403, never 401", () => {
    // The caller is authenticated. A 401 would bounce them through a login they have
    // already completed and still would not grant the permission.
    expect(emptyDemandDenial().status).toBe(403);
    expect(roleLockDenial("admin").status).toBe(403);
  });

  it("keeps the locked-role message the /roles screen matches on", () => {
    expect(BASE_ROLE_LOCKED).toBe("base role is locked");
    expect(roleLockDenial("admin").message).toBe("base role is locked: admin");
  });
});

describe(findLockedRole, () => {
  it("finds a base name in any of the fields the three endpoints use", () => {
    // create-role carries `role`, update-role carries `roleName` and a nested
    // `data.roleName`, delete-role carries `roleName`. The guard feeds all of them.
    expect(findLockedRole(["viewer", "admin"], BASE_ROLES)).toBe("admin");
    expect(findLockedRole([undefined, "owner"], BASE_ROLES)).toBe("owner");
    expect(findLockedRole(["member"], BASE_ROLES)).toBe("member");
  });

  it("returns null when every candidate is a custom name", () => {
    expect(findLockedRole(["viewer", "auditor"], BASE_ROLES)).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(findLockedRole([], BASE_ROLES)).toBeNull();
  });

  it("ignores a non-string candidate instead of coercing it", () => {
    // A hostile body can carry anything. Skipping it hands the request to the plugin's
    // own validation rather than stringifying it into a false match.
    expect(
      findLockedRole([42, null, { role: "admin" }], BASE_ROLES)
    ).toBeNull();
  });

  it("compares exactly, so a near miss is not locked", () => {
    // `===` per entry, like `hasRole`. A fold or a prefix test would lock a customer out
    // of naming a role `administrator`.
    expect(
      findLockedRole(["Admin", "admins", "administrator"], BASE_ROLES)
    ).toBeNull();
  });
});
