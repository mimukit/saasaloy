// Tests for key building: the shape, the `:` rejection and the 512-byte cap.
//
// It ships as `src/keys.test.ts` when testing is on, and `pnpm test:modules` runs it in
// place in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { assertKey, buildKey, keyByteLength, MAX_KEY_BYTES } from "./keys";
import { KvError } from "./provider";

function codeOf(fn: () => unknown): string {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  // Fails with the thrown value in the diff, or `undefined` when nothing threw.
  expect(thrown).toBeInstanceOf(KvError);
  return (thrown as KvError).code;
}

describe(buildKey, () => {
  it("joins the namespace and the parts with a colon", () => {
    expect(buildKey({ namespace: "flags", parts: ["doc", "t_42"] })).toBe(
      "flags:doc:t_42"
    );
  });

  it("stringifies a numeric part", () => {
    expect(buildKey({ namespace: "user", parts: [7] })).toBe("user:7");
  });

  it("returns the bare namespace when there are no parts", () => {
    expect(buildKey({ namespace: "flags" })).toBe("flags");
  });

  it("puts the prefix in front, so two environments can share a namespace", () => {
    expect(
      buildKey({ namespace: "flags", parts: ["doc"], prefix: "staging:" })
    ).toBe("staging:flags:doc");
  });

  // Escaping instead would let two different inputs produce one key, which is the
  // collision the namespace exists to prevent.
  it("refuses a colon in a part", () => {
    expect(codeOf(() => buildKey({ namespace: "a", parts: ["b:c"] }))).toBe(
      "invalid_key"
    );
  });

  it("refuses a colon in the namespace", () => {
    expect(codeOf(() => buildKey({ namespace: "a:b" }))).toBe("invalid_key");
  });

  it("refuses an empty namespace or an empty part", () => {
    expect(codeOf(() => buildKey({ namespace: "" }))).toBe("invalid_key");
    expect(codeOf(() => buildKey({ namespace: "a", parts: [""] }))).toBe(
      "invalid_key"
    );
  });

  it("refuses a built key over 512 bytes", () => {
    const long = "x".repeat(600);
    expect(codeOf(() => buildKey({ namespace: "a", parts: [long] }))).toBe(
      "invalid_key"
    );
  });

  it("accepts a key of exactly 512 bytes", () => {
    const key = buildKey({ namespace: "a", parts: ["x".repeat(510)] });
    expect(keyByteLength(key)).toBe(MAX_KEY_BYTES);
  });

  // The limit is a byte limit. A 200-character key of 4-byte code points is 800 bytes,
  // so counting characters would let it through and Workers KV would reject it later.
  it("counts UTF-8 bytes, not characters", () => {
    const emoji = "🙂".repeat(200);
    expect(keyByteLength(emoji)).toBe(800);
    expect(codeOf(() => buildKey({ namespace: "a", parts: [emoji] }))).toBe(
      "invalid_key"
    );
  });
});

describe(assertKey, () => {
  it("accepts an ordinary key", () => {
    expect(() => assertKey("flags:doc")).not.toThrow();
  });

  it("refuses an empty key", () => {
    expect(codeOf(() => assertKey(""))).toBe("invalid_key");
  });

  it("refuses an over-long hand-written key", () => {
    expect(codeOf(() => assertKey("k".repeat(513)))).toBe("invalid_key");
  });
});
