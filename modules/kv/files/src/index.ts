import { defineKv } from "./define";
import type { KvEnv } from "./provider";
import { kvPolicies } from "./policies.generated";
import { kvProviders } from "./providers.generated";

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

// The provider registry and the policy table. The modules around this one add rows to
// the `kv.providers` and `kv.policies` tables, and the CLI writes
// `./providers.generated.ts` and `./policies.generated.ts` from them on every run:
// `saasaloy add kv-memory` adds `memory()` to `providers`, and `saasaloy add ratelimit`
// adds its policy calls to `policies`. `saasaloy remove` takes the row back out. An entry
// of your own goes after the spread, never in a generated file: the CLI overwrites it,
// and `saasaloy update` refuses when it was edited.
export const kv = defineKv({
  policies: [...kvPolicies],
  providers: [...kvProviders],
});

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
