// Tests for the two rules the client/admin split adds to ./authorize.ts: the audience a
// session and a request belong to, and the rank rule the admin instance's guard asks
// before every `/admin/*` endpoint. `add auth` ships this file as `audience-rank.test.ts`
// when the project's testing mode is on. In the saasaloy repo `pnpm test:modules` runs it
// in place on Vitest.
//
// The last `describe` reads the instance and plugin files as text, because they import
// `better-auth` and cannot load here. It pins the wiring the rules depend on: which
// instance gets which audience, which guard, and which role list.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  ADMIN_APP_ROLES,
  ADMIN_AUDIENCE,
  ADMIN_GROUP_REFUSED,
  ADMIN_PATHS,
  ADMIN_ROLE,
  ADMIN_ROLES,
  AUDIENCE_HEADER,
  CLIENT_AUDIENCE,
  IMPERSONATION_REFUSED,
  LAST_SUPERADMIN,
  SIGNED_OUT,
  SUPERADMIN_ONLY,
  SUPERADMIN_ROLE,
  UNKNOWN_AUDIENCE,
  adminPathKind,
  decide,
  grantedRoles,
  parseAudience,
  rankDenial,
  siteRoleMap,
  takesSuperadmin,
} from "./authorize";
import type { RankCall } from "./authorize";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

describe("the two role lists", () => {
  it("opens the admin app to both shipped site roles", () => {
    expect([...ADMIN_APP_ROLES]).toStrictEqual([ADMIN_ROLE, SUPERADMIN_ROLE]);
  });

  it("keeps the group list and the privilege list as two separate arrays", () => {
    // A project adds `support` to ADMIN_APP_ROLES only. If the two names held one
    // array, that edit would also make `support` pass every `requireAdmin` route.
    expect(ADMIN_APP_ROLES).not.toBe(ADMIN_ROLES);
  });
});

describe(siteRoleMap, () => {
  const grants = { admin: "admin statements", user: "user statements" };

  it("keys the admin grant by both configured role strings", () => {
    const roles = siteRoleMap(grants);
    for (const role of ADMIN_ROLES) {
      // better-auth refuses to start when an `adminRoles` entry is not a key here.
      expect(roles).toHaveProperty(role, "admin statements");
    }
    expect(roles.user).toBe("user statements");
  });

  it("gives a renamed admin role the /admin/* permissions", () => {
    const roles = siteRoleMap(grants, {
      adminRole: "staff",
      superadminRole: "owner",
    });
    expect(roles).toStrictEqual({
      user: "user statements",
      staff: "admin statements",
      owner: "admin statements",
    });
    // The plugin's built-in key does not linger: a stale "admin" row gets nothing.
    expect(Object.hasOwn(roles, "admin")).toBeFalsy();
  });
});

describe(parseAudience, () => {
  it("reads a missing header as the client audience", () => {
    expect(parseAudience(null)).toStrictEqual({
      audience: CLIENT_AUDIENCE,
      denial: null,
    });
    // The function takes `undefined` on purpose, so passing it is the case under test.
    // oxlint-disable-next-line unicorn/no-useless-undefined
    expect(parseAudience(undefined)).toStrictEqual({
      audience: CLIENT_AUDIENCE,
      denial: null,
    });
  });

  it("reads both names exactly", () => {
    expect(parseAudience("client").audience).toBe("client");
    expect(parseAudience("admin").audience).toBe("admin");
  });

  it("refuses any other value with 400, the empty string and a case fold included", () => {
    for (const value of [
      "",
      "Admin",
      "ADMIN",
      "staff",
      " admin",
      "admin,client",
    ]) {
      const { audience, denial } = parseAudience(value);
      expect(audience, `${JSON.stringify(value)} must not resolve`).toBeNull();
      expect(denial).toBe(UNKNOWN_AUDIENCE);
    }
    expect(UNKNOWN_AUDIENCE.status).toBe(400);
    expect(UNKNOWN_AUDIENCE.message).toMatch(new RegExp(AUDIENCE_HEADER));
  });
});

