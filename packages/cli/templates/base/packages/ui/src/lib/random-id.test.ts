import { afterEach, describe, expect, it, vi } from "vitest";

import { randomId } from "./random-id";

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe(randomId, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a v4 uuid", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(randomId()).toMatch(V4);
    }
  });

  it("returns a new id each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
  });

  it("sets the version and variant bits over the random bytes", () => {
    // All ones and all zeros pin both edges of the version and variant nibbles.
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
    });
    expect(randomId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    });
    expect(randomId()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("works where crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0x12),
    });
    expect(randomId()).toMatch(V4);
  });
});
