import { defineKv } from "./define";
import type { KvEnv } from "./provider";

export { cacheAside } from "./cached";
export type { CacheAsideStore } from "./cached";
export { defineKv, definePolicy, MAX_VALUE_BYTES } from "./define";
export type { KvClient, KvConfig, KvRegistry } from "./define";
export { assertKey, buildKey, KEY_SEPARATOR, MAX_KEY_BYTES } from "./keys";
export type { BuildKeyOptions } from "./keys";
export { KvError } from "./provider";
export type {
  ConsumeRequest,
  ConsumeResult,
  KvEnv,
  KvErrorCode,
  KvErrorOptions,
  KvListOptions,
  KvListResult,
  KvProvider,
  KvSetOptions,
  Policy,
  ResolvedConsumeRequest,
} from "./provider";

// The provider registry and the policy table, and the two patch points the modules
// around this one write into. `saasaloy add kv-memory` adds its import and appends
// `memory()` to `providers`; `saasaloy add ratelimit` appends its `definePolicy(...)`
// calls to `policies`. Both are idempotent, so re-running an install changes nothing.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with real array literals. The codemod behind the `plugin-array` patch kind
// (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and an
// install fails silently. Never omit `providers` or `policies`, even while they're empty.
export const kv = defineKv({ policies: [], providers: [] });

/**
 * Get a store for this request's environment. Mirrors `createEmail(c.env)`: it takes the
 * whole `env`, because which key the active provider reads is precisely what a calling
 * route isn't supposed to know.
 *
 * ```ts
 * const store = createKv(c.env);
 * const key = store.key({ namespace: "session", parts: [userId] });
 * const session = await store.get<Session>(key);
 * await store.set(key, next, { ttlSeconds: 3600 });
 * ```
 *
 * Throws when `KV_PROVIDER` is unset or names a provider that isn't installed.
 */
export function createKv(env: KvEnv) {
  return kv.create(env);
}
