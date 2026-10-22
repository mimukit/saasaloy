// Tests for the user owner's decision core. This file is NOT in the descriptor's `files`
// list, so `add api-keys-user` never copies it into a user's project — it exists for this
// repo only. Run it with `pnpm test:modules`.
//
// `./api-key-rules.ts` carries one `import type` (`./authorize`) and no runtime import at
// all, which is what lets this test load it with nothing installed. Add a runtime import
// there and this file stops loading — that is the guard.
//
// The last block imports `teams`' `permission-rules.ts` across module folders. Both files
// stay import-free, so the cross-module import costs nothing at runtime, and it is how the
// refusal text of the two modes is held to one format (plan 0075, Q2).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyDemandDenial,
  permissionDenial,
} from "../../../teams/files/auth/permission-rules.ts";
import { keyAllows, scopeDenial } from "./api-key-rules.ts";
import type { CallerPrincipal } from "./api-key-rules.ts";

const VOCABULARY = { cards: ["read", "write"], reviews: ["read"] };

function key(statements: Record<string, readonly string[]>): CallerPrincipal {
  return { kind: "apiKey", keyId: "key_1", statements };
}

const USER: CallerPrincipal = { kind: "user" };

describe("scopeDenial", () => {
  it("passes a scope inside the vocabulary", () => {
    assert.equal(
      scopeDenial({ cards: ["read", "write"], reviews: ["read"] }, VOCABULARY),
      null
    );
  });

  it("passes an empty scope, which asks for nothing", () => {
    assert.equal(scopeDenial({}, VOCABULARY), null);
    assert.equal(scopeDenial({ cards: [] }, VOCABULARY), null);
  });

  it("refuses an action the vocabulary does not declare", () => {
    assert.deepEqual(scopeDenial({ reviews: ["write"] }, VOCABULARY), {
      status: 403,
      message: "permission required: reviews:write",
    });
  });

  it("refuses a resource the vocabulary does not declare", () => {
    assert.deepEqual(scopeDenial({ decks: ["read"] }, VOCABULARY), {
      status: 403,
      message: "permission required: decks:read",
    });
  });

  it("names the first pair outside the vocabulary", () => {
    assert.deepEqual(
      scopeDenial({ cards: ["read", "delete", "purge"] }, VOCABULARY),
      { status: 403, message: "permission required: cards:delete" }
    );
  });

  it("refuses every pair against the empty vocabulary the module ships", () => {
    assert.deepEqual(scopeDenial({ cards: ["read"] }, {}), {
      status: 403,
      message: "permission required: cards:read",
    });
  });

  it("does not read a vocabulary key off the object prototype", () => {
    assert.deepEqual(scopeDenial({ toString: ["read"] }, VOCABULARY), {
      status: 403,
      message: "permission required: toString:read",
    });
  });
});

describe("keyAllows, for a session user", () => {
  it("passes every non-empty demand", () => {
    assert.deepEqual(keyAllows(USER, { cards: ["write"], decks: ["purge"] }), {
      denial: null,
      allowed: true,
    });
  });

  it("refuses an empty demand", () => {
    assert.deepEqual(keyAllows(USER, {}), {
      denial: { status: 403, message: "permission required" },
      allowed: false,
    });
  });

  it("refuses a demand whose resources list no action", () => {
    assert.deepEqual(keyAllows(USER, { cards: [], decks: undefined }), {
      denial: { status: 403, message: "permission required" },
      allowed: false,
    });
  });
});

describe("keyAllows, for an API key", () => {
  const reader = key({ cards: ["read"] });

  it("allows an action the key holds", () => {
    assert.deepEqual(keyAllows(reader, { cards: ["read"] }), {
      denial: null,
      allowed: true,
    });
  });

  it("refuses an action the key does not hold", () => {
    assert.deepEqual(keyAllows(reader, { cards: ["write"] }), {
      denial: { status: 403, message: "permission required: cards:write" },
      allowed: false,
    });
  });

  it("refuses a resource the key holds nothing on", () => {
    assert.deepEqual(keyAllows(reader, { reviews: ["read"] }), {
      denial: { status: 403, message: "permission required: reviews:read" },
      allowed: false,
    });
  });

  it("demands every listed action, not any one of them", () => {
    assert.deepEqual(keyAllows(reader, { cards: ["read", "write"] }), {
      denial: { status: 403, message: "permission required: cards:write" },
      allowed: false,
    });
  });

  it("refuses everything for a key that holds no statement", () => {
    assert.equal(keyAllows(key({}), { cards: ["read"] }).allowed, false);
  });

  it("refuses an empty demand even for a key that holds statements", () => {
    assert.deepEqual(keyAllows(reader, {}), {
      denial: { status: 403, message: "permission required" },
      allowed: false,
    });
  });
});

describe("the refusal text matches teams' permission-rules.ts", () => {
  it("states a missing pair the way permissionDenial does", () => {
    assert.deepEqual(
      keyAllows(key({}), { cards: ["read"] }).denial,
      permissionDenial("cards", "read")
    );
    assert.deepEqual(
      scopeDenial({ cards: ["read"] }, {}),
      permissionDenial("cards", "read")
    );
  });

  it("states an empty demand the way emptyDemandDenial does", () => {
    assert.deepEqual(keyAllows(USER, {}).denial, emptyDemandDenial());
    assert.deepEqual(keyAllows(key({}), {}).denial, emptyDemandDenial());
  });
});
