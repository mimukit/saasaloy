// The cache-aside helper, and the two things it deliberately does not do.

/** The slice of the client `cacheAside` needs. Kept narrow so the tests can stub it. */
export interface CacheAsideStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number }
  ): Promise<void>;
}

/**
 * Read `key`; on a miss run `load`, write the result and return it.
 *
 * ```ts
 * const plans = await kv.cached(kv.key({ namespace: "billing", parts: ["plans"] }), 300, () =>
 *   fetchPlans()
 * );
 * ```
 *
 * Two things it does not do, both on purpose:
 *
 * - **No stampede protection.** Two concurrent misses both run `load` and both write.
 *   A lock would need an atomic compare-and-set, which Workers KV does not have.
 * - **No stale-while-revalidate.** A hit is returned as-is; an expired entry is a miss.
 *
 * And one thing to know before reaching for it on `kv-cloudflare`: the 60 second TTL
 * floor plus the 60 second propagation window means a value can be up to two minutes
 * behind in another location. Cache slow-changing data only.
 *
 * A `null` from `load` is **not** written. `get` returns `null` for a miss too, so a
 * cached `null` would be indistinguishable from an absent key and every later call would
 * re-run `load` anyway — the write would only spend a KV quota. Model "known absent" as
 * a value of its own (`{ found: false }`) when it matters.
 */
export async function cacheAside<T>(
  store: CacheAsideStore,
  key: string,
  ttlSeconds: number,
  load: () => T | Promise<T>
): Promise<T> {
  const hit = await store.get<T>(key);
  if (hit !== null) {
    return hit;
  }

  const value = await load();
  if (value !== null && value !== undefined) {
    await store.set(key, value, { ttlSeconds });
  }
  return value;
}
