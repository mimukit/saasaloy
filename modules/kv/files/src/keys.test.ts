// Tests for key building: the shape, the `:` rejection and the 512-byte cap.
//
// This file is NOT in the descriptor's `scaffolds[].files` list, so `add kv` never copies
// it into a user's project — it exists for this repo only. It runs on `node:test` rather
// than the CLI's vitest instance, because the payload's own tsconfig extends
// `@repo/tsconfig/base.json`, which resolves only inside a scaffolded project. Node 24
// strips the types with no tsconfig at all. Run them with `pnpm test:modules`.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves
// the real file rather than a bundler's guess. Shipped payload code keeps the
// extensionless style the rest of the modules use; only this repo-only file differs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertKey, buildKey, keyByteLength, MAX_KEY_BYTES } from "./keys.ts";
import { KvError } from "./provider.ts";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof KvError,
      `expected a KvError, got ${String(error)}`
    );
    return error.code;
  }
  assert.fail("expected a throw");
}

describe("buildKey", () => {
  it("joins the namespace and the parts with a colon", () => {
    assert.equal(
      buildKey({ namespace: "flags", parts: ["doc", "t_42"] }),
      "flags:doc:t_42"
    );
  });

  it("stringifies a numeric part", () => {
    assert.equal(buildKey({ namespace: "user", parts: [7] }), "user:7");
  });

  it("returns the bare namespace when there are no parts", () => {
    assert.equal(buildKey({ namespace: "flags" }), "flags");
  });

  it("puts the prefix in front, so two environments can share a namespace", () => {
    assert.equal(
      buildKey({ namespace: "flags", parts: ["doc"], prefix: "staging:" }),
      "staging:flags:doc"
    );
  });

  // Escaping instead would let two different inputs produce one key, which is the
  // collision the namespace exists to prevent.
  it("refuses a colon in a part", () => {
    assert.equal(
      codeOf(() => buildKey({ namespace: "a", parts: ["b:c"] })),
      "invalid_key"
    );
  });

  it("refuses a colon in the namespace", () => {
    assert.equal(
      codeOf(() => buildKey({ namespace: "a:b" })),
      "invalid_key"
    );
  });

  it("refuses an empty namespace or an empty part", () => {
    assert.equal(
      codeOf(() => buildKey({ namespace: "" })),
      "invalid_key"
    );
    assert.equal(
      codeOf(() => buildKey({ namespace: "a", parts: [""] })),
      "invalid_key"
    );
  });

  it("refuses a built key over 512 bytes", () => {
    const long = "x".repeat(600);
    assert.equal(
      codeOf(() => buildKey({ namespace: "a", parts: [long] })),
      "invalid_key"
    );
  });

  it("accepts a key of exactly 512 bytes", () => {
    const key = buildKey({ namespace: "a", parts: ["x".repeat(510)] });
    assert.equal(keyByteLength(key), MAX_KEY_BYTES);
  });

  // The limit is a byte limit. A 200-character key of 4-byte code points is 800 bytes,
  // so counting characters would let it through and Workers KV would reject it later.
  it("counts UTF-8 bytes, not characters", () => {
    const emoji = "🙂".repeat(200);
    assert.equal(keyByteLength(emoji), 800);
    assert.equal(
      codeOf(() => buildKey({ namespace: "a", parts: [emoji] })),
      "invalid_key"
    );
  });
});

describe("assertKey", () => {
  it("accepts an ordinary key", () => {
    assert.doesNotThrow(() => assertKey("flags:doc"));
  });

  it("refuses an empty key", () => {
    assert.equal(
      codeOf(() => assertKey("")),
      "invalid_key"
    );
  });

  it("refuses an over-long hand-written key", () => {
    assert.equal(
      codeOf(() => assertKey("k".repeat(513))),
      "invalid_key"
    );
  });
});