describe("decide with an audience", () => {
  const clientSession = {
    session: { audience: "client" },
    user: { role: "user" },
  };
  const adminSession = {
    session: { audience: "admin" },
    user: { role: ADMIN_ROLE },
  };

  it("passes a session of the demanded audience", () => {
    expect(decide(clientSession, undefined, "client").denial).toBeNull();
    expect(decide(adminSession, ADMIN_ROLES, "admin").denial).toBeNull();
  });

  it("refuses a session of the other audience as signed out, not as forbidden", () => {
    // An admin who copied their client token into the admin cookie holds the right
    // role and the wrong audience. 401 sends them to sign in on the admin app.
    const copied = {
      session: { audience: "client" },
      user: { role: ADMIN_ROLE },
    };
    const { denial, session } = decide(copied, ADMIN_ROLES, ADMIN_AUDIENCE);
    expect(denial).toBe(SIGNED_OUT);
    expect(session).toBeNull();
    expect(decide(adminSession, undefined, "client").denial).toBe(SIGNED_OUT);
  });

  it("refuses a session with no audience field when an audience is demanded", () => {
    expect(
      decide({ user: { role: ADMIN_ROLE } }, ADMIN_ROLES, "admin").denial
    ).toBe(SIGNED_OUT);
    expect(
      decide({ session: {}, user: { role: "user" } }, undefined, "client")
        .denial
    ).toBe(SIGNED_OUT);
  });

  it("checks the audience before the role, so the wrong session never reads as 403", () => {
    const { denial } = decide(clientSession, ADMIN_ROLES, "admin");
    expect(denial?.status).toBe(401);
  });

  it("ignores the audience when none is demanded, as before the split", () => {
    expect(decide({ user: { role: "user" } }).denial).toBeNull();
  });
});

describe(adminPathKind, () => {
  it("names every endpoint better-auth 1.7.7's admin() plugin registers", () => {
    expect(Object.keys(ADMIN_PATHS).toSorted()).toStrictEqual([
      "/admin/ban-user",
      "/admin/create-user",
      "/admin/get-user",
      "/admin/has-permission",
      "/admin/impersonate-user",
      "/admin/list-user-sessions",
      "/admin/list-users",
      "/admin/remove-user",
      "/admin/revoke-user-session",
      "/admin/revoke-user-sessions",
      "/admin/set-role",
      "/admin/set-user-password",
      "/admin/stop-impersonating",
      "/admin/unban-user",
      "/admin/update-user",
    ]);
  });

  it("calls a path it does not name unknown, including a prototype key", () => {
    expect(adminPathKind("/admin/new-endpoint")).toBe("unknown");
    expect(adminPathKind("constructor")).toBe("unknown");
    expect(adminPathKind("toString")).toBe("unknown");
  });
});

describe(grantedRoles, () => {
  it("reads role from set-role and create-user, as one string or a list", () => {
    expect(grantedRoles("/admin/set-role", { role: "admin" })).toStrictEqual([
      "admin",
    ]);
    expect(
      grantedRoles("/admin/create-user", { role: ["user", "superadmin"] })
    ).toStrictEqual(["user", "superadmin"]);
  });

  it("reads data.role from update-user", () => {
    expect(
      grantedRoles("/admin/update-user", { data: { role: "superadmin" } })
    ).toStrictEqual(["superadmin"]);
    expect(
      grantedRoles("/admin/update-user", { data: { name: "Ada" } })
    ).toStrictEqual([]);
  });

  it("reads nothing from any other path or from a body that is not an object", () => {
    expect(grantedRoles("/admin/ban-user", { role: "admin" })).toStrictEqual(
      []
    );
    // A GET endpoint has no body, so a missing body is the case under test.
    // oxlint-disable-next-line unicorn/no-useless-undefined
    expect(grantedRoles("/admin/set-role", undefined)).toStrictEqual([]);
    expect(grantedRoles("/admin/set-role", "admin")).toStrictEqual([]);
  });
});

