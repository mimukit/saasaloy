import { cacheAside } from "./cached";
import { assertKey, buildKey } from "./keys";
import { KvError } from "./provider";
import type { BuildKeyOptions } from "./keys";
import type {
  ConsumeRequest,
  ConsumeResult,
  KvEnv,
  KvListOptions,
  KvListResult,
  KvProvider,
  KvSetOptions,
  Policy,
} from "./provider";

// The provider registry, the policy table and the `createKv(env)` factory behind them.
// This file holds everything true of *every* provider — selection, key validation, JSON
// encoding, the size cap, the TTL floor, policy resolution and error normalization — so
// a provider module ships four small methods and nothing else.

/** Workers KV's value cap, and the number every provider is held to. */
export const MAX_VALUE_BYTES = 25 * 1024 * 1024;

const encoder = new TextEncoder();

export interface KvConfig {
  providers: KvProvider[];
  policies: Policy[];
}

/** What a caller reads and writes with. Returned by `createKv(env)`. */
export interface KvClient {
  /** The selected provider's name — handy in logs and in a `doctor` check. */
  provider: string;
  /** The registered policy table, in registration order. */
  policies: Policy[];
  /** Build a namespaced key, with `KV_KEY_PREFIX` already applied. */
  key(options: Omit<BuildKeyOptions, "prefix">): string;
  /** The stored value, or `null` when the key is absent or expired. A miss is not an error. */
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: KvSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KvListOptions): Promise<KvListResult>;
  /** Cache-aside. See `cached.ts` for what it does not do. */
  cached<T>(
    key: string,
    ttlSeconds: number,
    load: () => T | Promise<T>
  ): Promise<T>;
  /** Spend one unit of a named policy's budget. Throws `not_supported` if the provider cannot count. */
  consume(request: ConsumeRequest): Promise<ConsumeResult>;
  /** Resolve a registered policy by name. Throws `not_supported` for an unknown one. */
  policy(name: string): Policy;
}

export interface KvRegistry {
  providers: KvProvider[];
  policies: Policy[];
  create(env: KvEnv): KvClient;
}

/**
 * Declare a rate limit budget.
 *
 * ```ts
 * definePolicy({ name: "strict", limit: 10, periodSeconds: 10 });
 * ```
 *
 * On `kv-cloudflare` the numbers that actually apply live in `wrangler.jsonc` under
 * `RL_STRICT`; the ones here document the intent and drive the counting providers.
 */
export function definePolicy(policy: Policy): Policy {
  const { name, limit, periodSeconds } = policy;

  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    throw new Error(
      `Policy name ${JSON.stringify(name)} must be lower-case and start with a letter: ` +
        `it becomes the RL_${name.toUpperCase()} binding name.`
    );
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Policy "${name}": limit must be a positive integer.`);
  }
  if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
    throw new Error(
      `Policy "${name}": periodSeconds must be a positive integer.`
    );
  }

  return { limit, name, periodSeconds };
}

/**
 * Build the provider registry and the policy table. Both arrays are patch points: every
 * `kv-<provider>` module appends to `providers`, and `ratelimit` appends to `policies`.
 * See `src/index.ts`.
 */
export function defineKv(config: KvConfig): KvRegistry {
  const { policies, providers } = config;

  return {
    create(env: KvEnv): KvClient {
      const provider = selectProvider(providers, env.KV_PROVIDER);
      const prefix = env.KV_KEY_PREFIX ?? "";

      function policy(name: string): Policy {
        const found = policies.find((p) => p.name === name);
        if (!found) {
          const known =
            policies.length > 0
              ? `Registered policies: ${policies.map((p) => p.name).join(", ")}.`
              : "No policies are registered — install one, e.g. `saasaloy add ratelimit`.";
          throw new KvError(
            "not_supported",
            `Rate limit policy "${name}" is not registered. ${known}`
          );
        }
        return found;
      }

      const client: KvClient = {
        async consume(request: ConsumeRequest): Promise<ConsumeResult> {
          // Resolved before the `try`: an unregistered name is the caller's mistake, and
          // wrapping it as `provider_error` would blame the wrong layer.
          const resolved = policy(request.policy);
          assertKey(request.key);

          // Read off the provider once, so the narrowing survives into the closure below.
          const consume = provider.consume;
          if (!consume) {
            throw new KvError(
              "not_supported",
              `The "${provider.name}" provider cannot count, so it has no rate limiting. ` +
                `Install a provider that implements consume (e.g. kv-cloudflare or kv-memory) ` +
                `and point KV_PROVIDER at it.`
            );
          }

          return run(provider, "consume", () =>
            // `.call` rather than a bare call: the method was read off the provider a few
            // lines up, and a provider written as a class would lose its `this` otherwise.
            consume.call(provider, env, { key: request.key, policy: resolved })
          );
        },

        async cached<T>(
          key: string,
          ttlSeconds: number,
          load: () => T | Promise<T>
        ): Promise<T> {
          return cacheAside<T>(client, key, ttlSeconds, load);
        },

        async delete(key: string): Promise<void> {
          assertKey(key);
          await run(provider, "delete", () => provider.delete(env, key));
        },

        async get<T>(key: string): Promise<T | null> {
          assertKey(key);
          const raw = await run(provider, "get", () => provider.get(env, key));
          if (raw === null) {
            return null;
          }
          return decode<T>(key, raw);
        },

        key(options: Omit<BuildKeyOptions, "prefix">): string {
          return buildKey({ ...options, prefix });
        },

        async list(options: KvListOptions = {}): Promise<KvListResult> {
          return run(provider, "list", () => provider.list(env, options));
        },

        policies,

        policy,

        provider: provider.name,

        async set<T>(
          key: string,
          value: T,
          options: KvSetOptions = {}
        ): Promise<void> {
          // Every check below runs before the provider is reached, so a rejected write
          // never half-lands: nothing is stored and nothing is billed.
          assertKey(key);
          const ttlSeconds = assertTtl(provider, options.ttlSeconds);
          const encoded = encode(key, value);

          await run(provider, "set", () =>
            provider.set(env, key, encoded, { ttlSeconds })
          );
        },
      };

      return client;
    },
    policies,
    providers,
  };
}

/**
 * `KV_PROVIDER` is required even when exactly one provider is installed, and an unknown
 * value is an error rather than a fallback. Both directions of the silent failure are
 * worse than a throw: a production deploy that quietly reads an empty in-memory map, and
 * a test run that quietly writes to the real namespace.
 */
function selectProvider(
  providers: KvProvider[],
  selected: string | undefined
): KvProvider {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered — install one, e.g. `saasaloy add kv-memory`.";

  if (!selected) {
    throw new Error(`KV_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `KV_PROVIDER is "${selected}", which is not registered. ${known}`
    );
  }
  return provider;
}

