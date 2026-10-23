// Tests for the two rules the client/admin split adds to ./authorize.ts: the audience a
// session and a request belong to, and the rank rule the admin instance's guard asks
// before every `/admin/*` endpoint. Like ./server.test.ts, this file is NOT in the
// descriptor's `scaffolds[].files` list and runs on `node:test` through
// `pnpm test:modules`; see that file for why.
//
// The last `describe` reads the instance and plugin files as text, because they import
// `better-auth` and cannot load here. It pins the wiring the rules depend on: which
// instance gets which audience, which guard, and which role list.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
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
} from "./authorize.ts";
import type { RankCall } from "./authorize.ts";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

describe("the two role lists", () => {
  it("opens the admin app to both shipped site roles", () => {
    assert.deepEqual([...ADMIN_APP_ROLES], [ADMIN_ROLE, SUPERADMIN_ROLE]);
  });

  it("keeps the group list and the privilege list as two separate arrays", () => {
    // A project adds `support` to ADMIN_APP_ROLES only. If the two names held one
    // array, that edit would also make `support` pass every `requireAdmin` route.
    assert.notEqual(ADMIN_APP_ROLES, ADMIN_ROLES);
  });
});

describe("siteRoleMap", () => {
  const grants = { admin: "admin statements", user: "user statements" };

  it("keys the admin grant by both configured role strings", () => {
    const roles = siteRoleMap(grants);
    for (const role of ADMIN_ROLES) {
      // better-auth refuses to start when an `adminRoles` entry is not a key here.
      assert.equal(roles[role], "admin statements", role);
    }
    assert.equal(roles.user, "user statements");
  });

  it("gives a renamed admin role the /admin/* permissions", () => {
    const roles = siteRoleMap(grants, {
      adminRole: "staff",
      superadminRole: "owner",
    });
    assert.deepEqual(roles, {
      user: "user statements",
      staff: "admin statements",
      owner: "admin statements",
    });
    // The plugin's built-in key does not linger: a stale "admin" row gets nothing.
    assert.equal(Object.hasOwn(roles, "admin"), false);
  });
});

describe("parseAudience", () => {
  it("reads a missing header as the client audience", () => {
    assert.deepEqual(parseAudience(null), {
      audience: CLIENT_AUDIENCE,
      denial: null,
    });
    // The function takes `undefined` on purpose, so passing it is the case under test.
    // oxlint-disable-next-line unicorn/no-useless-undefined
    assert.deepEqual(parseAudience(undefined), {
      audience: CLIENT_AUDIENCE,
      denial: null,
    });
  });

  it("reads both names exactly", () => {
    assert.equal(parseAudience("client").audience, "client");
    assert.equal(parseAudience("admin").audience, "admin");
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
      assert.equal(audience, null, `${JSON.stringify(value)} must not resolve`);
      assert.equal(denial, UNKNOWN_AUDIENCE);
    }
    assert.equal(UNKNOWN_AUDIENCE.status, 400);
    assert.match(UNKNOWN_AUDIENCE.message, new RegExp(AUDIENCE_HEADER));
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
    assert.equal(decide(clientSession, undefined, "client").denial, null);
    assert.equal(decide(adminSession, ADMIN_ROLES, "admin").denial, null);
  });

  it("refuses a session of the other audience as signed out, not as forbidden", () => {
    // An admin who copied their client token into the admin cookie holds the right
    // role and the wrong audience. 401 sends them to sign in on the admin app.
    const copied = {
      session: { audience: "client" },
      user: { role: ADMIN_ROLE },
    };
    const { denial, session } = decide(copied, ADMIN_ROLES, ADMIN_AUDIENCE);
    assert.equal(denial, SIGNED_OUT);
    assert.equal(session, null);
    assert.equal(decide(adminSession, undefined, "client").denial, SIGNED_OUT);
  });

  it("refuses a session with no audience field when an audience is demanded", () => {
    assert.equal(
      decide({ user: { role: ADMIN_ROLE } }, ADMIN_ROLES, "admin").denial,
      SIGNED_OUT
    );
    assert.equal(
      decide({ session: {}, user: { role: "user" } }, undefined, "client")
        .denial,
      SIGNED_OUT
    );
  });

  it("checks the audience before the role, so the wrong session never reads as 403", () => {
    const { denial } = decide(clientSession, ADMIN_ROLES, "admin");
    assert.equal(denial?.status, 401);
  });

  it("ignores the audience when none is demanded, as before the split", () => {
    assert.equal(decide({ user: { role: "user" } }).denial, null);
  });
});

