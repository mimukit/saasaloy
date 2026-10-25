// Tests for the server gate: the decision core in ./authorize.ts, and the wiring in
// ./server.ts that turns a decision into a thrown `HTTPException`. `add auth` ships this
// file as `server.test.ts` when the project's testing mode is on. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest.
//
// Why the decision core is a separate file at all: this repo's root `node_modules` holds
// dev tooling and nothing else, so `./server.ts` cannot be imported here — it pulls
// `hono/http-exception`, and through `./auth.ts` it pulls `better-auth`, `@repo/db` and
// `cloudflare:workers`, none of which resolve outside a scaffolded project. Splitting the
// role decision into a file with zero imports is what makes the rule testable at all. The
// last `describe` below reads `./server.ts` as text so the split cannot rot: it asserts
// the three helpers still exist, still hold no condition of their own, and still route
// every refusal through `decide`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLE,
  ADMIN_ROLES,
  SIGNED_OUT,
  SUPERADMIN_ROLE,
  decide,
  hasRole,
  roleDenial,
} from "./authorize";

describe("the site roles", () => {
  it("names the two strings better-auth's admin() plugin is registered with", () => {
    // ./auth.ts passes `adminRoles: [...ADMIN_ROLES]`. Change either string here and
    // the plugin stops agreeing with the gate.
    expect(ADMIN_ROLE).toBe("admin");
    expect(SUPERADMIN_ROLE).toBe("superadmin");
  });

  it("opens apps/admin to both of them", () => {
    // `requireAdmin` demands this list, and `apps/admin/src/lib/auth.ts` keeps its own
    // copy of the same pair because a browser bundle cannot import from
    // `@repo/auth/server`. The two have to stay equal.
    expect([...ADMIN_ROLES]).toStrictEqual([ADMIN_ROLE, SUPERADMIN_ROLE]);
  });
});

describe(hasRole, () => {
  it("accepts an exact match", () => {
    expect(hasRole({ user: { role: "admin" } }, ADMIN_ROLE)).toBeTruthy();
  });

  it("refuses the plugin's default role", () => {
    // Every account starts as "user". That is the whole population the gate exists
    // to hold back, so it gets its own case.
    expect(hasRole({ user: { role: "user" } }, ADMIN_ROLE)).toBeFalsy();
  });

  it("refuses a session whose role is unset or null", () => {
    // A user row written before the admin plugin shipped has no role at all, and the
    // Drizzle adapter hands back `null` for the empty column. Neither is an admin.
    expect(hasRole({ user: {} }, ADMIN_ROLE)).toBeFalsy();
    expect(hasRole({ user: { role: undefined } }, ADMIN_ROLE)).toBeFalsy();
    expect(hasRole({ user: { role: null } }, ADMIN_ROLE)).toBeFalsy();
  });

  it("refuses a comma-joined role, which is the documented contract", () => {
    // better-auth's plugin reads `user.role` as a comma-separated list, so
    // `"admin,support"` is an admin to `auth.api.listUsers` and is refused here. The
    // divergence is deliberate: it fails closed, and `apps/admin`'s browser guard
    // compares with `===` too, so accepting it here alone would split the two halves
    // of the gate. This case is the contract, not an oversight.
    expect(
      hasRole({ user: { role: "admin,support" } }, ADMIN_ROLE)
    ).toBeFalsy();
    expect(
      hasRole({ user: { role: "support,admin" } }, ADMIN_ROLE)
    ).toBeFalsy();
  });

  it("compares case-sensitively and does not match a substring", () => {
    // The comparison is `===` on purpose. A fold or a prefix test would let
    // "Admin", "administrator" and "admin,user" through a check meant to be exact.
    for (const role of [
      "Admin",
      "ADMIN",
      "administrator",
      "admin,user",
      " admin",
    ]) {
      expect(
        hasRole({ user: { role } }, ADMIN_ROLE),
        `${role} must not satisfy ${ADMIN_ROLE}`
      ).toBeFalsy();
    }
  });

  it("accepts any one role from an array, which is the requireAdmin form", () => {
    // `requireAdmin` passes `ADMIN_ROLES`, so both site roles pass one demand.
    expect(hasRole({ user: { role: "admin" } }, ADMIN_ROLES)).toBeTruthy();
    expect(hasRole({ user: { role: "superadmin" } }, ADMIN_ROLES)).toBeTruthy();
    expect(hasRole({ user: { role: "user" } }, ADMIN_ROLES)).toBeFalsy();
  });

  it("compares each entry of an array exactly, with no fold and no substring", () => {
    for (const role of [
      "Admin",
      "SUPERADMIN",
      "administrator",
      "admin,superadmin",
    ]) {
      expect(
        hasRole({ user: { role } }, ADMIN_ROLES),
        `${role} must not satisfy the any-of form`
      ).toBeFalsy();
    }
    expect(hasRole({ user: {} }, ADMIN_ROLES)).toBeFalsy();
    expect(hasRole({ user: { role: null } }, ADMIN_ROLES)).toBeFalsy();
  });

  it("refuses everything when the array is empty", () => {
    // An empty list is a demand nothing satisfies, never an absent demand. Getting
    // this backwards would open the gate to anyone signed in.
    expect(hasRole({ user: { role: "admin" } }, [])).toBeFalsy();
  });

  it("matches any role string, not only admin", () => {
    // `requireRole` is the primitive and `requireAdmin` is one caller of it, so a
    // second role later costs a call site rather than a rewrite.
    expect(hasRole({ user: { role: "support" } }, "support")).toBeTruthy();
    expect(hasRole({ user: { role: "support" } }, "admin")).toBeFalsy();
  });
});

