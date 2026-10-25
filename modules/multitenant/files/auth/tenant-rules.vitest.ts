// Tests for tenant resolution's decision core. It ships as `tenant-rules.test.ts` beside
// `tenant-rules.ts` when testing is on, and `pnpm test:modules` runs it in place in the
// saasaloy repo.
//
// `./tenant-rules.ts` carries two `import type` lines (`@repo/db/tenant` and
// `./authorize`) and no runtime import at all. Type-only imports are erased before the
// file runs, which is what lets this test load it with nothing installed. Add a runtime
// import there and this file stops loading — that is the guard, not an accident.

import { describe, expect, it } from "vitest";
import {
  FORBIDDEN,
  NO_ACTIVE_ORGANIZATION,
  ORGANIZATION_HEADER,
  UNKNOWN_ORGANIZATION,
  headerDenial,
  mayCrossOrganizations,
  noOrganizationDenial,
  pickResolver,
  resolveStatements,
  superadminTenant,
  unknownOrganizationDenial,
} from "./tenant-rules";
import type { ResolvedStatements, TenantId } from "./tenant-rules";
// The decision core `auth` ships, read across the module boundary only to check that the
// two strings `mayCrossOrganizations` writes out still match it. It has no imports, so it
// loads here the way this file's own subject does.
import { ADMIN_AUDIENCE, CLIENT_AUDIENCE, SUPERADMIN_ROLE } from "./authorize";

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
    expect(NO_ACTIVE_ORGANIZATION).toBe("no active organization");
    expect(FORBIDDEN).toBe("forbidden");
    expect(ORGANIZATION_HEADER).toBe("x-organization-id");
  });

  it("refuses a missing organization with 403, not 401", () => {
    // 401 would bounce a signed-in caller through a login they have already done.
    expect(noOrganizationDenial()).toStrictEqual({
      status: 403,
      message: NO_ACTIVE_ORGANIZATION,
    });
  });

  it("refuses a forbidden header with 403 and nothing else", () => {
    expect(headerDenial()).toStrictEqual({ status: 403, message: FORBIDDEN });
  });

  it("answers 404 for a header naming no organization", () => {
    // A superadmin may send the header, so this is not 403. The id is simply not a
    // tenant, and answering here keeps it out of `asTenantId`.
    expect(UNKNOWN_ORGANIZATION).toBe("unknown organization");
    expect(unknownOrganizationDenial()).toStrictEqual({
      status: 404,
      message: UNKNOWN_ORGANIZATION,
    });
  });
});

describe(pickResolver, () => {
  const bearer = {
    name: "apiKeyTenant",
    claims: (h: { get(name: string): string | null }) =>
      h.get("authorization")?.startsWith("Bearer ") ?? false,
  };
  const never = { name: "never", claims: () => false };

  it("returns null when no resolver claims the request", () => {
    // The session path runs, which is what an ordinary cookie request has to do.
    expect(pickResolver([bearer, never], headers({}))).toBeNull();
  });

  it("returns null when the table is empty", () => {
    // The default: `multitenant` ships `resolvers: []` and a credential module fills it.
    expect(pickResolver([], headers({ authorization: "Bearer k" }))).toBeNull();
  });

  it("returns the resolver that claims the credential", () => {
    const picked = pickResolver(
      [never, bearer],
      headers({ authorization: "Bearer sk_live" })
    );
    expect(picked).toBe(bearer);
  });

  it("takes the first claimer, so array order is precedence", () => {
    const first = { name: "first", claims: () => true };
    expect(pickResolver([first, bearer], headers({}))).toBe(first);
  });
});

describe(resolveStatements, () => {
  it("gives a base role its static statements when nothing is stored", () => {
    expect(resolveStatements("member", BASE_ROLES, [])).toStrictEqual({
      ac: ["read"],
      project: ["read"],
    });
  });

  it("gives a custom role the stored row alone", () => {
    const stored = [{ role: "viewer", permission: '{"project":["read"]}' }];
    expect(resolveStatements("viewer", BASE_ROLES, stored)).toStrictEqual({
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
    expect(resolveStatements("admin", BASE_ROLES, stored)).toStrictEqual({
      ac: ["create", "read"],
      apiKey: ["create"],
      project: ["create", "read", "delete", "update"],
    });
  });

  it("does not duplicate an action the static role already holds", () => {
    const stored = [{ role: "member", permission: '{"project":["read"]}' }];
    expect(resolveStatements("member", BASE_ROLES, stored)).toStrictEqual({
      ac: ["read"],
      project: ["read"],
    });
  });

  it("resolves an unknown role to nothing", () => {
    // A deleted role fails closed for whoever still holds it. It does not fall back to
    // `member`, which would silently re-grant permissions an owner meant to remove.
    expect(resolveStatements("deleted", BASE_ROLES, [])).toStrictEqual({});
  });

  it("ignores a stored row whose permission is not valid JSON", () => {
    const stored = [{ role: "viewer", permission: "not json" }];
    expect(resolveStatements("viewer", BASE_ROLES, stored)).toStrictEqual({});
  });

  it("ignores a stored row whose permission is not an object", () => {
    const stored = [{ role: "viewer", permission: '["project"]' }];
    expect(resolveStatements("viewer", BASE_ROLES, stored)).toStrictEqual({});
  });

  it("drops a resource whose actions are not an array of strings", () => {
    const stored = [
      { role: "viewer", permission: '{"project":["read",7],"apiKey":"all"}' },
    ];
    expect(resolveStatements("viewer", BASE_ROLES, stored)).toStrictEqual({
      project: ["read"],
    });
  });

  it("does not mutate the base role it merges into", () => {
    const stored = [{ role: "member", permission: '{"project":["delete"]}' }];
    resolveStatements("member", BASE_ROLES, stored);
    expect(BASE_ROLES.member?.project).toStrictEqual(["read"]);
  });
});

describe(superadminTenant, () => {
  it("carries no statements, because can() answers on the kind", () => {
    const organizationId = "org_b" as TenantId;
    expect(superadminTenant("user_1", organizationId)).toStrictEqual({
      organizationId: "org_b",
      principal: { kind: "superadmin", userId: "user_1" },
    });
  });
});

describe(mayCrossOrganizations, () => {
  it("lets a superadmin on the admin session send the organization header", () => {
    expect(
      mayCrossOrganizations({
        session: { audience: ADMIN_AUDIENCE },
        user: { role: SUPERADMIN_ROLE },
      })
    ).toBeTruthy();
  });

  it("refuses a superadmin on the client session", () => {
    expect(
      mayCrossOrganizations({
        session: { audience: CLIENT_AUDIENCE },
        user: { role: SUPERADMIN_ROLE },
      })
    ).toBeFalsy();
  });

  it("refuses an admin on the admin session, and a session with no audience", () => {
    expect(
      mayCrossOrganizations({
        session: { audience: ADMIN_AUDIENCE },
        user: { role: "admin" },
      })
    ).toBeFalsy();
    expect(
      mayCrossOrganizations({ user: { role: SUPERADMIN_ROLE } })
    ).toBeFalsy();
  });
});
