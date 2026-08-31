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
// second `describe` below reads `./server.ts` as text so the split cannot rot: it asserts
// the three helpers still exist and still route their refusals through that core.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ADMIN_ROLE, SIGNED_OUT, hasRole, roleDenial } from "./authorize.ts";

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
    // If a helper grows its own literal status or message, these three go stale and
    // the tests above stop describing what the api actually answers.
    assert.match(source, /SIGNED_OUT/);
    assert.match(source, /roleDenial\(role\)/);
    assert.match(source, /new HTTPException\(denial\.status/);
  });
});
