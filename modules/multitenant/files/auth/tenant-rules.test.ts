// Tests for tenant resolution's decision core. This file is NOT in the descriptor's
// `files` list, so `add multitenant` never copies it into a user's project — it exists
// for this repo only.
//
// It runs on `node:test`, not on the CLI's vitest instance, for the reason
// `modules/auth/files/src/server.test.ts` spells out: the payload's own tsconfig resolves
// only inside a scaffolded project. Run it with `pnpm test:modules`. The import needs the
// explicit `.ts` extension because Node's type stripping resolves the real file.
//
// `./tenant-rules.ts` carries two `import type` lines (`@repo/db/tenant` and
// `./authorize`) and no runtime import at all. Type-only imports are erased before the
// file runs, which is what lets this test load it with nothing installed. Add a runtime
// import there and this file stops loading — that is the guard, not an accident.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORBIDDEN,
  NO_ACTIVE_ORGANIZATION,
  ORGANIZATION_HEADER,
  UNKNOWN_ORGANIZATION,
  headerDenial,
  noOrganizationDenial,
  pickResolver,
  resolveStatements,
  superadminTenant,
  unknownOrganizationDenial,
} from "./tenant-rules.ts";
import type { ResolvedStatements, TenantId } from "./tenant-rules.ts";

// The three static roles from `access.ts`, cut down to the resources these cases need.
// The real map is built by better-auth's `createAccessControl`, which this file cannot
// import; `./tenant.ts` converts it to exactly this shape before calling
// `resolveStatements`.
const BASE_ROLES: Record<string, ResolvedStatements> = {
  admin: { ac: ["create", "read"], project: ["create", "read", "delete"] },
  member: { ac: ["read"], project: ["read"] },
};

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe("the fixed messages", () => {
  it("keeps the two strings apps/admin matches on", () => {
    // The SPA tells "you have no organization yet" apart from "you may not do this" by
    // comparing `error.message` to these. Change one here and change the SPA with it.
    assert.equal(NO_ACTIVE_ORGANIZATION, "no active organization");
    assert.equal(FORBIDDEN, "forbidden");
    assert.equal(ORGANIZATION_HEADER, "x-organization-id");
  });

  it("refuses a missing organization with 403, not 401", () => {
    // 401 would bounce a signed-in caller through a login they have already done.
    assert.deepEqual(noOrganizationDenial(), {
      status: 403,
      message: NO_ACTIVE_ORGANIZATION,
    });
  });

  it("refuses a forbidden header with 403 and nothing else", () => {
    assert.deepEqual(headerDenial(), { status: 403, message: FORBIDDEN });
  });

  it("answers 404 for a header naming no organization", () => {
    // A superadmin may send the header, so this is not 403. The id is simply not a
    // tenant, and answering here keeps it out of `asTenantId`.
    assert.equal(UNKNOWN_ORGANIZATION, "unknown organization");
    assert.deepEqual(unknownOrganizationDenial(), {
      status: 404,
      message: UNKNOWN_ORGANIZATION,
    });
  });
});

describe("pickResolver", () => {
  const bearer = {
    name: "apiKeyTenant",
    claims: (h: { get(name: string): string | null }) =>
      h.get("authorization")?.startsWith("Bearer ") ?? false,
  };
  const never = { name: "never", claims: () => false };

  it("returns null when no resolver claims the request", () => {
    // The session path runs, which is what an ordinary cookie request has to do.
    assert.equal(pickResolver([bearer, never], headers({})), null);
  });

  it("returns null when the table is empty", () => {
    // The default: `multitenant` ships `resolvers: []` and a credential module fills it.
    assert.equal(
      pickResolver([], headers({ authorization: "Bearer k" })),
      null
    );
  });

  it("returns the resolver that claims the credential", () => {
    const picked = pickResolver(
      [never, bearer],
      headers({ authorization: "Bearer sk_live" })
    );
    assert.equal(picked, bearer);
  });

  it("takes the first claimer, so array order is precedence", () => {
    const first = { name: "first", claims: () => true };
    assert.equal(pickResolver([first, bearer], headers({})), first);
  });
});

describe("resolveStatements", () => {
  it("gives a base role its static statements when nothing is stored", () => {
    assert.deepEqual(resolveStatements("member", BASE_ROLES, []), {
      ac: ["read"],
      project: ["read"],
    });
  });

  it("gives a custom role the stored row alone", () => {
    const stored = [{ role: "viewer", permission: '{"project":["read"]}' }];
    assert.deepEqual(resolveStatements("viewer", BASE_ROLES, stored), {
      project: ["read"],
    });
  });

  it("merges a stored row over the static role of the same name", () => {
    // roleLockGuard() refuses to write this row. A row that got in before the guard
    // shipped, or straight through SQL, still has to resolve the way better-auth's own
    // hasPermission resolves it, or the gate and the plugin disagree.
    const stored = [
      {
        role: "admin",
        permission: '{"project":["update"],"apiKey":["create"]}',
      },
    ];
    assert.deepEqual(resolveStatements("admin", BASE_ROLES, stored), {
      ac: ["create", "read"],
      apiKey: ["create"],
      project: ["create", "read", "delete", "update"],
    });
  });

  it("does not duplicate an action the static role already holds", () => {
    const stored = [{ role: "member", permission: '{"project":["read"]}' }];
    assert.deepEqual(resolveStatements("member", BASE_ROLES, stored), {
      ac: ["read"],
      project: ["read"],
    });
  });

  it("resolves an unknown role to nothing", () => {
    // A deleted role fails closed for whoever still holds it. It does not fall back to
    // `member`, which would silently re-grant permissions an owner meant to remove.
    assert.deepEqual(resolveStatements("deleted", BASE_ROLES, []), {});
  });

  it("ignores a stored row whose permission is not valid JSON", () => {
    const stored = [{ role: "viewer", permission: "not json" }];
    assert.deepEqual(resolveStatements("viewer", BASE_ROLES, stored), {});
  });

  it("ignores a stored row whose permission is not an object", () => {
    const stored = [{ role: "viewer", permission: '["project"]' }];
    assert.deepEqual(resolveStatements("viewer", BASE_ROLES, stored), {});
  });

  it("drops a resource whose actions are not an array of strings", () => {
    const stored = [
      { role: "viewer", permission: '{"project":["read",7],"apiKey":"all"}' },
    ];
    assert.deepEqual(resolveStatements("viewer", BASE_ROLES, stored), {
      project: ["read"],
    });
  });

  it("does not mutate the base role it merges into", () => {
    const stored = [{ role: "member", permission: '{"project":["delete"]}' }];
    resolveStatements("member", BASE_ROLES, stored);
    assert.deepEqual(BASE_ROLES.member?.project, ["read"]);
  });
});

describe("superadminTenant", () => {
  it("carries no statements, because can() answers on the kind", () => {
    const organizationId = "org_b" as TenantId;
    assert.deepEqual(superadminTenant("user_1", organizationId), {
      organizationId: "org_b",
      principal: { kind: "superadmin", userId: "user_1" },
    });
  });
});
