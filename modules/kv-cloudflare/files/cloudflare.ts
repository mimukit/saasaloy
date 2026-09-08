import { KvError } from "../provider";
import type {
  ConsumeResult,
  KvEnv,
  KvErrorCode,
  KvListOptions,
  KvListResult,
  KvProvider,
  KvSetOptions,
  ResolvedConsumeRequest,
} from "../provider";

// Workers KV, reached through a binding, plus the Rate Limiting binding behind
// `consume`. There is no API token and no secret here — the `kv_namespaces` and
// `ratelimits` entries in apps/api/wrangler.jsonc *are* the credential, which is why
// this module declares no envVars of its own.
//
// `KVNamespace` and `RateLimit` are ambient globals from @cloudflare/workers-types,
// which packages/kv already carries as a devDependency. Nothing is imported at runtime
// and there is no npm dependency to add (ADR 0020).
//
// Three limits shape everything below, and none of them is this file's to fix:
//
// - **KV is eventually consistent.** A write is visible at once in its own location and
//   up to 60 seconds later everywhere else.
// - **The TTL floor is 60 seconds.** `expirationTtl` under 60 is rejected by the
//   platform, so the provider declares `minTtlSeconds: 60` and the core refuses a
//   shorter one rather than rounding it up.
// - **The limiter counts per Cloudflare location, not globally.** A `limit` of 10 is 10
//   *per colo*, so a distributed burst gets a multiple of it. Cloudflare calls the API
//   "permissive, eventually consistent, and intentionally designed to not be used as an
//   accurate accounting system". Use it to blunt abuse, never to meter billing.

/** Workers KV rejects `expirationTtl` below this. */
const MIN_TTL_SECONDS = 60;

/** The only two window lengths a `ratelimits` entry may declare. */
const ALLOWED_PERIOD_SECONDS = new Set([10, 60]);

export interface CloudflareKvOptions {
  /** KV binding name in wrangler.jsonc. The module's own patch writes `KV`. */
  binding?: string;
  /** Put in front of a policy name to find its limiter binding. Default `RL_`. */
  limiterPrefix?: string;
}

/**
 * KV surfaces a failed request as an `Error` whose message carries the HTTP status —
 * `KV PUT failed: 429 Too Many Requests`. The status is the only machine-readable part,
 * so it is what this table keys on, and it is what lands in `providerCode`.
 *
 * Anything unlisted falls through to `provider_error` / `retryable: false`. Guessing
 * that an unknown failure is safe to retry is the more expensive mistake: a hot loop
 * against a hard rejection burns the request budget and holds the Worker's response
 * open. Add a row when you meet a new status in the wild.
 */
const STATUS_CODES: Record<string, { code: KvErrorCode; retryable: boolean }> =
  {
    // The one-write-per-second-per-key cap, and the account-wide request cap.
    "429": { code: "rate_limited", retryable: true },
    // A value over 25 MiB. The core catches this first, so seeing it here means
    // something wrote past @repo/kv.
    "413": { code: "too_large", retryable: false },
    "500": { code: "provider_error", retryable: true },
    "502": { code: "provider_error", retryable: true },
    "503": { code: "provider_error", retryable: true },
    "504": { code: "provider_error", retryable: true },
  };

