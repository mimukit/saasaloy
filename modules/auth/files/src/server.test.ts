// Tests for the server gate: the decision core in ./authorize.ts, and the wiring in
// ./server.ts that turns a decision into a thrown `HTTPException`. This file is NOT in
// the descriptor's `scaffolds[].files` list, so `add auth` never copies it into a user's
// project — it exists for this repo only.
//
// It runs on `node:test`, not on the CLI's vitest instance, for the reason ./env.test.ts
// spells out: the payload's own tsconfig resolves only inside a scaffolded project. Run
// it with `pnpm test:modules`; `pnpm test` runs that after the turbo pass. The imports
// need the explicit `.ts` extension because Node's type stripping resolves the real file.
//
// Why the decision core is a separate file at all: this repo's root `node_modules` holds
// dev tooling and nothing else, so `./server.ts` cannot be imported here — it pulls
// `hono/http-exception`, and through `./auth.ts` it pulls `better-auth`, `@repo/db` and
// `cloudflare:workers`, none of which resolve outside a scaffolded project. Splitting the
// role decision into a file with zero imports is what makes the rule testable at all. The
// last `describe` below reads `./server.ts` as text so the split cannot rot: it asserts
// the three helpers still exist, still hold no condition of their own, and still route
// every refusal through `decide`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ADMIN_ROLE,
  SIGNED_OUT,
  decide,
  hasRole,
  roleDenial,
} from "./authorize.ts";

describe("ADMIN_ROLE", () => {
  it("is the string better-auth's admin() plugin treats as privileged", () => {
    // `admin()` is registered with its defaults in ./auth.ts, so `adminRoles` is
    // `["admin"]`. Change this string and the plugin stops agreeing with the gate.
    assert.equal(ADMIN_ROLE, "admin");
  });
});

describe("hasRole", () => {
  it("accepts an exact match", () => {
    assert.equal(hasRole({ user: { role: "admin" } }, ADMIN_ROLE), true);
  });

  it("refuses the plugin's default role", () => {
    // Every account starts as "user". That is the whole population the gate exists
    // to hold back, so it gets its own case.
    assert.equal(hasRole({ user: { role: "user" } }, ADMIN_ROLE), false);
  });

  it("refuses a session whose role is unset or null", () => {
    // A user row written before the admin plugin shipped has no role at all, and the
    // Drizzle adapter hands back `null` for the empty column. Neither is an admin.
    assert.equal(hasRole({ user: {} }, ADMIN_ROLE), false);
    assert.equal(hasRole({ user: { role: undefined } }, ADMIN_ROLE), false);
    assert.equal(hasRole({ user: { role: null } }, ADMIN_ROLE), false);
  });

  it("refuses a comma-joined role, which is the documented contract", () => {
    // better-auth's plugin reads `user.role` as a comma-separated list, so
    // `"admin,support"` is an admin to `auth.api.listUsers` and is refused here. The
    // divergence is deliberate: it fails closed, and `apps/admin`'s browser guard
    // compares with `===` too, so accepting it here alone would split the two halves
    // of the gate. This case is the contract, not an oversight.
    assert.equal(
      hasRole({ user: { role: "admin,support" } }, ADMIN_ROLE),
      false
    );
    assert.equal(
      hasRole({ user: { role: "support,admin" } }, ADMIN_ROLE),
      false
    );
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
      assert.equal(
        hasRole({ user: { role } }, ADMIN_ROLE),
        false,
        `${role} must not satisfy ${ADMIN_ROLE}`
      );
    }
  });

  it("matches any role string, not only admin", () => {
    // `requireRole` is the primitive and `requireAdmin` is one caller of it, so a
    // second role later costs a call site rather than a rewrite.
    assert.equal(hasRole({ user: { role: "support" } }, "support"), true);
    assert.equal(hasRole({ user: { role: "support" } }, "admin"), false);
  });
});

describe("SIGNED_OUT", () => {
  it("denies with 401, which api's ERROR_CODES maps to `unauthorized`", () => {
    assert.equal(SIGNED_OUT.status, 401);
  });

  it("carries a non-empty message, because the error envelope requires one", () => {
    assert.equal(SIGNED_OUT.message, "sign in first");
  });
});

describe("roleDenial", () => {
  it("denies with 403, which api's ERROR_CODES maps to `forbidden`", () => {
    // 403 rather than 401 is the load-bearing part: the caller is authenticated, so
    // signing in again cannot help, and a 401 would send the SPA to the login screen.
    assert.equal(roleDenial(ADMIN_ROLE).status, 403);
  });

  it("names the role it demanded", () => {
    assert.equal(roleDenial(ADMIN_ROLE).message, "role required: admin");
    assert.equal(roleDenial("support").message, "role required: support");
  });
});

