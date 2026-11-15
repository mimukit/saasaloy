// Tests for the isolate cache behind the web client. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CMS_CACHE_MAX_ENTRIES,
  CMS_CACHE_TTL_SECONDS,
  createTtlCache,
} from "./cache.ts";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createTtlCache", () => {
  it("defaults the web TTL to 60 seconds", () => {
    assert.equal(CMS_CACHE_TTL_SECONDS, 60);
  });

  it("serves a written value until its TTL runs out", () => {
    const time = clock();
    const cache = createTtlCache<string>(time.now);
    cache.write("a", "one", 60);
    time.advance(59_999);
    assert.equal(cache.read("a"), "one");
    time.advance(1);
    assert.equal(cache.read("a"), undefined);
  });

  it("misses a key it never saw", () => {
    const cache = createTtlCache<string>(clock().now);
    assert.equal(cache.read("nope"), undefined);
  });

  it("writes nothing when the TTL is 0", () => {
    const cache = createTtlCache<string>(clock().now);
    cache.write("a", "one", 0);
    assert.equal(cache.read("a"), undefined);
  });

  it("forgets every key on clear", () => {
    const cache = createTtlCache<string>(clock().now);
    cache.write("a", "one", 60);
    cache.write("b", "two", 60);
    cache.clear();
    assert.equal(cache.read("a"), undefined);
    assert.equal(cache.read("b"), undefined);
  });

  it("keeps an expired write from coming back after a rewrite", () => {
    const time = clock();
    const cache = createTtlCache<string>(time.now);
    cache.write("a", "one", 60);
    time.advance(61_000);
    cache.write("a", "two", 60);
    assert.equal(cache.read("a"), "two");
  });
});

describe("createTtlCache at its size limit", () => {
  it("drops expired entries first, then the oldest write", () => {
    const time = clock(0);
    const cache = createTtlCache<number>(time.now);
    cache.write("short", 0, 1);
    for (let index = 1; index < CMS_CACHE_MAX_ENTRIES; index += 1) {
      cache.write(`key-${String(index)}`, index, 60);
    }
    time.advance(2000);
    // The cache is full. The expired entry goes, and every live one stays.
    cache.write("next", 1, 60);
    assert.equal(cache.read("key-1"), 1);
    assert.equal(cache.read("next"), 1);
    // Full again, with nothing expired: the oldest write goes.
    cache.write("one-more", 2, 60);
    assert.equal(cache.read("key-1"), undefined);
    assert.equal(cache.read("key-2"), 2);
    assert.equal(cache.read("one-more"), 2);
  });
});
