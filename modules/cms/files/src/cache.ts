// The isolate-local cache between `apps/web` and the cms api, modelled on
// `feature-flags`' `src/cache.ts`.
//
// It is a plain `Map`, so its lifetime is the isolate's. It has expiry and no invalidation:
// a publish cannot reach into another colo's isolate, so a post shows within one TTL, not
// at once (plan 0105, "Cache"). It keeps 404s and redirects too, so a crawler that walks
// a dead slug costs one api read a minute per isolate, not one per request.
//
// Move this to the `kv` capability if traffic grows past what one read per isolate per
// minute can carry.

/** Seconds a cached answer is served before the client reads the api again. */
export const CMS_CACHE_TTL_SECONDS = 60;

/** A key-value cache whose entries expire. `now` is injectable for tests. */
export interface TtlCache<V> {
  read(key: string): V | undefined;
  write(key: string, value: V, ttlSeconds: number): void;
  clear(): void;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/** A new, empty cache. `now` defaults to `Date.now`. */
export function createTtlCache<V>(now: () => number = Date.now): TtlCache<V> {
  const entries = new Map<string, CacheEntry<V>>();
  return {
    clear() {
      entries.clear();
    },
    read(key) {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return;
      }
      return entry.value;
    },
    write(key, value, ttlSeconds) {
      if (ttlSeconds <= 0) {
        return;
      }
      entries.set(key, { expiresAt: now() + ttlSeconds * 1000, value });
    },
  };
}
