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

// Upstash Redis, reached over HTTPS with the `@upstash/redis` SDK. Select it with
// `KV_PROVIDER=upstash`. Unlike `kv-cloudflare` there is no binding: the credential is
// the `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` pair, read off the `env`
// argument and never from `process.env`, which a Worker does not have.
//
// What this provider is for, and what it costs:
//
// - **`consume` counts once, globally.** Cloudflare's Rate Limiting binding counts per
//   colo and reports `{ success }` alone. This one runs one Lua script holding `INCR`,
//   `EXPIRE NX` and `PTTL`, so it returns a real `remaining` and `resetAt` and the
//   `ratelimit` middleware can send `RateLimit-Remaining`. The window is fixed, the same
//   shape `kv-memory` and Cloudflare use.
// - **Every call is a network round trip.** Workers KV reads from a local cache; this
//   store is one database in one region, so a read costs a full HTTPS request. The SDK
//   carries the `upstash-sync-token` header, so a read after a write is consistent even
//   on a global database with read replicas.
// - **`KV_KEY_PREFIX` is required here.** One Redis database is one flat keyspace, so
//   `list({})` without a prefix would `SCAN` the whole database and hand back foreign
//   keys. The core applies the prefix when it builds a key, so a `list` prefix from
//   `client.key()` already carries it; this file keeps the `MATCH` glob inside it and
//   prepends it to every limiter bucket. Empty or unset throws before any
//   request. `kv-cloudflare` needs none of this because its namespace already scopes it.
// - **`limit` is a hint, not a page size.** SCAN's `COUNT` is how much work one iteration
//   does, so a page may hold more or fewer keys than asked — and an empty page with a
//   live cursor is normal, not the end. Page until `complete` is true, never until a page
//   comes back empty.
// - **Sizes disagree at the two ends.** The core refuses a value over 25 MiB, and Upstash
//   caps one record at 1 MB on the free plan (100 MB on paid). A value can therefore pass
//   the core and still be refused here; that refusal is mapped to `too_large` so a caller
//   sees one code either way.

/** Redis `EX` takes whole seconds and rejects 0, so one second is the true floor. */
const MIN_TTL_SECONDS = 1;

/** Glob metacharacters Redis `MATCH` reads, escaped with a backslash. */
const GLOB_SPECIAL = /[*?[\]^\\]/g;

/**
 * One call, three commands, atomically: count this window, give the key an expiry the
 * first time it appears, and report how long the window has left.
 *
 * `EXPIRE ... NX` only sets an expiry where there is none, so the window ends a fixed
 * period after its first call rather than sliding forward on every later one. Doing the
 * three as separate commands would leave a bucket with no expiry whenever a request dies
 * between them, and that key then refuses forever.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1], 'NX')
return { count, redis.call('PTTL', KEYS[1]) }
`;

/**
 * The HTTP status the SDK puts in an `UpstashError` message — `Upstash Redis request
 * failed: 429 …` — is the only machine-readable part of a failure, so it is what this
 * table keys on and what lands in `providerCode`.
 *
 * Anything unlisted falls through to `provider_error` / `retryable: false`. Guessing that
 * an unknown failure is safe to retry is the more expensive mistake: a hot loop against a
 * hard rejection burns the request budget and holds the Worker's response open.
 */
const STATUS_CODES: Record<string, { code: KvErrorCode; retryable: boolean }> =
  {
    // A wrong or revoked token. A deploy fault, and retrying makes it worse.
    "401": { code: "provider_error", retryable: false },
    // The read-only token on a write, or a command the plan forbids.
    "403": { code: "provider_error", retryable: false },
    // The daily request cap and the per-second cap both land here.
    "429": { code: "rate_limited", retryable: true },
    // A record over the plan's max request size.
    "413": { code: "too_large", retryable: false },
    "500": { code: "provider_error", retryable: true },
    "502": { code: "provider_error", retryable: true },
    "503": { code: "provider_error", retryable: true },
    "504": { code: "provider_error", retryable: true },
  };