describe("the SIGNED_OUT denial", () => {
  it("denies with 401, which api's ERROR_CODES maps to `unauthorized`", () => {
    expect(SIGNED_OUT.status).toBe(401);
  });

  it("carries a non-empty message, because the error envelope requires one", () => {
    expect(SIGNED_OUT.message).toBe("sign in first");
  });
});

describe(roleDenial, () => {
  it("denies with 403, which api's ERROR_CODES maps to `forbidden`", () => {
    // 403 rather than 401 is the load-bearing part: the caller is authenticated, so
    // signing in again cannot help, and a 401 would send the SPA to the login screen.
    expect(roleDenial(ADMIN_ROLE).status).toBe(403);
  });

  it("names the role it demanded", () => {
    expect(roleDenial(ADMIN_ROLE).message).toBe("role required: admin");
    expect(roleDenial("support").message).toBe("role required: support");
  });

  it("names every role it would have accepted, for the any-of form", () => {
    expect(roleDenial(ADMIN_ROLES).message).toBe(
      "role required: admin or superadmin"
    );
    expect(roleDenial(ADMIN_ROLES).status).toBe(403);
  });
});

describe(decide, () => {
  // This is the gate itself. Every branch below is a branch `requireSession`,
  // `requireRole` and `requireAdmin` no longer carry, so inverting any one of them
  // fails here instead of shipping green.
  const admin = { user: { role: ADMIN_ROLE } };
  const plain = { user: { role: "user" } };

  it("refuses a missing session with 401, with or without a role", () => {
    expect(decide(null).denial).toStrictEqual(SIGNED_OUT);
    // The explicit `undefined` is the assertion: `decide` accepts it as "no session"
    // alongside `null`, so passing nothing here would test a different call.
    // oxlint-disable-next-line no-useless-undefined
    expect(decide(undefined).denial).toStrictEqual(SIGNED_OUT);
    expect(decide(null, ADMIN_ROLE).denial).toStrictEqual(SIGNED_OUT);
    // Signed out beats wrong role: a 403 would tell an anonymous caller to give up
    // rather than sign in.
    expect(decide(null, ADMIN_ROLE).denial?.status).toBe(401);
  });

  it("hands back no session when it refuses", () => {
    // The two fields are exclusive on purpose, so a caller that throws on `denial`
    // cannot go on to read a session that was never allowed.
    expect(decide(null).session).toBeNull();
    expect(decide(plain, ADMIN_ROLE).session).toBeNull();
  });

  it("passes a signed-in caller when no role is demanded", () => {
    // `requireSession` asks this question: who are you, nothing more.
    expect(decide(plain).denial).toBeNull();
    expect(decide(plain).session).toBe(plain);
    expect(decide({ user: {} }).denial).toBeNull();
  });

  it("passes a caller who holds the demanded role", () => {
    expect(decide(admin, ADMIN_ROLE).denial).toBeNull();
    expect(decide(admin, ADMIN_ROLE).session).toBe(admin);
    expect(decide({ user: { role: "support" } }, "support").denial).toBeNull();
  });

  it("refuses a signed-in caller who holds the wrong role with 403", () => {
    // The one case the whole feature exists for: authenticated, not privileged.
    expect(decide(plain, ADMIN_ROLE).denial).toStrictEqual(
      roleDenial(ADMIN_ROLE)
    );
    expect(decide(plain, ADMIN_ROLE).denial?.status).toBe(403);
    expect(decide(plain, ADMIN_ROLE).denial?.message).toBe(
      "role required: admin"
    );
  });

  it("refuses a role-less session when a role is demanded", () => {
    // A row written before the admin plugin shipped reads back `null`.
    expect(decide({ user: {} }, ADMIN_ROLE).denial?.status).toBe(403);
    expect(decide({ user: { role: null } }, ADMIN_ROLE).denial?.status).toBe(
      403
    );
  });

  it("passes either site role when the demand is the any-of form", () => {
    // This is `requireAdmin`. Both roles get into `apps/admin`; `superadmin` sits
    // above `admin`, so refusing it here would lock out the first account created.
    for (const role of [ADMIN_ROLE, SUPERADMIN_ROLE]) {
      const session = { user: { role } };
      expect(decide(session, ADMIN_ROLES).denial).toBeNull();
      expect(decide(session, ADMIN_ROLES).session).toBe(session);
    }
  });

  it("keeps the single-string form exact, which is requireSuperadmin", () => {
    // `requireSuperadmin` must refuse an `admin`. The any-of form exists for
    // `requireAdmin` alone, and adding a role to it here would erase that line.
    expect(decide(admin, SUPERADMIN_ROLE).denial?.status).toBe(403);
    expect(decide(admin, SUPERADMIN_ROLE).denial?.message).toBe(
      "role required: superadmin"
    );
    expect(
      decide({ user: { role: SUPERADMIN_ROLE } }, SUPERADMIN_ROLE).denial
    ).toBeNull();
  });

  it("refuses a signed-in caller against the any-of form with 403", () => {
    expect(decide(plain, ADMIN_ROLES).denial).toStrictEqual(
      roleDenial(ADMIN_ROLES)
    );
    expect(decide(plain, ADMIN_ROLES).session).toBeNull();
  });

  it("treats an empty array as a demand nothing meets", () => {
    // Same rule as the empty string below: the "no role wanted" case keys off
    // `undefined`, not off falsiness or emptiness.
    expect(decide(admin, []).denial?.status).toBe(403);
  });

  it("treats an empty-string role as a demand, not as no demand", () => {
    // The `role` check keys off `undefined`, not off falsiness. A `""` role slipping
    // through as "no role demanded" would open the gate.
    expect(decide(plain, "").denial?.status).toBe(403);
    expect(decide({ user: { role: "" } }, "").denial).toBeNull();
  });
});

