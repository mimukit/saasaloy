// Tests for the two env rules in ./env.ts. `add auth` ships this file
// as `env.test.ts` when the project's testing mode is on. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest, and `pnpm test` runs that after the
// turbo pass.

import { describe, expect, it } from "vitest";
import { deriveCookieDomain, requireAuthSecret } from "./env";

describe(requireAuthSecret, () => {
  it("returns the configured secret", () => {
    expect(requireAuthSecret({ BETTER_AUTH_SECRET: "s3cr3t" })).toBe("s3cr3t");
  });

  it("trims surrounding whitespace off the secret", () => {
    expect(requireAuthSecret({ BETTER_AUTH_SECRET: "  s3cr3t\n" })).toBe(
      "s3cr3t"
    );
  });

  it("throws when the secret is unset and no baseURL is configured", () => {
    expect(() => requireAuthSecret({})).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("throws when the secret is unset on a production baseURL", () => {
    expect(() =>
      requireAuthSecret({ BETTER_AUTH_URL: "https://api.example.com" })
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("throws when the secret is empty or blank rather than absent", () => {
    for (const BETTER_AUTH_SECRET of ["", "   ", "\t\n"]) {
      expect(() =>
        requireAuthSecret({
          BETTER_AUTH_SECRET,
          BETTER_AUTH_URL: "https://api.example.com",
        })
      ).toThrow(/BETTER_AUTH_SECRET/);
    }
  });

  it("throws when the baseURL cannot be parsed", () => {
    expect(() => requireAuthSecret({ BETTER_AUTH_URL: "not a url" })).toThrow(
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
      expect(() => requireAuthSecret({ BETTER_AUTH_URL })).toThrow(
        /BETTER_AUTH_SECRET/
      );
    }
  });

  it("names the variable and the way out in the thrown message", () => {
    expect(() =>
      requireAuthSecret({ BETTER_AUTH_URL: "https://api.example.com" })
    ).toThrow(
      expect.toSatisfy((error: Error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/BETTER_AUTH_SECRET/);
        expect(error.message).toMatch(/wrangler secret put/);
        expect(error.message).toMatch(/BETTER_AUTH_URL/);
        return true;
      })
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
      expect(
        requireAuthSecret({ BETTER_AUTH_URL }),
        `${BETTER_AUTH_URL} is local dev`
      ).toBeUndefined();
    }
  });

  it("prefers a configured secret even on a loopback baseURL", () => {
    expect(
      requireAuthSecret({
        BETTER_AUTH_SECRET: "s3cr3t",
        BETTER_AUTH_URL: "http://localhost:4000",
      })
    ).toBe("s3cr3t");
  });
});

describe(deriveCookieDomain, () => {
  it("returns an explicit COOKIE_DOMAIN unchanged", () => {
    expect(
      deriveCookieDomain({
        BETTER_AUTH_URL: "https://api.example.com",
        COOKIE_DOMAIN: ".example.com",
      })
    ).toBe(".example.com");
  });

  it("returns undefined when no baseURL is configured", () => {
    expect(deriveCookieDomain({})).toBeUndefined();
  });

  it("returns undefined when the baseURL cannot be parsed", () => {
    expect(
      deriveCookieDomain({ BETTER_AUTH_URL: "not a url" })
    ).toBeUndefined();
  });

  it("stays host-only on a loopback baseURL", () => {
    for (const BETTER_AUTH_URL of [
      "http://localhost:4000",
      "http://127.0.0.1:8787",
      "http://[::1]:4000",
    ]) {
      expect(
        deriveCookieDomain({ BETTER_AUTH_URL }),
        `${BETTER_AUTH_URL} is host-only`
      ).toBeUndefined();
    }
  });

  it("strips an api. prefix to the apex", () => {
    expect(
      deriveCookieDomain({ BETTER_AUTH_URL: "https://api.example.com" })
    ).toBe(".example.com");
    expect(
      deriveCookieDomain({
        BETTER_AUTH_URL: "https://api.staging.example.com",
      })
    ).toBe(".staging.example.com");
  });

  it("refuses to strip down to a bare TLD", () => {
    // `api.dev` strips to `.dev`, which browsers reject outright. Host-only is the
    // safe answer: login still works, it just does not span subdomains.
    for (const BETTER_AUTH_URL of ["https://api.dev", "https://api.io"]) {
      expect(
        deriveCookieDomain({ BETTER_AUTH_URL }),
        `${BETTER_AUTH_URL} must not strip to a bare TLD`
      ).toBeUndefined();
    }
  });

  it("stays host-only on a hostname shape it does not recognize", () => {
    for (const BETTER_AUTH_URL of [
      "https://example.com",
      "https://www.example.com",
      "https://backend.example.com",
      "https://apiary.example.com",
    ]) {
      expect(
        deriveCookieDomain({ BETTER_AUTH_URL }),
        `${BETTER_AUTH_URL} is not an api. host`
      ).toBeUndefined();
    }
  });
});