describe(takesSuperadmin, () => {
  it("is true for removing or banning an account", () => {
    expect(takesSuperadmin("/admin/remove-user", {})).toBeTruthy();
    expect(takesSuperadmin("/admin/ban-user", {})).toBeTruthy();
  });

  it("is true for a role write that leaves superadmin out", () => {
    expect(takesSuperadmin("/admin/set-role", { role: "admin" })).toBeTruthy();
    expect(
      takesSuperadmin("/admin/update-user", { data: { role: "user" } })
    ).toBeTruthy();
  });

  it("is false for a role write that keeps superadmin, or writes no role", () => {
    expect(
      takesSuperadmin("/admin/set-role", { role: "superadmin" })
    ).toBeFalsy();
    expect(
      takesSuperadmin("/admin/update-user", { data: { name: "Ada" } })
    ).toBeFalsy();
    expect(takesSuperadmin("/admin/unban-user", {})).toBeFalsy();
  });
});

describe(rankDenial, () => {
  const call = (overrides: Partial<RankCall>): RankCall => ({
    kind: "user-write",
    callerRole: ADMIN_ROLE,
    targetRole: "user",
    granted: [],
    takesSuperadmin: false,
    superadmins: 1,
    ...overrides,
  });

  it("lets an admin change a client", () => {
    expect(rankDenial(call({}))).toBeNull();
    expect(rankDenial(call({ granted: ["user"] }))).toBeNull();
  });

  it("lets an admin read anything", () => {
    expect(
      rankDenial(call({ kind: "read", targetRole: SUPERADMIN_ROLE }))
    ).toBeNull();
  });

  it("refuses an admin who touches an admin-group account", () => {
    for (const targetRole of ADMIN_APP_ROLES) {
      expect(rankDenial(call({ targetRole }))).toBe(ADMIN_GROUP_REFUSED);
    }
    expect(
      rankDenial(call({ kind: "session-write", targetRole: ADMIN_ROLE }))
    ).toBe(ADMIN_GROUP_REFUSED);
  });

  it("refuses an admin who grants an admin-group role, on any write", () => {
    expect(rankDenial(call({ granted: [ADMIN_ROLE] }))).toBe(
      ADMIN_GROUP_REFUSED
    );
    expect(
      rankDenial(
        call({ kind: "create", targetRole: null, granted: [SUPERADMIN_ROLE] })
      )
    ).toBe(ADMIN_GROUP_REFUSED);
  });

  it("refuses an admin on a path the table does not name", () => {
    expect(rankDenial(call({ kind: "unknown" }))).toBe(SUPERADMIN_ONLY);
  });

  it("refuses a caller with no role the same way it refuses an admin", () => {
    expect(rankDenial(call({ callerRole: null, kind: "unknown" }))).toBe(
      SUPERADMIN_ONLY
    );
  });

  it("lets a superadmin manage the admin group and call an unknown path", () => {
    const superadmin = { callerRole: SUPERADMIN_ROLE };
    expect(
      rankDenial(call({ ...superadmin, targetRole: ADMIN_ROLE }))
    ).toBeNull();
    expect(
      rankDenial(call({ ...superadmin, granted: [SUPERADMIN_ROLE] }))
    ).toBeNull();
    expect(rankDenial(call({ ...superadmin, kind: "unknown" }))).toBeNull();
  });

  it("refuses impersonation for everyone, a superadmin included", () => {
    expect(
      rankDenial(call({ kind: "impersonate", callerRole: SUPERADMIN_ROLE }))
    ).toBe(IMPERSONATION_REFUSED);
  });

  it("refuses to take the role from the last superadmin, even for a superadmin", () => {
    expect(
      rankDenial(
        call({
          callerRole: SUPERADMIN_ROLE,
          targetRole: SUPERADMIN_ROLE,
          takesSuperadmin: true,
          superadmins: 1,
        })
      )
    ).toBe(LAST_SUPERADMIN);
  });

  it("lets a superadmin demote one of two superadmins", () => {
    expect(
      rankDenial(
        call({
          callerRole: SUPERADMIN_ROLE,
          targetRole: SUPERADMIN_ROLE,
          takesSuperadmin: true,
          superadmins: 2,
        })
      )
    ).toBeNull();
  });

  it("answers every refusal with 403 and a message", () => {
    for (const denial of [
      ADMIN_GROUP_REFUSED,
      SUPERADMIN_ONLY,
      IMPERSONATION_REFUSED,
      LAST_SUPERADMIN,
    ]) {
      expect(denial.status).toBe(403);
      expect(denial.message.length > 0).toBeTruthy();
    }
  });
});

