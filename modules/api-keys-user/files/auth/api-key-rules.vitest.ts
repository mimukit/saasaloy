// Tests for the user owner's decision core. `add api-keys-user` ships this file as
// `api-key-rules.test.ts` when the project's testing mode is on. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest.
//
// `./api-key-rules.ts` carries one `import type` (`./authorize`) and no runtime import at
// all, which is what lets this test load it with nothing installed. Add a runtime import
// there and this file stops loading — that is the guard.
//
// The last block imports `teams`' `permission-rules.ts`, which lands beside this file in
// `packages/auth/src/`, so the descriptor ships this test only when `teams` is installed
// too. Both files stay import-free, so the import costs nothing at runtime, and it is how
// the refusal text of the two modes is held to one format (plan 0083, Q2).

import { describe, expect, it } from "vitest";
import { emptyDemandDenial, permissionDenial } from "./permission-rules";
import { keyAllows, ownerMayUseKeys, scopeDenial } from "./api-key-rules";
import type { CallerPrincipal } from "./api-key-rules";

const VOCABULARY = { cards: ["read", "write"], reviews: ["read"] };

function key(statements: Record<string, readonly string[]>): CallerPrincipal {
  return { kind: "apiKey", keyId: "key_1", statements };
}

const USER: CallerPrincipal = { kind: "user" };

describe(scopeDenial, () => {
  it("passes a scope inside the vocabulary", () => {
    expect(
      scopeDenial({ cards: ["read", "write"], reviews: ["read"] }, VOCABULARY)
    ).toBeNull();
  });

  it("passes an empty scope, which asks for nothing", () => {
    expect(scopeDenial({}, VOCABULARY)).toBeNull();
    expect(scopeDenial({ cards: [] }, VOCABULARY)).toBeNull();
  });

  it("refuses an action the vocabulary does not declare", () => {
    expect(scopeDenial({ reviews: ["write"] }, VOCABULARY)).toStrictEqual({
      status: 403,
      message: "permission required: reviews:write",
    });
  });

  it("refuses a resource the vocabulary does not declare", () => {
    expect(scopeDenial({ decks: ["read"] }, VOCABULARY)).toStrictEqual({
      status: 403,
      message: "permission required: decks:read",
    });
  });

  it("names the first pair outside the vocabulary", () => {
    expect(
      scopeDenial({ cards: ["read", "delete", "purge"] }, VOCABULARY)
    ).toStrictEqual({
      status: 403,
      message: "permission required: cards:delete",
    });
  });

  it("refuses every pair against the empty vocabulary the module ships", () => {
    expect(scopeDenial({ cards: ["read"] }, {})).toStrictEqual({
      status: 403,
      message: "permission required: cards:read",
    });
  });

  it("does not read a vocabulary key off the object prototype", () => {
    expect(scopeDenial({ toString: ["read"] }, VOCABULARY)).toStrictEqual({
      status: 403,
      message: "permission required: toString:read",
    });
  });
});

describe("keyAllows, for a session user", () => {
  it("passes every non-empty demand", () => {
    expect(
      keyAllows(USER, { cards: ["write"], decks: ["purge"] })
    ).toStrictEqual({
      denial: null,
      allowed: true,
    });
  });

  it("refuses an empty demand", () => {
    expect(keyAllows(USER, {})).toStrictEqual({
      denial: { status: 403, message: "permission required" },
      allowed: false,
    });
  });

  it("refuses a demand whose resources list no action", () => {
    expect(keyAllows(USER, { cards: [], decks: undefined })).toStrictEqual({
      denial: { status: 403, message: "permission required" },
      allowed: false,
    });
  });
});

describe("keyAllows, for an API key", () => {
  const reader = key({ cards: ["read"] });

  it("allows an action the key holds", () => {
    expect(keyAllows(reader, { cards: ["read"] })).toStrictEqual({
      denial: null,
      allowed: true,
    });
  });

  it("refuses an action the key does not hold", () => {
    expect(keyAllows(reader, { cards: ["write"] })).toStrictEqual({
      denial: { status: 403, message: "permission required: cards:write" },
      allowed: false,
    });
  });

  it("refuses a resource the key holds nothing on", () => {
    expect(keyAllows(reader, { reviews: ["read"] })).toStrictEqual({
      denial: { status: 403, message: "permission required: reviews:read" },
      allowed: false,
    });
  });

  it("demands every listed action, not any one of them", () => {
    expect(keyAllows(reader, { cards: ["read", "write"] })).toStrictEqual({
      denial: { status: 403, message: "permission required: cards:write" },
      allowed: false,
    });
  });

  it("refuses everything for a key that holds no statement", () => {
    expect(keyAllows(key({}), { cards: ["read"] }).allowed).toBeFalsy();
  });

  it("refuses an empty demand even for a key that holds statements", () => {
    expect(keyAllows(reader, {})).toStrictEqual({
      denial: { status: 403, message: "permission required" },
      allowed: false,
    });
  });
});

describe("the refusal text matches teams' permission-rules.ts", () => {
  it("states a missing pair the way permissionDenial does", () => {
    expect(keyAllows(key({}), { cards: ["read"] }).denial).toStrictEqual(
      permissionDenial("cards", "read")
    );
    expect(scopeDenial({ cards: ["read"] }, {})).toStrictEqual(
      permissionDenial("cards", "read")
    );
  });

  it("states an empty demand the way emptyDemandDenial does", () => {
    expect(keyAllows(USER, {}).denial).toStrictEqual(emptyDemandDenial());
    expect(keyAllows(key({}), {}).denial).toStrictEqual(emptyDemandDenial());
  });
});

describe(ownerMayUseKeys, () => {
  const NOW = Date.parse("2026-10-24T00:00:00.000Z");

  it("lets an owner who is not banned use their keys", () => {
    expect(ownerMayUseKeys({ banned: false }, NOW)).toBeTruthy();
    expect(ownerMayUseKeys({ banned: null }, NOW)).toBeTruthy();
    expect(ownerMayUseKeys({}, NOW)).toBeTruthy();
  });

  it("refuses a banned owner with no expiry", () => {
    expect(ownerMayUseKeys({ banned: true }, NOW)).toBeFalsy();
    expect(
      ownerMayUseKeys({ banned: true, banExpires: null }, NOW)
    ).toBeFalsy();
  });

  it("refuses a banned owner whose ban has not expired", () => {
    const later = new Date(NOW + 60_000);
    expect(
      ownerMayUseKeys({ banned: true, banExpires: later }, NOW)
    ).toBeFalsy();
  });

  it("lets a banned owner through once the ban has expired", () => {
    const earlier = new Date(NOW - 60_000).toISOString();
    expect(
      ownerMayUseKeys({ banned: true, banExpires: earlier }, NOW)
    ).toBeTruthy();
  });

  it("refuses a key with no owner row", () => {
    expect(ownerMayUseKeys(null, NOW)).toBeFalsy();
    expect(ownerMayUseKeys(undefined, NOW)).toBeFalsy();
  });
});