describe("adminPathKind", () => {
  it("names every endpoint better-auth 1.7.7's admin() plugin registers", () => {
    assert.deepEqual(Object.keys(ADMIN_PATHS).toSorted(), [
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
    assert.equal(adminPathKind("/admin/new-endpoint"), "unknown");
    assert.equal(adminPathKind("constructor"), "unknown");
    assert.equal(adminPathKind("toString"), "unknown");
  });
});

describe("grantedRoles", () => {
  it("reads role from set-role and create-user, as one string or a list", () => {
    assert.deepEqual(grantedRoles("/admin/set-role", { role: "admin" }), [
      "admin",
    ]);
    assert.deepEqual(
      grantedRoles("/admin/create-user", { role: ["user", "superadmin"] }),
      ["user", "superadmin"]
    );
  });

  it("reads data.role from update-user", () => {
    assert.deepEqual(
      grantedRoles("/admin/update-user", { data: { role: "superadmin" } }),
      ["superadmin"]
    );
    assert.deepEqual(
      grantedRoles("/admin/update-user", { data: { name: "Ada" } }),
      []
    );
  });

  it("reads nothing from any other path or from a body that is not an object", () => {
    assert.deepEqual(grantedRoles("/admin/ban-user", { role: "admin" }), []);
    // A GET endpoint has no body, so a missing body is the case under test.
    // oxlint-disable-next-line unicorn/no-useless-undefined
    assert.deepEqual(grantedRoles("/admin/set-role", undefined), []);
    assert.deepEqual(grantedRoles("/admin/set-role", "admin"), []);
  });
});

describe("takesSuperadmin", () => {
  it("is true for removing or banning an account", () => {
    assert.equal(takesSuperadmin("/admin/remove-user", {}), true);
    assert.equal(takesSuperadmin("/admin/ban-user", {}), true);
  });

  it("is true for a role write that leaves superadmin out", () => {
    assert.equal(takesSuperadmin("/admin/set-role", { role: "admin" }), true);
    assert.equal(
      takesSuperadmin("/admin/update-user", { data: { role: "user" } }),
      true
    );
  });

  it("is false for a role write that keeps superadmin, or writes no role", () => {
    assert.equal(
      takesSuperadmin("/admin/set-role", { role: "superadmin" }),
      false
    );
    assert.equal(
      takesSuperadmin("/admin/update-user", { data: { name: "Ada" } }),
      false
    );
    assert.equal(takesSuperadmin("/admin/unban-user", {}), false);
  });
});

describe("rankDenial", () => {
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
    assert.equal(rankDenial(call({})), null);
    assert.equal(rankDenial(call({ granted: ["user"] })), null);
  });

  it("lets an admin read anything", () => {
    assert.equal(
      rankDenial(call({ kind: "read", targetRole: SUPERADMIN_ROLE })),
      null
    );
  });

  it("refuses an admin who touches an admin-group account", () => {
    for (const targetRole of ADMIN_APP_ROLES) {
      assert.equal(rankDenial(call({ targetRole })), ADMIN_GROUP_REFUSED);
    }
    assert.equal(
      rankDenial(call({ kind: "session-write", targetRole: ADMIN_ROLE })),
      ADMIN_GROUP_REFUSED
    );
  });

  it("refuses an admin who grants an admin-group role, on any write", () => {
    assert.equal(
      rankDenial(call({ granted: [ADMIN_ROLE] })),
      ADMIN_GROUP_REFUSED
    );
    assert.equal(
      rankDenial(
        call({ kind: "create", targetRole: null, granted: [SUPERADMIN_ROLE] })
      ),
      ADMIN_GROUP_REFUSED
    );
  });

  it("refuses an admin on a path the table does not name", () => {
    assert.equal(rankDenial(call({ kind: "unknown" })), SUPERADMIN_ONLY);
  });

  it("refuses a caller with no role the same way it refuses an admin", () => {
    assert.equal(
      rankDenial(call({ callerRole: null, kind: "unknown" })),
      SUPERADMIN_ONLY
    );
  });

  it("lets a superadmin manage the admin group and call an unknown path", () => {
    const superadmin = { callerRole: SUPERADMIN_ROLE };
    assert.equal(
      rankDenial(call({ ...superadmin, targetRole: ADMIN_ROLE })),
      null
    );
    assert.equal(
      rankDenial(call({ ...superadmin, granted: [SUPERADMIN_ROLE] })),
      null
    );
    assert.equal(rankDenial(call({ ...superadmin, kind: "unknown" })), null);
  });

  it("refuses impersonation for everyone, a superadmin included", () => {
    assert.equal(
      rankDenial(call({ kind: "impersonate", callerRole: SUPERADMIN_ROLE })),
      IMPERSONATION_REFUSED
    );
  });

  it("refuses to take the role from the last superadmin, even for a superadmin", () => {
    assert.equal(
      rankDenial(
        call({
          callerRole: SUPERADMIN_ROLE,
          targetRole: SUPERADMIN_ROLE,
          takesSuperadmin: true,
          superadmins: 1,
        })
      ),
      LAST_SUPERADMIN
    );
  });

  it("lets a superadmin demote one of two superadmins", () => {
    assert.equal(
      rankDenial(
        call({
          callerRole: SUPERADMIN_ROLE,
          targetRole: SUPERADMIN_ROLE,
          takesSuperadmin: true,
          superadmins: 2,
        })
      ),
      null
    );
  });

  it("answers every refusal with 403 and a message", () => {
    for (const denial of [
      ADMIN_GROUP_REFUSED,
      SUPERADMIN_ONLY,
      IMPERSONATION_REFUSED,
      LAST_SUPERADMIN,
    ]) {
      assert.equal(denial.status, 403);
      assert.ok(denial.message.length > 0);
    }
  });
});

