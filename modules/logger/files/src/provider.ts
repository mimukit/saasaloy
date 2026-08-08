// The provider contract every `logger-<provider>` module implements, plus the shapes the
// core normalizes into before a provider ever sees them. Nothing in this file imports a
// vendor SDK or a Workers binding — the core of `packages/logger` is provider-agnostic
// and has zero runtime dependencies (ADR 0001's amendment, ADR 0020).

/**
 * The Worker environment, handed to `createLogger(env)` whole rather than one binding at
 * a time. Deliberately opaque: *which* key a provider reads (an analytics binding, an
 * ingest token, nothing at all) is exactly what the calling route must not have to know
 * for providers to stay swappable.
 */
export interface LoggerEnv {
  /**
   * Which registered provider writes. **Optional**, unlike `EMAIL_PROVIDER`: unset falls
   * back to the first registered provider. A logger that throws at boot is an outage
   * caused by the observability layer; a logger that goes quiet is loudly visible in the
   * absence of its own lines. Only a value naming a provider that isn't registered throws.
   */
  LOGGER_PROVIDER?: string;
  /** Minimum level to emit, one of `LogLevel`. Defaults to `info`; unknown values fall back to it. */
  LOG_LEVEL?: string;
  [key: string]: unknown;
}

/**
 * Six levels, syslog-shaped. `fatal` has no distinct behaviour on Workers — nothing exits
 * the process — but it costs one union member, and leaving it out means any project that
 * wants it has to patch this type.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Structured context attached to an event, either bound via `child()` or passed at the
 * call site. Values are whatever `console` can serialize; Workers Logs indexes the
 * top-level ones as queryable fields.
 */
export type LogFields = Record<string, unknown>;

/**
 * An `Error` flattened into something a log sink can actually carry. `JSON.stringify(new
 * Error())` is `{}` — `name`, `message` and `stack` are all non-enumerable — so an
 * unserialized error reaches a sink as an empty object. The core does this once, in
 * `define.ts`, rather than leaving each provider to rediscover it.
 */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  /** `error.cause`, serialized one level deep. Not recursed further: a cause chain can be a cycle. */
  cause?: SerializedError;
}

/**
 * What a provider actually receives. The core resolves the level threshold, merges bound
 * and call-site fields, applies redaction, stamps the time and serializes `err` first, so
 * no provider re-implements any of that.
 */
export interface LogEvent {
  level: LogLevel;
  message: string;
  /** ISO 8601, stamped by the core at call time. */
  time: string;
  /** Bound fields merged with call-site fields, call site winning, post-redaction. */
  fields: LogFields;
  /** Present when the caller passed an `Error` as the `err` field. */
  err?: SerializedError;
}

export interface LogProvider {
  /** The value `LOGGER_PROVIDER` must hold to select this provider (e.g. "console"). */
  name: string;
  /**
   * Write one normalized event. **Synchronous, returning `void`** — the deliberate
   * difference from `EmailProvider.send`. A log call is not a thing a caller awaits, and
   * an async `write` would either force `await log.info(...)` at every call site or leak a
   * floating promise on a Worker that may be killed before it settles. A provider that
   * ships logs off-box owns its own batching behind this signature.
   *
   * There is no `ExecutionContext` argument on purpose, not by oversight: nothing that
   * ships today needs `waitUntil`, and adding a parameter nothing uses invites a call site
   * that threads it through for no reason. Widening later — `createLogger(env, ctx?)` →
   * `write(env, event, ctx?)` — is non-breaking for every provider written against this
   * signature, so the seam stays open without being pre-paid.
   *
   * Throwing from here cannot take down a request: the core wraps every call in a
   * `try/catch` and swallows the failure. A logger that throws is a self-inflicted outage.
   */
  write(env: LoggerEnv, event: LogEvent): void;
}
