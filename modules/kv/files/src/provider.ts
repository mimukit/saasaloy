// The provider contract every `kv-<provider>` module implements, plus the single error
// type providers normalize their failures into. Nothing in this file imports a vendor
// SDK or a Workers binding — the core of `packages/kv` is provider-agnostic and has zero
// runtime dependencies (ADR 0020).

/**
 * The Worker environment, handed to `createKv(env)` whole rather than one binding at a
 * time. Deliberately opaque: *which* key a provider reads (a `KV` binding, an
 * `UPSTASH_REDIS_REST_TOKEN` secret, nothing at all) is exactly what the calling route
 * must not have to know for providers to stay swappable.
 */
export interface KvEnv {
  /** Which registered provider stores. Always required — there is no implicit default. */
  KV_PROVIDER?: string;
  /** Prefix put in front of every key `client.key()` builds. Empty by default. */
  KV_KEY_PREFIX?: string;
  [key: string]: unknown;
}

/**
 * A named rate limit budget. The table lives in `packages/kv` (see `defineKv`), so
 * nothing in this package has to reach into an app to resolve a policy name.
 *
 * `limit` and `periodSeconds` are advisory on a provider that keeps its own numbers
 * elsewhere. On `kv-cloudflare` the real numbers live in `wrangler.jsonc` and editing
 * them here changes nothing on Cloudflare — see the `saasaloy-ratelimit` skill.
 */
export interface Policy {
  /** Lower-case identifier, e.g. "strict". The Cloudflare binding is `RL_STRICT`. */
  name: string;
  /** How many `consume` calls succeed inside one period. */
  limit: number;
  /** Length of the window in seconds. Cloudflare accepts 10 or 60 only. */
  periodSeconds: number;
}

export interface KvSetOptions {
  /**
   * Seconds until the entry expires. Omit for no expiry. A value below the provider's
   * `minTtlSeconds` throws `invalid_ttl` and is never rounded up.
   */
  ttlSeconds?: number;
}

export interface KvListOptions {
  /** Only keys starting with this string. Match the prefix `client.key()` produced. */
  prefix?: string;
  /** Page size. Omitted means the provider's own default. */
  limit?: number;
  /** The `cursor` from the previous page. Omitted means the first page. */
  cursor?: string;
}

export interface KvListResult {
  keys: string[];
  /** Pass back as `cursor` for the next page. Absent when `complete` is true. */
  cursor?: string;
  /** True when this page is the last one. */
  complete: boolean;
}

/** What a caller asks for: the policy by **name**, never its numbers. */
export interface ConsumeRequest {
  policy: string;
  /** What is being limited — an IP, a user id, a route plus an IP. */
  key: string;
}

/**
 * What a provider receives. The core resolves the name against the registered policy
 * table first, so no provider re-implements the lookup or the `not_supported` throw.
 */
export interface ResolvedConsumeRequest {
  policy: Policy;
  key: string;
}

export interface ConsumeResult {
  /** False when the budget is spent. The core does not throw on a refusal. */
  success: boolean;
  /**
   * Calls left in this window. **Optional on purpose**: Cloudflare's Rate Limiting
   * binding returns `{ success }` and nothing else, so reporting a number there would
   * mean inventing one. A caller sends `RateLimit-Remaining` only when it is present.
   */
  remaining?: number;
  /** Unix milliseconds when the window resets. Optional for the same reason. */
  resetAt?: number;
}

export interface KvProvider {
  /** The value `KV_PROVIDER` must hold to select this provider (e.g. "cloudflare"). */
  name: string;
  /**
   * The shortest TTL this provider accepts, in seconds. 60 on Workers KV, 0 in memory.
   * The core refuses a shorter one rather than rounding it up, so a cache-aside call
   * cannot behave differently on two providers with no signal.
   */
  minTtlSeconds: number;
  /** The stored string, or `null` when the key is absent or expired. Never throws for a miss. */
  get(env: KvEnv, key: string): Promise<string | null>;
  set(
    env: KvEnv,
    key: string,
    value: string,
    options: KvSetOptions
  ): Promise<void>;
  /** Deleting an absent key succeeds. */
  delete(env: KvEnv, key: string): Promise<void>;
  list(env: KvEnv, options: KvListOptions): Promise<KvListResult>;
  /**
   * Optional. A provider that cannot count leaves it undefined, and the core throws
   * `not_supported` naming the provider on the first `consume` call.
   */
  consume?(
    env: KvEnv,
    request: ResolvedConsumeRequest
  ): Promise<ConsumeResult> | ConsumeResult;
}

/**
 * Normalized failure codes. Providers map their own vendor codes onto these and keep the
 * raw one in `providerCode`, so a caller can branch on a stable value without learning
 * any provider's error vocabulary.
 *
 * A missing key is **not** one of these: `get` returns `null`.
 */
export type KvErrorCode =
  /** The key is empty, holds a `:` where the parts are joined, or exceeds 512 bytes. */
  | "invalid_key"
  /** The TTL is below the provider's `minTtlSeconds`, or is not a positive integer. */
  | "invalid_ttl"
  /** The encoded value is over 25 MiB. Raised by the core, before any provider call. */
  | "too_large"
  /** The provider itself refused the call for its own quota, not a `consume` refusal. */
  | "rate_limited"
  /** The selected provider cannot do this: no `consume`, or an unregistered policy name. */
  | "not_supported"
  | "provider_error";

export interface KvErrorOptions {
  /** Whether repeating the same call could plausibly succeed. */
  retryable?: boolean;
  /** The provider's own code, verbatim (e.g. "KV_PUT_RATE_LIMITED"). */
  providerCode?: string;
  cause?: unknown;
}

/**
 * The one error the client throws — including the validation the core does before a
 * provider is reached, so a caller's `catch` only ever has one shape to handle.
 * (Selecting the provider happens earlier still, in `createKv(env)`, and a bad
 * `KV_PROVIDER` throws a plain `Error` there: it is a deploy-time misconfiguration, not
 * a failed read.)
 *
 * The package never retries. A retry loop inside a request handler holds the Worker's
 * response open; `retryable` is the hook for a caller to decide.
 */
export class KvError extends Error {
  readonly code: KvErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(
    code: KvErrorCode,
    message: string,
    options: KvErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "KvError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode;
  }
}