/** What this file uses of the SDK's `Redis` class, and nothing more. */
export interface UpstashRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scan(
    cursor: string,
    options: { count?: number; match: string }
  ): Promise<[string, string[]]>;
  eval(
    script: string,
    keys: string[],
    args: (number | string)[]
  ): Promise<unknown>;
}

export interface UpstashKvOptions {
  /**
   * An already-built client, which short-circuits the SDK import. The test passes a fake
   * through here; a project that needs a non-default SDK option can pass a real one.
   */
  client?: UpstashRedisClient;
  /** Put in front of a policy name to build its limiter bucket. Default `rl:`. */
  limiterPrefix?: string;
}

interface UpstashEnv extends KvEnv {
  UPSTASH_REDIS_REST_TOKEN?: string;
  UPSTASH_REDIS_REST_URL?: string;
}

export function upstash(options: UpstashKvOptions = {}): KvProvider {
  const limiterPrefix = options.limiterPrefix ?? "rl:";

  // Keyed by the `env` object rather than by the token: one request builds one client,
  // and no credential ever becomes a map key. A `WeakMap` lets the isolate drop the
  // client with the env that owns it.
  const clients = new WeakMap<KvEnv, Promise<UpstashRedisClient>>();

  function client(env: KvEnv): Promise<UpstashRedisClient> {
    if (options.client) {
      // Still check the prefix: a caller passing a client must not skip the precondition
      // that keeps `list` off other projects' keys.
      keyPrefix(env);
      return Promise.resolve(options.client);
    }

    const existing = clients.get(env);
    if (existing) {
      return existing;
    }

    const built = build(env);
    clients.set(env, built);
    // A failed build is not cached. A missing secret fails again on the next call anyway,
    // and a transient import failure must not stick for the life of the isolate.
    built.catch(() => {
      if (clients.get(env) === built) {
        clients.delete(env);
      }
    });
    return built;
  }

  async function build(env: KvEnv): Promise<UpstashRedisClient> {
    const { UPSTASH_REDIS_REST_TOKEN: token, UPSTASH_REDIS_REST_URL: url } =
      env as UpstashEnv;

    requireSecret(
      url,
      "UPSTASH_REDIS_REST_URL",
      "the REST URL on your database's page"
    );
    requireSecret(
      token,
      "UPSTASH_REDIS_REST_TOKEN",
      "the read-write REST token"
    );
    keyPrefix(env);

    // Dynamic, and into the `/cloudflare` entry on purpose. The bare `@upstash/redis`
    // specifier resolves to the Node build, which may want `nodejs_compat`; the Workers
    // entry is a thin subclass of the same code. Importing it here rather than at module
    // scope keeps the file loadable — and testable — with the package absent, and costs
    // one resolution on the first call that needs a client.
    const { Redis } = (await import("@upstash/redis/cloudflare")) as {
      Redis: new (config: {
        automaticDeserialization: boolean;
        token: string;
        url: string;
      }) => UpstashRedisClient;
    };

    return new Redis({
      // The core owns the JSON. Left on, the SDK would parse what `set` already encoded
      // and hand `get` an object where the contract promises a string.
      automaticDeserialization: false,
      token: token as string,
      url: url as string,
    });
  }

  return {
    async consume(
      env: KvEnv,
      request: ResolvedConsumeRequest
    ): Promise<ConsumeResult> {
      const { key, policy } = request;
      // The core applies `KV_KEY_PREFIX` inside `client.key()` only, and `consume` takes
      // a raw key, so the prefix goes on here. The policy name is in the bucket too, so
      // two policies over one IP never share a budget.
      const bucket = `${keyPrefix(env)}${limiterPrefix}${policy.name}:${key}`;

      // No `periodSeconds` guard. The 10-or-60 restriction is Cloudflare's binding alone.
      try {
        const redis = await client(env);
        const [count, pttl] = readCounter(
          await redis.eval(CONSUME_SCRIPT, [bucket], [policy.periodSeconds])
        );

        // A refusal is a value, never a throw: a spent budget is the limiter working.
        return {
          remaining: Math.max(0, policy.limit - count),
          resetAt: Date.now() + pttl,
          success: count <= policy.limit,
        };
      } catch (error) {
        throw normalize(error);
      }
    },

    async delete(env: KvEnv, key: string): Promise<void> {
      try {
        // `DEL` on an absent key returns 0 and is not an error.
        const redis = await client(env);
        await redis.del(key);
      } catch (error) {
        throw normalize(error);
      }
    },

    async get(env: KvEnv, key: string): Promise<string | null> {
      try {
        const redis = await client(env);
        const value = await redis.get(key);
        return value ?? null;
      } catch (error) {
        throw normalize(error);
      }
    },

    async list(env: KvEnv, listOptions: KvListOptions): Promise<KvListResult> {
      try {
        const match = scanMatch(keyPrefix(env), listOptions.prefix ?? "");
        if (match === undefined) {
          // The caller's prefix lies outside `KV_KEY_PREFIX`, so every key it could match
          // belongs to another project. Answer the empty result without a request.
          return { complete: true, keys: [] };
        }
        const redis = await client(env);
        const [cursor, keys] = await redis.scan(listOptions.cursor ?? "0", {
          ...(listOptions.limit === undefined
            ? {}
            : { count: listOptions.limit }),
          match,
        });

        // SCAN's own semantics, passed through. `"0"` is the only end-of-scan signal, and
        // a page with no keys and a live cursor is an ordinary iteration over a slot
        // range that held nothing.
        if (cursor === "0") {
          return { complete: true, keys };
        }
        return { complete: false, cursor, keys };
      } catch (error) {
        throw normalize(error);
      }
    },

    minTtlSeconds: MIN_TTL_SECONDS,

    name: "upstash",

    async set(
      env: KvEnv,
      key: string,
      value: string,
      setOptions: KvSetOptions
    ): Promise<void> {
      try {
        // The options object is omitted entirely for a no-expiry write: `{ ex: undefined }`
        // is how a value silently loses its TTL on a rewrite.
        const redis = await client(env);
        await redis.set(
          key,
          value,
          setOptions.ttlSeconds === undefined
            ? undefined
            : { ex: setOptions.ttlSeconds }
        );
      } catch (error) {
        throw normalize(error);
      }
    },
  };
}

