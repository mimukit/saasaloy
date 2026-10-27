// Tests for the request-side rules every API-key owner shares. `add api-keys` ships this
// file as `api-key-options.test.ts` when the project's testing mode is on. In the saasaloy
// repo `pnpm test:modules` runs it in place on Vitest.
//
// `./api-key-options.ts` carries one `import type` (`@better-auth/api-key`) and no runtime
// import at all, which is what lets this test load it with nothing installed. Add a
// runtime import there and this file stops loading — that is the guard.

import { describe, expect, it } from "vitest";
import {
  API_KEY_OPTIONS,
  GUARDED_PATHS,
  INVALID_API_KEY,
  bearerKey,
  hasBearer,
  scopeOf,
} from "./api-key-options";

/** A `Headers`-shaped reader over one optional `authorization` value. */
function headers(authorization?: string) {
  return new Headers(authorization === undefined ? {} : { authorization });
}

describe(scopeOf, () => {
  it("reads the server-only permissions field first", () => {
    expect(
      scopeOf({
        permissions: { project: ["read"] },
        metadata: { scope: { project: ["delete"] } },
      })
    ).toStrictEqual({ project: ["read"] });
  });

  it("falls back to metadata.scope, the browser's channel", () => {
    expect(
      scopeOf({ metadata: { scope: { project: ["read"] } } })
    ).toStrictEqual({
      project: ["read"],
    });
  });

  it("answers null for a body that asks for no scope", () => {
    expect(scopeOf({})).toBeNull();
    expect(scopeOf(null)).toBeNull();
    expect(scopeOf({ permissions: {} })).toBeNull();
    expect(scopeOf({ permissions: ["project"] })).toBeNull();
  });

  it("drops an action that is not a string, and a resource that is not a list", () => {
    expect(
      scopeOf({ permissions: { project: ["read", 7], team: "read" } })
    ).toStrictEqual({ project: ["read"] });
  });
});

describe("API_KEY_OPTIONS.permissions.defaultPermissions", () => {
  it("writes the scope the body carried", () => {
    const ctx = { body: { metadata: { scope: { project: ["read"] } } } };
    expect(
      API_KEY_OPTIONS.permissions.defaultPermissions("ref", ctx as never)
    ).toStrictEqual({ project: ["read"] });
  });

  it("writes an empty map when the body carried none", () => {
    expect(
      API_KEY_OPTIONS.permissions.defaultPermissions("ref", {
        body: {},
      } as never)
    ).toStrictEqual({});
  });
});

describe("the GUARDED_PATHS list", () => {
  it("guards create and nothing else", () => {
    expect([...GUARDED_PATHS]).toStrictEqual(["/api-key/create"]);
  });
});

describe("the bearer header", () => {
  it("claims the scheme in any case", () => {
    expect(hasBearer(headers("Bearer sk_abc"))).toBeTruthy();
    expect(hasBearer(headers("bearer sk_abc"))).toBeTruthy();
    expect(hasBearer(headers("BEARER sk_abc"))).toBeTruthy();
    expect(hasBearer(headers("Bearersk_abc"))).toBeFalsy();
  });

  it("claims a tab after the scheme and reads the key behind it", () => {
    expect(hasBearer(headers("Bearer\tsk_abc"))).toBeTruthy();
    expect(bearerKey(headers("Bearer\tsk_abc"))).toBe("sk_abc");
  });

  it("does not claim another scheme or a missing header", () => {
    expect(hasBearer(headers("Basic dXNlcjpwYXNz"))).toBeFalsy();
    expect(hasBearer(headers())).toBeFalsy();
  });

  it("returns the presented key, trimmed", () => {
    expect(bearerKey(headers("Bearer  sk_abc "))).toBe("sk_abc");
  });

  it("returns null for a claimed scheme with no key behind it", () => {
    // `Headers` trims a value, so the reader is built by hand to keep the spaces. The
    // scheme is claimed, and the resolver answers the missing key with a 401.
    expect(bearerKey({ get: () => "Bearer    " })).toBeNull();
    expect(hasBearer({ get: () => "Bearer    " })).toBeTruthy();
  });

  it("claims the bare scheme a real request arrives with", () => {
    // `Headers` trims `Bearer ` to `Bearer`, and so does every Fetch request a Worker
    // receives. That value must still commit the request to the key path, or an empty
    // key would fall back to the cookie riding along with it.
    expect(hasBearer(headers("Bearer "))).toBeTruthy();
    expect(hasBearer(headers("bearer"))).toBeTruthy();
    expect(bearerKey(headers("Bearer "))).toBeNull();
  });

  it("does not claim a scheme that only starts with the word", () => {
    expect(hasBearer(headers("Bearerx sk_abc"))).toBeFalsy();
  });

  it("returns null when the request presents no bearer key", () => {
    expect(bearerKey(headers())).toBeNull();
    expect(bearerKey(headers("Basic dXNlcjpwYXNz"))).toBeNull();
  });
});

describe(INVALID_API_KEY, () => {
  it("is the fixed text a machine caller matches on", () => {
    expect(INVALID_API_KEY).toBe("invalid api key");
  });
});
