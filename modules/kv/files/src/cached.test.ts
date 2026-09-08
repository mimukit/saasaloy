// Tests for the cache-aside helper, including the two behaviours it deliberately does
// not have. See the header of `keys.test.ts` for why this runs on `node:test`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cacheAside } from "./cached.ts";
import type { CacheAsideStore } from "./cached.ts";

function store() {
  const values = new Map<string, unknown>();
  const calls = { get: 0, set: 0 };

  const api: CacheAsideStore = {
    get<T>(key: string): Promise<T | null> {
      calls.get++;
      return Promise.resolve((values.get(key) ?? null) as T | null);
    },
    set<T>(key: string, value: T): Promise<void> {
      calls.set++;
      values.set(key, value);
      return Promise.resolve();
    },
  };

  return { api, calls, values };
}

describe("cacheAside", () => {
  it("runs the loader on a miss, writes the result and returns it", async () => {
    const { api, calls, values } = store();
    let ran = 0;
    const out = await cacheAside(api, "k", 60, () => {
      ran++;
      return { n: 1 };
    });

    assert.deepEqual(out, { n: 1 });
    assert.equal(ran, 1);
    assert.equal(calls.set, 1);
    assert.deepEqual(values.get("k"), { n: 1 });
  });

  it("returns the hit without running the loader, and writes nothing", async () => {
    const { api, calls } = store();
    await api.set("k", { n: 1 });
    calls.set = 0;

    let ran = 0;
    const out = await cacheAside(api, "k", 60, () => {
      ran++;
      return { n: 2 };
    });

    assert.deepEqual(out, { n: 1 });
    assert.equal(ran, 0, "the loader did not run");
    assert.equal(calls.set, 0, "a read never writes");
  });

  it("passes the TTL to the write", async () => {
    const seen: (number | undefined)[] = [];
    const api: CacheAsideStore = {
      get: () => Promise.resolve(null),
      set: (_key, _value, options) => {
        seen.push(options?.ttlSeconds);
        return Promise.resolve();
      },
    };

    await cacheAside(api, "k", 300, () => 1);
    assert.deepEqual(seen, [300]);
  });

  it("awaits an async loader", async () => {
    const { api } = store();
    const out = await cacheAside(api, "k", 60, () => Promise.resolve("v"));
    assert.equal(out, "v");
  });

  // A cached null is indistinguishable from a miss, so writing one only spends quota.
  it("does not write a null from the loader", async () => {
    const { api, calls } = store();
    const out = await cacheAside<string | null>(api, "k", 60, () => null);
    assert.equal(out, null);
    assert.equal(calls.set, 0);
  });

  it("caches false and 0, which are values rather than absences", async () => {
    const { api, calls } = store();
    assert.equal(await cacheAside(api, "f", 60, () => false), false);
    assert.equal(await cacheAside(api, "z", 60, () => 0), 0);
    assert.equal(calls.set, 2);
    assert.equal(await cacheAside(api, "f", 60, () => true), false);
  });

  // Documented, not fixed: a lock would need an atomic compare-and-set, which Workers KV
  // does not have. The test pins the behaviour so nobody assumes otherwise.
  it("gives no stampede protection — two concurrent misses both load", async () => {
    const { api, calls } = store();
    let ran = 0;
    const load = async () => {
      ran++;
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      return ran;
    };

    await Promise.all([
      cacheAside(api, "k", 60, load),
      cacheAside(api, "k", 60, load),
    ]);

    assert.equal(ran, 2);
    assert.equal(calls.set, 2);
  });

  it("lets the loader's rejection through, and writes nothing", async () => {
    const { api, calls } = store();
    await assert.rejects(
      () =>
        cacheAside(api, "k", 60, () => Promise.reject(new Error("upstream"))),
      /upstream/
    );
    assert.equal(calls.set, 0);
  });
});