/**
 * `KV_KEY_PREFIX`, which this provider requires. Unset or empty it throws, because a
 * `list` with no prefix scans the whole database and returns keys the project does not
 * own. The core treats the variable as optional, so the check lives here.
 */
function keyPrefix(env: KvEnv): string {
  const prefix = env.KV_KEY_PREFIX;
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new KvError(
      "provider_error",
      "KV_KEY_PREFIX is empty or unset, and kv-upstash requires it. One Redis " +
        "database is one flat keyspace, so without a prefix `list` scans every key in " +
        "it, including keys this project does not own. Set it in packages/env/.env, " +
        'run pnpm env:setup, and set it in packages/env/.env.prod for a deploy (e.g. "app:").'
    );
  }
  return prefix;
}

/** Throw `provider_error` naming the missing secret, before any request leaves. */
function requireSecret(
  value: string | undefined,
  name: string,
  where: string
): void {
  if (!value) {
    throw new KvError(
      "provider_error",
      `No \`${name}\` on this Worker's env, so kv-upstash cannot reach Upstash. Copy ` +
        `${where} from https://console.upstash.com, then:\n\n` +
        `  set ${name} in packages/env/.env, run pnpm env:setup   # local\n` +
        `  set ${name} in packages/env/.env.prod         # pnpm deploy:production\n\n` +
        "Never put the token in apps/api/wrangler.jsonc; that file is committed."
    );
  }
}

/**
 * The `MATCH` glob for a `list`, or `undefined` when no key of this project can match.
 *
 * The caller's prefix is the one `client.key()` produced, so it already carries
 * `KV_KEY_PREFIX`, the same as on `kv-memory` and `kv-cloudflare`. The glob is the
 * longer of the two prefixes when one extends the other, so a `list({})` or a prefix
 * shorter than `KV_KEY_PREFIX` still stays inside this project's keys. Two prefixes
 * that diverge share no key.
 */