describe("decide", () => {
  // This is the gate itself. Every branch below is a branch `requireSession`,
  // `requireRole` and `requireAdmin` no longer carry, so inverting any one of them
  // fails here instead of shipping green.
  const admin = { user: { role: ADMIN_ROLE } };
  const plain = { user: { role: "user" } };

  it("refuses a missing session with 401, with or without a role", () => {
    assert.deepEqual(decide(null).denial, SIGNED_OUT);
    // The explicit `undefined` is the assertion: `decide` accepts it as "no session"
    // alongside `null`, so passing nothing here would test a different call.
    // oxlint-disable-next-line no-useless-undefined
    assert.deepEqual(decide(undefined).denial, SIGNED_OUT);
    assert.deepEqual(decide(null, ADMIN_ROLE).denial, SIGNED_OUT);
    // Signed out beats wrong role: a 403 would tell an anonymous caller to give up
    // rather than sign in.
    assert.equal(decide(null, ADMIN_ROLE).denial?.status, 401);
  });

  it("hands back no session when it refuses", () => {
    // The two fields are exclusive on purpose, so a caller that throws on `denial`
    // cannot go on to read a session that was never allowed.
    assert.equal(decide(null).session, null);
    assert.equal(decide(plain, ADMIN_ROLE).session, null);
  });

  it("passes a signed-in caller when no role is demanded", () => {
    // `requireSession` asks this question: who are you, nothing more.
    assert.equal(decide(plain).denial, null);
    assert.equal(decide(plain).session, plain);
    assert.equal(decide({ user: {} }).denial, null);
  });

  it("passes a caller who holds the demanded role", () => {
    assert.equal(decide(admin, ADMIN_ROLE).denial, null);
    assert.equal(decide(admin, ADMIN_ROLE).session, admin);
    assert.equal(decide({ user: { role: "support" } }, "support").denial, null);
  });

  it("refuses a signed-in caller who holds the wrong role with 403", () => {
    // The one case the whole feature exists for: authenticated, not privileged.
    assert.deepEqual(decide(plain, ADMIN_ROLE).denial, roleDenial(ADMIN_ROLE));
    assert.equal(decide(plain, ADMIN_ROLE).denial?.status, 403);
    assert.equal(
      decide(plain, ADMIN_ROLE).denial?.message,
      "role required: admin"
    );
  });

  it("refuses a role-less session when a role is demanded", () => {
    // A row written before the admin plugin shipped reads back `null`.
    assert.equal(decide({ user: {} }, ADMIN_ROLE).denial?.status, 403);
    assert.equal(
      decide({ user: { role: null } }, ADMIN_ROLE).denial?.status,
      403
    );
  });

  it("treats an empty-string role as a demand, not as no demand", () => {
    // The `role` check keys off `undefined`, not off falsiness. A `""` role slipping
    // through as "no role demanded" would open the gate.
    assert.equal(decide(plain, "").denial?.status, 403);
    assert.equal(decide({ user: { role: "" } }, "").denial, null);
  });
});

describe("server.ts wiring", () => {
  const source = readFileSync(
    fileURLToPath(new URL("server.ts", import.meta.url)),
    "utf-8"
  );

  it("exports the three helpers the api routes call", () => {
    for (const name of ["requireSession", "requireRole", "requireAdmin"]) {
      assert.match(
        source,
        new RegExp(`export async function ${name}\\(`),
        `server.ts must export ${name}`
      );
    }
  });

  it("keeps getSession exported, so a nullable read stays available", () => {
    assert.match(source, /export async function getSession\(/);
  });

  it("re-exports ADMIN_ROLE from the decision core rather than restating it", () => {
    assert.match(source, /export \{ ADMIN_ROLE \} from "\.\/authorize"/);
  });

  it("routes every refusal through the tested core and one HTTPException", () => {
    // If a helper grows its own literal status or message, these go stale and the
    // tests above stop describing what the api actually answers.
    assert.match(source, /const \{ denial, session \} = decide\(/);
    assert.match(source, /decide\(await getSession\(c\), role\)/);
    assert.match(source, /new HTTPException\(denial\.status/);
  });

  it("holds no decision of its own, only `if (denial)`", () => {
    // The tests above only protect the gate while `decide` is the one thing deciding.
    // A hand-written condition here would run under no test at all, so every `if` in
    // this file must be the throw on a denial `decide` already returned.
    const conditions = source.match(/^\s*if \(.*$/gm) ?? [];
    assert.deepEqual(
      conditions.map((line) => line.trim()),
      ["if (denial) {", "if (denial) {"],
      "server.ts must branch on nothing but decide()'s answer"
    );
  });
});