describe("server.ts wiring", () => {
  const source = readFileSync(
    fileURLToPath(new URL("server.ts", import.meta.url)),
    "utf-8"
  );

  it("exports the helpers the api routes call", () => {
    for (const name of [
      "requireSession",
      "requireRole",
      "requireAdmin",
      "requireAdminApp",
      "requireSuperadmin",
      "getAdminSession",
    ]) {
      expect(source, `server.ts must export ${name}`).toMatch(
        new RegExp(`export async function ${name}\\(`)
      );
    }
  });

  it("keeps getSession exported, so a nullable read stays available", () => {
    expect(source).toMatch(/export async function getSession\(/);
  });

  it("re-exports the role constants from the decision core rather than restating them", () => {
    expect(source).toMatch(/export \{ ADMIN_ROLE \} from "\.\/authorize"/);
    expect(source).toMatch(
      /export \{ ADMIN_ROLES, SUPERADMIN_ROLE \} from "\.\/authorize"/
    );
  });

  it("gives requireAdmin the any-of list and requireSuperadmin the exact role", () => {
    // The two helpers hold no condition, so the only thing that distinguishes them
    // is which demand they pass. Swapping these would make `requireSuperadmin` admit
    // an `admin`, and nothing else in this file would notice.
    expect(source).toMatch(/return requireRole\(c, ADMIN_ROLES\);/);
    expect(source).toMatch(/return requireRole\(c, SUPERADMIN_ROLE\);/);
  });

  it("routes every refusal through the tested core and one HTTPException", () => {
    // If a helper grows its own literal status or message, these go stale and the
    // tests above stop describing what the api actually answers.
    expect(source).toMatch(/const \{ denial, session \} = decide\(/);
    expect(source).toMatch(/[=] parseAudience\(/);
    expect(source).toMatch(/new HTTPException\(denial\.status/);
  });

  it("reads every role gate from the admin session and demands the admin audience", () => {
    // `requireRole` is the primitive under `requireAdmin`, `requireAdminApp` and
    // `requireSuperadmin`. Reading `getSession` here would let the header pick the client
    // session for an admin gate.
    expect(source).toMatch(
      /decide\(\s*await getAdminSession\(c\),\s*role,\s*ADMIN_AUDIENCE\s*\)/
    );
    expect(source).toMatch(/adminAuth\.api\.getSession\(/);
  });

  it("reads requireSession from the audience the request names", () => {
    expect(source).toMatch(
      /decide\(\s*await getSession\(c\),\s*undefined,\s*requestAudience\(c\)\s*\)/
    );
  });

  it("maps each audience to its own instance, with no branch", () => {
    expect(source).toMatch(
      /const INSTANCES = \{ admin: adminAuth, client: auth \} as const;/
    );
    expect(source).toMatch(/return INSTANCES\[requestAudience\(c\)\];/);
  });

  it("gives requireAdminApp the group list", () => {
    expect(source).toMatch(/return requireRole\(c, ADMIN_APP_ROLES\);/);
  });

  it("holds no decision of its own, only `if (denial)`", () => {
    // The tests above only protect the gate while `decide` is the one thing deciding.
    // A hand-written condition here would run under no test at all, so every `if` in
    // this file must be the throw on a denial `decide` already returned.
    const conditions = source.match(/^\s*if \(.*$/gm) ?? [];
    expect(
      conditions.map((line) => line.trim()),
      "server.ts must branch on nothing but decide()'s answer"
    ).toStrictEqual(["if (denial) {", "if (denial) {", "if (denial) {"]);
  });
});