export function cloudflare(options: CloudflareKvOptions = {}): KvProvider {
  const bindingName = options.binding ?? "KV";
  const limiterPrefix = options.limiterPrefix ?? "RL_";

  function namespace(env: KvEnv): KVNamespace {
    const binding = env[bindingName] as KVNamespace | undefined;
    if (!binding || typeof binding.get !== "function") {
      throw new KvError(
        "provider_error",
        `No \`${bindingName}\` KV binding on this Worker's env. Add one to ` +
          `apps/api/wrangler.jsonc:\n\n` +
          `  "kv_namespaces": [{ "binding": "${bindingName}", "id": "<id>" }]\n\n` +
          `Create the namespace with \`wrangler kv namespace create app-kv\` and paste ` +
          `the id it prints.`
      );
    }
    return binding;
  }

  return {
    async consume(
      env: KvEnv,
      request: ResolvedConsumeRequest
    ): Promise<ConsumeResult> {
      const { key, policy } = request;
      const name = `${limiterPrefix}${policy.name.toUpperCase()}`;

      // Checked here rather than at registration: `definePolicy` is vendor-blind and
      // runs on every provider, and 10-or-60 is Cloudflare's rule alone.
      if (!ALLOWED_PERIOD_SECONDS.has(policy.periodSeconds)) {
        throw new KvError(
          "not_supported",
          `Policy "${policy.name}" has periodSeconds ${policy.periodSeconds}. The ` +
            `Cloudflare Rate Limiting binding accepts 10 or 60 only.`
        );
      }

      const limiter = env[name] as RateLimit | undefined;
      if (!limiter || typeof limiter.limit !== "function") {
        throw new KvError(
          "not_supported",
          `No \`${name}\` Rate Limiting binding on this Worker's env, so policy ` +
            `"${policy.name}" cannot be enforced. Add it to apps/api/wrangler.jsonc:\n\n` +
            `  "ratelimits": [{ "name": "${name}", "namespace_id": "<unique-integer>", ` +
            `"simple": { "limit": ${policy.limit}, "period": ${policy.periodSeconds} } }]\n\n` +
            `\`namespace_id\` must be unique across the account.`
        );
      }

      try {
        const { success } = await limiter.limit({ key });
        // `{ success }` and nothing else, deliberately. The binding reports no count
        // and no reset time, so inventing `remaining` or `resetAt` here would put a
        // number in a caller's `RateLimit-Remaining` header that means nothing.
        return { success };
      } catch (error) {
        throw normalize(error);
      }
    },

    async delete(env: KvEnv, key: string): Promise<void> {
      try {
        await namespace(env).delete(key);
      } catch (error) {
        throw normalize(error);
      }
    },

    async get(env: KvEnv, key: string): Promise<string | null> {
      try {
        // "text" explicitly: the core owns the JSON encoding, so the binding must hand
        // back exactly the bytes `set` gave it.
        return await namespace(env).get(key, "text");
      } catch (error) {
        throw normalize(error);
      }
    },

    async list(env: KvEnv, listOptions: KvListOptions): Promise<KvListResult> {
      try {
        const page = await namespace(env).list({
          ...(listOptions.prefix === undefined
            ? {}
            : { prefix: listOptions.prefix }),
          ...(listOptions.limit === undefined
            ? {}
            : { limit: listOptions.limit }),
          ...(listOptions.cursor === undefined
            ? {}
            : { cursor: listOptions.cursor }),
        });

        const keys = page.keys.map((entry) => entry.name);
        if (page.list_complete) {
          return { complete: true, keys };
        }
        return { complete: false, cursor: page.cursor, keys };
      } catch (error) {
        throw normalize(error);
      }
    },

    minTtlSeconds: MIN_TTL_SECONDS,

    name: "cloudflare",

    async set(
      env: KvEnv,
      key: string,
      value: string,
      setOptions: KvSetOptions
    ): Promise<void> {
      try {
        // The property is omitted entirely for a no-expiry write. Passing
        // `expirationTtl: undefined` is accepted today, but the platform reads the
        // property's presence rather than its value.
        await namespace(env).put(
          key,
          value,
          setOptions.ttlSeconds === undefined
            ? {}
            : { expirationTtl: setOptions.ttlSeconds }
        );
      } catch (error) {
        throw normalize(error);
      }
    },
  };
}

function normalize(cause: unknown): KvError {
  if (cause instanceof KvError) {
    return cause;
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  const providerCode = readStatus(message);
  const mapped = providerCode ? STATUS_CODES[providerCode] : undefined;

  return new KvError(mapped?.code ?? "provider_error", message, {
    cause,
    ...(providerCode === undefined ? {} : { providerCode }),
    retryable: mapped?.retryable ?? false,
  });
}

/** The HTTP status out of `KV PUT failed: 429 Too Many Requests`, or nothing. */
function readStatus(message: string): string | undefined {
  const match = /failed:\s*(\d{3})\b/.exec(message);
  return match?.[1];
}