/**
 * A TTL below the floor throws and is never rounded up. Rounding 5 seconds to 60 would
 * make the same cache-aside call behave differently on two providers with no signal,
 * which is the failure this whole capability exists to prevent.
 */
function assertTtl(
  provider: KvProvider,
  ttlSeconds: number | undefined
): number | undefined {
  if (ttlSeconds === undefined) {
    return undefined;
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new KvError(
      "invalid_ttl",
      `ttlSeconds must be a positive whole number of seconds, got ${String(ttlSeconds)}. ` +
        `Omit it for an entry that never expires.`
    );
  }
  if (ttlSeconds < provider.minTtlSeconds) {
    throw new KvError(
      "invalid_ttl",
      `ttlSeconds ${ttlSeconds} is below the "${provider.name}" provider's floor of ` +
        `${provider.minTtlSeconds} seconds. It is not rounded up, because the same call ` +
        `would then expire at a different time on a different provider.`
    );
  }
  return ttlSeconds;
}

/**
 * The core owns serialization, so every provider stores strings only and no two of them
 * disagree about how a `Date` or a `Map` survives a round trip (they do not — JSON is
 * the contract).
 */
function encode<T>(key: string, value: T): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value) as string | undefined;
  } catch (error) {
    throw new KvError(
      "not_supported",
      `The value for ${JSON.stringify(key)} cannot be JSON-encoded. Store plain data: ` +
        `a cycle, a BigInt and a function all fail here.`,
      { cause: error }
    );
  }

  // `JSON.stringify(undefined)` is `undefined`, and so is the result for a function or a
  // symbol. Writing "undefined" would come back as a parse error on the next read, so it
  // is refused at the door instead.
  if (encoded === undefined) {
    throw new KvError(
      "not_supported",
      `The value for ${JSON.stringify(key)} encodes to nothing. Use null for "no value"; ` +
        `undefined, a function and a symbol are not storable.`
    );
  }

  const bytes = encoder.encode(encoded).length;
  if (bytes > MAX_VALUE_BYTES) {
    throw new KvError(
      "too_large",
      `The value for ${JSON.stringify(key)} is ${bytes} bytes, over the ` +
        `${MAX_VALUE_BYTES}-byte limit. Put the blob in object storage and keep a ` +
        `reference here.`
    );
  }

  return encoded;
}

function decode<T>(key: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new KvError(
      "provider_error",
      `The value stored at ${JSON.stringify(key)} is not valid JSON. It was probably ` +
        `written by something other than @repo/kv.`,
      { cause: error }
    );
  }
}

/**
 * A provider is contractually responsible for normalizing its own failures, but a
 * bespoke one written in a consumer's project may not — and a raw `TypeError` from a
 * failed `fetch` reaching the caller would break the `KvError` contract `provider.ts`
 * promises. Re-throw a well-formed error untouched; wrap anything else, keeping the
 * original in `cause`.
 */
async function run<T>(
  provider: KvProvider,
  operation: string,
  call: () => T | Promise<T>
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof KvError) {
      throw error;
    }
    throw new KvError(
      "provider_error",
      `${provider.name}: ${operation} failed`,
      { cause: error, retryable: false }
    );
  }
}