describe("instance wiring", () => {
  const auth = read("auth.ts");

  it("names each instance's base path and cookie prefix from its audience", () => {
    assert.match(auth, /cookiePrefix: group,/);
    assert.match(
      auth,
      /export const auth = betterAuth\(\{\s*\.\.\.sharedOptions\(CLIENT_AUDIENCE\),\s*basePath: "\/auth",/
    );
    assert.match(
      auth,
      /export const adminAuth = betterAuth\(\{\s*\.\.\.sharedOptions\(ADMIN_AUDIENCE\),\s*basePath: "\/admin\/auth",/
    );
  });

  it("scopes each instance's session lookups to its own audience", () => {
    assert.match(auth, /database: scopeSessionsTo\(\s*drizzleAdapter\(/);
  });

  it("closes sign-up on the admin instance only", () => {
    assert.equal(auth.match(/disableSignUp: true/g)?.length, 1);
    assert.match(
      auth,
      /basePath: "\/admin\/auth",\s*emailAndPassword: \{\s*enabled: true,\s*disableSignUp: true,/
    );
  });

  it("gives each instance its audience plugin first, and its own guard", () => {
    assert.match(
      auth,
      /plugins: \[audience\(CLIENT_AUDIENCE\), siteRoles\(\), clientAdminGuard\(\)\]/
    );
    assert.match(
      auth,
      /plugins: \[\s*audience\(ADMIN_AUDIENCE, \{ roles: ADMIN_APP_ROLES \}\),\s*siteRoles\(\),\s*rankGuard\(\),\s*\]/
    );
  });

  it("builds the admin() plugin's roles from config's role strings", () => {
    assert.match(
      auth,
      /roles: siteRoleMap\(\{ admin: adminAc, user: defaultRoles\.user \}\)/
    );
    assert.doesNotMatch(auth, /\.\.\.defaultRoles/);
  });

  it("matches the guards on the /admin/ path prefix, not on a list", () => {
    for (const file of [
      "plugins/client-admin-guard.ts",
      "plugins/rank-guard.ts",
    ]) {
      assert.match(
        read(file),
        /matcher: \(context\) =>\s*context\.path\?\.startsWith\("\/admin\/"\) \?\? false/,
        file
      );
    }
  });

  it("scopes only lookups keyed on the session token, and the transaction adapter too", () => {
    const adapter = read("scoped-adapter.ts");
    assert.match(
      adapter,
      /model === "session" && \(where \?\? \[\]\)\.some\(\(w\) => w\.field === "token"\)/
    );
    assert.match(adapter, /\{ field: "audience", value: audience \}/);
    assert.match(
      adapter,
      /adapter\.transaction\(\(trx\) => callback\(scopeLookups\(trx, audience\)\)\)/
    );
  });
});
