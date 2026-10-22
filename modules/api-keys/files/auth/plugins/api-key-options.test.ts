// Tests for the request-side rules every API-key owner shares. This file is NOT in the
// descriptor's `files` list, so `add api-keys` never copies it into a user's project — it
// exists for this repo only. Run it with `pnpm test:modules`.
//
// `./api-key-options.ts` carries one `import type` (`@better-auth/api-key`) and no runtime
// import at all, which is what lets this test load it with nothing installed. Add a
// runtime import there and this file stops loading — that is the guard.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  API_KEY_OPTIONS,
  GUARDED_PATHS,
  INVALID_API_KEY,
  bearerKey,
  hasBearer,
  scopeOf,
} from "./api-key-options.ts";

/** A `Headers`-shaped reader over one optional `authorization` value. */
function headers(authorization?: string) {
  return new Headers(authorization === undefined ? {} : { authorization });
}

describe("scopeOf", () => {
  it("reads the server-only permissions field first", () => {
    assert.deepEqual(
      scopeOf({
        permissions: { project: ["read"] },
        metadata: { scope: { project: ["delete"] } },
      }),
      { project: ["read"] }
    );
  });

  it("falls back to metadata.scope, the browser's channel", () => {
    assert.deepEqual(scopeOf({ metadata: { scope: { project: ["read"] } } }), {
      project: ["read"],
    });
  });

  it("answers null for a body that asks for no scope", () => {
    assert.equal(scopeOf({}), null);
    assert.equal(scopeOf(null), null);
    assert.equal(scopeOf({ permissions: {} }), null);
    assert.equal(scopeOf({ permissions: ["project"] }), null);
  });

  it("drops an action that is not a string, and a resource that is not a list", () => {
    assert.deepEqual(
      scopeOf({ permissions: { project: ["read", 7], team: "read" } }),
      { project: ["read"] }
    );
  });
});

describe("API_KEY_OPTIONS.permissions.defaultPermissions", () => {
  it("writes the scope the body carried", () => {
    const ctx = { body: { metadata: { scope: { project: ["read"] } } } };
    assert.deepEqual(
      API_KEY_OPTIONS.permissions.defaultPermissions("ref", ctx as never),
      { project: ["read"] }
    );
  });

  it("writes an empty map when the body carried none", () => {
    assert.deepEqual(
      API_KEY_OPTIONS.permissions.defaultPermissions("ref", {
        body: {},
      } as never),
      {}
    );
  });
});

describe("GUARDED_PATHS", () => {
  it("guards create and nothing else", () => {
    assert.deepEqual([...GUARDED_PATHS], ["/api-key/create"]);
  });
});

describe("the bearer header", () => {
  it("claims the scheme in any case", () => {
    assert.equal(hasBearer(headers("Bearer sk_abc")), true);
    assert.equal(hasBearer(headers("bearer sk_abc")), true);
    assert.equal(hasBearer(headers("BEARER sk_abc")), true);
  });

  it("does not claim another scheme or a missing header", () => {
    assert.equal(hasBearer(headers("Basic dXNlcjpwYXNz")), false);
    assert.equal(hasBearer(headers()), false);
  });

  it("returns the presented key, trimmed", () => {
    assert.equal(bearerKey(headers("Bearer  sk_abc ")), "sk_abc");
  });

  it("returns null for a claimed scheme with no key behind it", () => {
    // `Headers` trims a value, so the reader is built by hand to keep the spaces. The
    // scheme is claimed, and the resolver answers the missing key with a 401.
    assert.equal(bearerKey({ get: () => "Bearer    " }), null);
    assert.equal(hasBearer({ get: () => "Bearer    " }), true);
  });

  it("claims the bare scheme a real request arrives with", () => {
    // `Headers` trims `Bearer ` to `Bearer`, and so does every Fetch request a Worker
    // receives. That value must still commit the request to the key path, or an empty
    // key would fall back to the cookie riding along with it.
    assert.equal(hasBearer(headers("Bearer ")), true);
    assert.equal(hasBearer(headers("bearer")), true);
    assert.equal(bearerKey(headers("Bearer ")), null);
  });

  it("does not claim a scheme that only starts with the word", () => {
    assert.equal(hasBearer(headers("Bearerx sk_abc")), false);
  });

  it("returns null when the request presents no bearer key", () => {
    assert.equal(bearerKey(headers()), null);
    assert.equal(bearerKey(headers("Basic dXNlcjpwYXNz")), null);
  });
});

describe("INVALID_API_KEY", () => {
  it("is the fixed text a machine caller matches on", () => {
    assert.equal(INVALID_API_KEY, "invalid api key");
  });
});
