// Tests for the two env rules in ./env.ts. This file is NOT in the descriptor's
// `scaffolds[].files` list, so `add auth` never copies it into a user's project — it
// exists for this repo only.
//
// It runs on `node:test`, not on the CLI's vitest instance, and the reason is
// mechanical: vite has to load a tsconfig for every file it transforms, the payload's
// own `modules/auth/files/tsconfig.json` extends `@repo/tsconfig/base.json`, and that
// package resolves only inside a scaffolded project. Vitest therefore fails the file
// with TSCONFIG_ERROR before a single assertion runs. Node 24 strips the types with no
// tsconfig at all, which is the same reason `scripts/*.ts` needs no build step. Run
// them with `pnpm test:modules`; `pnpm test` runs that after the turbo pass.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves
// the real file rather than a bundler's guess. Shipped payload code keeps the
// extensionless style the rest of the modules use; only this repo-only file differs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveCookieDomain, requireAuthSecret } from "./env.ts";

describe("requireAuthSecret", () => {
  it("returns the configured secret", () => {
    assert.equal(requireAuthSecret({ BETTER_AUTH_SECRET: "s3cr3t" }), "s3cr3t");
  });

  it("trims surrounding whitespace off the secret", () => {
    assert.equal(
      requireAuthSecret({ BETTER_AUTH_SECRET: "  s3cr3t\n" }),
      "s3cr3t"
    );
  });

  it("throws when the secret is unset and no baseURL is configured", () => {
    assert.throws(
      () => requireAuthSecret({}),
      /BETTER_AUTH_SECRET/,
      "an unset secret with no baseURL must not fall through to the dev default"
    );
  });

  it("throws when the secret is unset on a production baseURL", () => {
    assert.throws(
      () => requireAuthSecret({ BETTER_AUTH_URL: "https://api.example.com" }),
      /BETTER_AUTH_SECRET/
    );
  });

  it("throws when the secret is empty or blank rather than absent", () => {
    for (const BETTER_AUTH_SECRET of ["", "   ", "\t\n"]) {
      assert.throws(
        () =>
          requireAuthSecret({
            BETTER_AUTH_SECRET,
            BETTER_AUTH_URL: "https://api.example.com",
          }),
        /BETTER_AUTH_SECRET/
      );
    }
  });

  it("throws when the baseURL cannot be parsed", () => {
    assert.throws(
      () => requireAuthSecret({ BETTER_AUTH_URL: "not a url" }),
      /BETTER_AUTH_SECRET/
    );
  });

  it("throws on a hostname that merely contains a loopback label", () => {
    // The escape hatch is an exact hostname match, not a substring test. Without
    // this, `localhost.attacker.example` and `127.0.0.1.nip.io` would disarm it.
    for (const BETTER_AUTH_URL of [
      "https://localhost.attacker.example",
      "https://not-localhost",
      "https://127.0.0.1.nip.io",
      "https://api.localhost.example.com",
    ]) {
      assert.throws(
        () => requireAuthSecret({ BETTER_AUTH_URL }),
        /BETTER_AUTH_SECRET/,
        `${BETTER_AUTH_URL} must not count as local dev`
      );
    }
  });

  it("names the variable and the way out in the thrown message", () => {
    assert.throws(
      () => requireAuthSecret({ BETTER_AUTH_URL: "https://api.example.com" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /BETTER_AUTH_SECRET/);
        assert.match(error.message, /wrangler secret put/);
        assert.match(error.message, /BETTER_AUTH_URL/);
        return true;
      }
    );
  });

  it("returns undefined on an explicit loopback baseURL", () => {
    // undefined hands Better Auth its own development default, which is what the
    // local loop has always used. The hatch is narrow: the operator has to write a
    // loopback BETTER_AUTH_URL for it to open at all.
    for (const BETTER_AUTH_URL of [
      "http://localhost:4000",
      "http://localhost",
      "http://127.0.0.1:8787",
      "http://[::1]:4000",
    ]) {
      assert.equal(
        requireAuthSecret({ BETTER_AUTH_URL }),
        undefined,
        `${BETTER_AUTH_URL} is local dev`
      );
    }
  });

  it("prefers a configured secret even on a loopback baseURL", () => {
    assert.equal(
      requireAuthSecret({
        BETTER_AUTH_SECRET: "s3cr3t",
        BETTER_AUTH_URL: "http://localhost:4000",
      }),
      "s3cr3t"
    );
  });
});

describe("deriveCookieDomain", () => {
  it("returns an explicit COOKIE_DOMAIN unchanged", () => {
    assert.equal(
      deriveCookieDomain({
        BETTER_AUTH_URL: "https://api.example.com",
        COOKIE_DOMAIN: ".example.com",
      }),
      ".example.com"
    );
  });

  it("returns undefined when no baseURL is configured", () => {
    assert.equal(deriveCookieDomain({}), undefined);
  });

  it("returns undefined when the baseURL cannot be parsed", () => {
    assert.equal(
      deriveCookieDomain({ BETTER_AUTH_URL: "not a url" }),
      undefined
    );
  });

  it("stays host-only on a loopback baseURL", () => {
    for (const BETTER_AUTH_URL of [
      "http://localhost:4000",
      "http://127.0.0.1:8787",
      "http://[::1]:4000",
    ]) {
      assert.equal(
        deriveCookieDomain({ BETTER_AUTH_URL }),
        undefined,
        `${BETTER_AUTH_URL} is host-only`
      );
    }
  });

  it("strips an api. prefix to the apex", () => {
    assert.equal(
      deriveCookieDomain({ BETTER_AUTH_URL: "https://api.example.com" }),
      ".example.com"
    );
    assert.equal(
      deriveCookieDomain({
        BETTER_AUTH_URL: "https://api.staging.example.com",
      }),
      ".staging.example.com"
    );
  });

  it("refuses to strip down to a bare TLD", () => {
    // `api.dev` strips to `.dev`, which browsers reject outright. Host-only is the
    // safe answer: login still works, it just does not span subdomains.
    for (const BETTER_AUTH_URL of ["https://api.dev", "https://api.io"]) {
      assert.equal(
        deriveCookieDomain({ BETTER_AUTH_URL }),
        undefined,
        `${BETTER_AUTH_URL} must not strip to a bare TLD`
      );
    }
  });

  it("stays host-only on a hostname shape it does not recognize", () => {
    for (const BETTER_AUTH_URL of [
      "https://example.com",
      "https://www.example.com",
      "https://backend.example.com",
      "https://apiary.example.com",
    ]) {
      assert.equal(
        deriveCookieDomain({ BETTER_AUTH_URL }),
        undefined,
        `${BETTER_AUTH_URL} is not an api. host`
      );
    }
  });
});
