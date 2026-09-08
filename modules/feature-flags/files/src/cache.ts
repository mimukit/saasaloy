// The isolate-local cache — the first of the two layers between a toggle and a running
// Worker, and the one that decides how long the wait is.
//
// It is a plain module-scope `Map`, so its lifetime is the isolate's. It has expiry and no
// invalidation: nothing can reach into another colo's isolate to tell it a flag moved. That
// is the whole reason the TTL is short. At the default 10 seconds a warm isolate re-reads
// the document about 8,640 times a day, which is well inside Workers KV's free 100,000
// daily reads, and a toggle lands within roughly 70 seconds worldwide once KV's own
// propagation window is added on top.
//
// Raise `FLAGS_ISOLATE_TTL_SECONDS` to spend fewer reads and wait longer for a toggle; drop
// it to 0 to skip this layer entirely and pay a KV read per request.

import type { FlagDocument, FlagScope } from "./document";

/** Seconds a cached document is served before it is re-read. */
export const DEFAULT_ISOLATE_TTL_SECONDS = 10;

interface CacheEntry {
  document: FlagDocument;
  expiresAt: number;
}

const entries = new Map<FlagScope, CacheEntry>();

export function readCache(scope: FlagScope): FlagDocument | undefined {
  const entry = entries.get(scope);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    entries.delete(scope);
    return undefined;
  }
  return entry.document;
}

export function writeCache(
  scope: FlagScope,
  document: FlagDocument,
  ttlSeconds: number
): void {
  if (ttlSeconds <= 0) {
    return;
  }
  entries.set(scope, { document, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Drop a scope from *this* isolate's cache. Called after a publish, so the isolate that
 * handled the toggle stops serving its own stale copy immediately; every other isolate
 * still waits out its TTL, because there is no way to tell them.
 */
export function forgetCache(scope?: FlagScope): void {
  if (scope === undefined) {
    entries.clear();
    return;
  }
  entries.delete(scope);
}

/**
 * Read the TTL off the environment.
 *
 * A value that is not a whole number of seconds throws rather than falling back to the
 * default: a typo in `FLAGS_ISOLATE_TTL_SECONDS` that silently kept the default would be
 * found months later, by someone wondering why a toggle takes 70 seconds after they set it
 * to 1.
 */
export function isolateTtlSeconds(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_ISOLATE_TTL_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `FLAGS_ISOLATE_TTL_SECONDS is ${JSON.stringify(raw)}, which is not a whole number ` +
        `of seconds. Use 0 to disable the isolate cache.`
    );
  }
  return parsed;
}
