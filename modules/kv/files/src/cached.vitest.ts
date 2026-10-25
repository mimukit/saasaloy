// Tests for the cache-aside helper, including the two behaviours it deliberately does not
// have. It ships as `src/cached.test.ts` when testing is on, and `pnpm test:modules` runs
// it in place in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { cacheAside } from "./cached";
import type { CacheAsideStore } from "./cached";

/** Wait `ms` milliseconds. The global timer, so the workspace needs no Node types. */
function sleep(ms: number): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- wrapping the global timer is the point; there is no Node `timers/promises` type here
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

describe(cacheAside, () => {
  it("runs the loader on a miss, writes the result and returns it", async () => {
    const { api, calls, values } = store();
    let ran = 0;
    const out = await cacheAside(api, "k", 60, () => {
      ran++;
      return { n: 1 };
    });

    expect(out).toStrictEqual({ n: 1 });
    expect(ran).toBe(1);
    expect(calls.set).toBe(1);
    expect(values.get("k")).toStrictEqual({ n: 1 });
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

    expect(out).toStrictEqual({ n: 1 });
    expect(ran, "the loader did not run").toBe(0);
    expect(calls.set, "a read never writes").toBe(0);
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
    expect(seen).toStrictEqual([300]);
  });

  it("awaits an async loader", async () => {
    const { api } = store();
    const out = await cacheAside(api, "k", 60, () => Promise.resolve("v"));
    expect(out).toBe("v");
  });

  // A cached null is indistinguishable from a miss, so writing one only spends quota.
  it("does not write a null from the loader", async () => {
    const { api, calls } = store();
    const out = await cacheAside<string | null>(api, "k", 60, () => null);
    expect(out).toBeNull();
    expect(calls.set).toBe(0);
  });

  it("caches false and 0, which are values rather than absences", async () => {
    const { api, calls } = store();
    await expect(cacheAside(api, "f", 60, () => false)).resolves.toBeFalsy();
    await expect(cacheAside(api, "z", 60, () => 0)).resolves.toBe(0);
    expect(calls.set).toBe(2);
    await expect(cacheAside(api, "f", 60, () => true)).resolves.toBeFalsy();
  });

  // Documented, not fixed: a lock would need an atomic compare-and-set, which Workers KV
  // does not have. The test pins the behaviour so nobody assumes otherwise.
  it("gives no stampede protection — two concurrent misses both load", async () => {
    const { api, calls } = store();
    let ran = 0;
    const load = async () => {
      ran++;
      await sleep(5);
      return ran;
    };

    await Promise.all([
      cacheAside(api, "k", 60, load),
      cacheAside(api, "k", 60, load),
    ]);

    expect(ran).toBe(2);
    expect(calls.set).toBe(2);
  });

  it("lets the loader's rejection through, and writes nothing", async () => {
    const { api, calls } = store();
    await expect(() =>
      cacheAside(api, "k", 60, () => Promise.reject(new Error("upstream")))
    ).rejects.toThrow(/upstream/);
    expect(calls.set).toBe(0);
  });
});