describe("instance wiring", () => {
  const auth = read("auth.ts");

  it("names each instance's base path and cookie prefix from its audience", () => {
    expect(auth).toMatch(/cookiePrefix: group,/);
    expect(auth).toMatch(
      /export const auth = betterAuth\(\{\s*\.\.\.sharedOptions\(CLIENT_AUDIENCE\),\s*basePath: "\/auth",/
    );
    expect(auth).toMatch(
      /export const adminAuth = betterAuth\(\{\s*\.\.\.sharedOptions\(ADMIN_AUDIENCE\),\s*basePath: "\/admin\/auth",/
    );
  });

  it("scopes each instance's session lookups to its own audience", () => {
    expect(auth).toMatch(/database: scopeSessionsTo\(\s*drizzleAdapter\(/);
  });

  it("closes sign-up on the admin instance only", () => {
    expect(auth.match(/disableSignUp: true/g)?.length).toBe(1);
    expect(auth).toMatch(
      /basePath: "\/admin\/auth",\s*emailAndPassword: \{\s*enabled: true,\s*disableSignUp: true,/
    );
  });

  // A module that adds a Better Auth plugin appends it to these arrays, so the match
  // stops after the guard rather than at the closing bracket.
  it("gives each instance its audience plugin first, and its own guard", () => {
    expect(auth).toMatch(
      /plugins: \[\s*audience\(CLIENT_AUDIENCE\),\s*siteRoles\(\),\s*clientAdminGuard\(\)[,\s\]]/
    );
    expect(auth).toMatch(
      /plugins: \[\s*audience\(ADMIN_AUDIENCE, \{ roles: ADMIN_APP_ROLES \}\),\s*siteRoles\(\),\s*rankGuard\(\)[,\s\]]/
    );
  });

  it("builds the admin() plugin's roles from config's role strings", () => {
    expect(auth).toMatch(
      /roles: siteRoleMap\(\{ admin: adminAc, user: defaultRoles\.user \}\)/
    );
    expect(auth).not.toMatch(/\.\.\.defaultRoles/);
  });

  it.each(["plugins/client-admin-guard.ts", "plugins/rank-guard.ts"])(
    "matches the %s guard on the /admin/ path prefix, not on a list",
    (file) => {
      expect(read(file)).toMatch(
        /matcher: \(context\) =>\s*context\.path\?\.startsWith\("\/admin\/"\) \?\? false/
      );
    }
  );

  it("scopes only lookups keyed on the session token, and the transaction adapter too", () => {
    const adapter = read("scoped-adapter.ts");
    expect(adapter).toMatch(
      /model === "session" && \(where \?\? \[\]\)\.some\(\(w\) => w\.field === "token"\)/
    );
    expect(adapter).toMatch(/\{ field: "audience", value: audience \}/);
    expect(adapter).toMatch(
      /adapter\.transaction\(\(trx\) => callback\(scopeLookups\(trx, audience\)\)\)/
    );
  });
});
