// Tests for the in-process provider: TTL expiry, the `list` cursor over 2,500 keys, and
// the fixed-window counter behind `consume`. Like the core's tests this file is
// repo-only — the descriptor ships `memory.ts` and nothing else — and it runs on
// `node:test` via `pnpm test:modules`.
//
// Nothing here is stubbed. `../index` and `../provider` resolve through the shims beside
// this module to the real `packages/kv` core, so the assertions below go through the
// same key building, JSON encoding, size cap and TTL floor a deployed Worker uses.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { memory } from "./memory.ts";
import { defineKv, definePolicy } from "../index.ts";
import { KvError } from "../provider.ts";
import type { KvClient } from "../index.ts";

const ENV = { KV_PROVIDER: "memory" };

const STRICT = definePolicy({ limit: 3, name: "strict", periodSeconds: 60 });

const provider = memory();

/** A client over the one shared provider instance, so `reset()` clears what a test wrote. */
function client(): KvClient {
  return defineKv({ policies: [STRICT], providers: [provider] }).create(ENV);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

afterEach(() => {
  provider.reset();
});

describe("memory kv provider", () => {
  it("selects on KV_PROVIDER and round-trips a value through the core", async () => {
    const store = client();
    assert.equal(store.provider, "memory");

    const key = store.key({ namespace: "widget", parts: ["w_1"] });
    assert.equal(key, "widget:w_1");

    assert.equal(await store.get(key), null);
    await store.set(key, { count: 2, name: "hello" });
    assert.deepEqual(await store.get(key), { count: 2, name: "hello" });

    await store.delete(key);
    assert.equal(await store.get(key), null);
  });

  it("accepts a one-second TTL, because its floor is zero", async () => {
    const store = client();
    const key = "ttl:short";

    await store.set(key, "here", { ttlSeconds: 1 });
    assert.equal(await store.get(key), "here");

    await sleep(1100);
    assert.equal(await store.get(key), null);
    // The expired entry is dropped on the way past, not left to leak.
    assert.equal(provider.size(), 0);
  });

  it("keeps a value with no TTL", async () => {
    const store = client();
    await store.set("ttl:none", "kept");
    await sleep(20);
    assert.equal(await store.get("ttl:none"), "kept");
  });

  it("pages 2,500 keys with the cursor it issued", async () => {
    const store = client();
    const total = 2500;

    for (let index = 0; index < total; index += 1) {
      // Zero-padded, so lexicographic order is numeric order and a missed key shows up
      // as a gap rather than as a reshuffle.
      await store.set(`page:${String(index).padStart(4, "0")}`, index);
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let complete = false;

    do {
      const result = await store.list({
        prefix: "page:",
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages += 1;
      for (const key of result.keys) {
        assert.equal(seen.has(key), false, `duplicate key ${key}`);
        seen.add(key);
      }
      complete = result.complete;
      cursor = result.cursor;
      assert.equal(complete, cursor === undefined);
      assert.ok(pages <= 10, "the cursor is not advancing");
    } while (!complete);

    assert.equal(seen.size, total);
    // 1,000 per page, KV's own default: three pages for 2,500 keys.
    assert.equal(pages, 3);
    assert.equal(seen.has("page:0000"), true);
    assert.equal(seen.has("page:2499"), true);
  });

  it("honours prefix and limit, and skips expired keys", async () => {
    const store = client();
    await store.set("a:1", 1);
    await store.set("a:2", 2);
    await store.set("b:1", 3);
    await store.set("a:3", 4, { ttlSeconds: 1 });

    const first = await store.list({ limit: 2, prefix: "a:" });
    assert.deepEqual(first.keys, ["a:1", "a:2"]);
    assert.equal(first.complete, false);

    const second = await store.list({
      limit: 2,
      prefix: "a:",
      // Non-null: the page above was incomplete.
      cursor: first.cursor as string,
    });
    assert.deepEqual(second.keys, ["a:3"]);
    assert.equal(second.complete, true);

    await sleep(1100);
    const third = await store.list({ prefix: "a:" });
    assert.deepEqual(third.keys, ["a:1", "a:2"]);
  });

  it("refuses a cursor it did not issue", async () => {
    const store = client();
    await assert.rejects(
      () => store.list({ cursor: "not base64 ***" }),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "not_supported");
        return true;
      }
    );
  });

  it("counts a fixed window in consume, and reports remaining and resetAt", async () => {
    const store = client();
    const before = Date.now();

    const first = await store.consume({ key: "1.2.3.4", policy: "strict" });
    assert.equal(first.success, true);
    assert.equal(first.remaining, 2);
    assert.ok((first.resetAt ?? 0) > before);

    assert.equal(
      (await store.consume({ key: "1.2.3.4", policy: "strict" })).remaining,
      1
    );
    assert.equal(
      (await store.consume({ key: "1.2.3.4", policy: "strict" })).remaining,
      0
    );

    const fourth = await store.consume({ key: "1.2.3.4", policy: "strict" });
    // A refusal is a value, never a throw.
    assert.equal(fourth.success, false);
    assert.equal(fourth.remaining, 0);
  });

  it("gives each key its own budget", async () => {
    const store = client();
    for (let index = 0; index < 3; index += 1) {
      await store.consume({ key: "1.2.3.4", policy: "strict" });
    }
    assert.equal(
      (await store.consume({ key: "1.2.3.4", policy: "strict" })).success,
      false
    );
    assert.equal(
      (await store.consume({ key: "5.6.7.8", policy: "strict" })).success,
      true
    );
  });

  it("leaves the policy lookup to the core", async () => {
    const store = client();
    await assert.rejects(
      () => store.consume({ key: "k", policy: "nope" }),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "not_supported");
        return true;
      }
    );
  });

  it("still enforces the core's key and TTL rules", async () => {
    const store = client();
    await assert.rejects(() => store.set("", "x"), KvError);
    await assert.rejects(
      () => store.set("k", "x", { ttlSeconds: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "invalid_ttl");
        return true;
      }
    );
  });
});