function scanMatch(
  projectPrefix: string,
  callerPrefix: string
): string | undefined {
  if (callerPrefix.startsWith(projectPrefix)) {
    return `${escapeGlob(callerPrefix)}*`;
  }
  if (projectPrefix.startsWith(callerPrefix)) {
    return `${escapeGlob(projectPrefix)}*`;
  }
  return undefined;
}

/** Escape the characters Redis `MATCH` reads as a glob, so a literal key matches itself. */
function escapeGlob(value: string): string {
  return value.replace(GLOB_SPECIAL, (character) => `\\${character}`);
}

/** `[count, pttl]` out of the Lua reply, which arrives as numbers or numeric strings. */
function readCounter(reply: unknown): [number, number] {
  if (!Array.isArray(reply) || reply.length < 2) {
    throw new KvError(
      "provider_error",
      `The rate limit script returned ${JSON.stringify(reply)}, not [count, pttl].`
    );
  }
  const count = Number(reply[0]);
  const pttl = Number(reply[1]);
  if (!Number.isFinite(count) || !Number.isFinite(pttl)) {
    throw new KvError(
      "provider_error",
      `The rate limit script returned ${JSON.stringify(reply)}, not two numbers.`
    );
  }
  return [count, Math.max(0, pttl)];
}

function normalize(cause: unknown): KvError {
  if (cause instanceof KvError) {
    return cause;
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  const providerCode = readCode(message);
  const mapped = providerCode ? STATUS_CODES[providerCode] : undefined;

  // No HTTP answer at all: DNS, a dropped connection, a timeout, an abort. Nothing
  // reached Redis, so the same call can succeed on a retry.
  const transport = mapped ? undefined : transportCode(cause, message);
  if (transport !== undefined) {
    return new KvError("provider_error", message, {
      cause,
      ...(transport === "" ? {} : { providerCode: transport }),
      retryable: true,
    });
  }

  // Upstash reports an oversize record as a message, not always as a 413.
  const code =
    mapped?.code ??
    (/max request size/i.test(message) ? "too_large" : undefined);

  return new KvError(code ?? "provider_error", message, {
    cause,
    ...(providerCode === undefined ? {} : { providerCode }),
    retryable: mapped?.retryable ?? false,
  });
}

/**
 * Error names, Node `code` values and messages a failed fetch carries, before any HTTP
 * status. `internal error; reference = …` is what workerd throws from `fetch` when the
 * host does not resolve or the connection drops; it carries no code.
 */
const TRANSPORT_NAMES = new Set(["AbortError", "TimeoutError"]);
const TRANSPORT_CODE =
  /^(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR_[A-Z_]+)$/;
const TRANSPORT_MESSAGE =
  /fetch failed|network (?:connection )?(?:error|lost)|timed? ?out|socket hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|^internal error; reference = /i;

/**
 * Whether `cause` is a transport failure rather than an answer from Upstash. Returns the
 * most specific code it carries (a Node `code` such as `ENOTFOUND`, else the error name),
 * `""` when it is a transport failure with no code worth keeping, or `undefined` when it
 * is not one. An `UpstashError` is an answer, never a transport failure.
 */
function transportCode(cause: unknown, message: string): string | undefined {
  if (!(cause instanceof Error) || cause.name === "UpstashError") {
    return undefined;
  }
  const inner = (cause as { cause?: unknown }).cause;
  const codes = [cause, inner].map((error) =>
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined
  );
  const code = codes.find((value) => value && TRANSPORT_CODE.test(value));
  if (code) {
    return code;
  }
  if (TRANSPORT_NAMES.has(cause.name)) {
    return cause.name;
  }
  if (cause.name === "TypeError" && TRANSPORT_MESSAGE.test(message)) {
    return "TypeError";
  }
  if (TRANSPORT_MESSAGE.test(message)) {
    return "";
  }
  return undefined;
}

/**
 * The HTTP status out of an `UpstashError` message, or the leading `ERR`-style token out
 * of a Redis reply (`WRONGTYPE Operation against …`), whichever the message carries.
 */
function readCode(message: string): string | undefined {
  const status = /(?:^|[:\s])(\d{3})\b/.exec(message);
  if (status?.[1]) {
    return status[1];
  }
  const token = /^([A-Z]{3,})\b/.exec(message);
  return token?.[1];
}
