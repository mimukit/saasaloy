import type {
  LogEvent,
  LogFields,
  LoggerEnv,
  LogLevel,
  LogProvider,
  SerializedError,
} from "./provider";

// The provider registry and the `createLogger(env)` factory behind it. This file holds
// everything that is true of *every* provider — selection, the level threshold, field
// merging, `child()`, error serialization and redaction — so a provider module only ever
// ships a `write()`.

/** Numeric ordering for the level threshold. Syslog-shaped; the values are private. */
const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const DEFAULT_LEVEL: LogLevel = "info";

/**
 * Redaction is **on by default**, because retrofitting it after call-site habits exist is
 * the harder order. Keys are matched case-insensitively and exactly — `Authorization` and
 * `AUTHORIZATION` are caught, `authorizationHeader` is not. Extend the list per project
 * with `defineLogger({ redact })`, which unions with this rather than replacing it.
 */
const DEFAULT_REDACT_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "password",
  "secret",
  "api_key",
];

const REDACTED = "[redacted]";

export interface LoggerConfig {
  providers: LogProvider[];
  /** Extra field names to redact, unioned with the built-in deny-list above. */
  redact?: string[];
}

/**
 * What a caller logs with. Returned by `createLogger(env)`, and by `child()`.
 *
 * The call shape is `log.info(message, fields?)` — **message first**, deliberately not
 * pino's `log.info(obj, msg)`, which is an artifact of its printf `mergingObject` history.
 * There is no printf interpolation: `%s` is a formatting concern, so the caller composes
 * the string and puts the values in `fields`, where a log sink can index them.
 */
export interface Logger {
  /** The selected provider's name, or `"none"` when nothing is registered. */
  provider: string;
  /** The resolved threshold, after `LOG_LEVEL`. Handy for guarding expensive field construction. */
  level: LogLevel;
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
  /**
   * A logger with `fields` merged into every event it writes. This is the correlation
   * mechanism — `apps/api` binds `{ requestId }` once per request and every line from that
   * request carries it.
   */
  child(fields: LogFields): Logger;
}

export interface LoggerRegistry {
  providers: LogProvider[];
  create(env: LoggerEnv): Logger;
}

/**
 * The Hono context-variable shape to compose into a route's generic, so `c.get("log")` is
 * typed without that route importing `apps/api`'s entry (which would be a cycle — the
 * entry globs the routes). Mirrors `DbBindings` from `@repo/db/client`:
 *
 *   new Hono<{ Variables: LoggerVariables }>()
 *
 * `apps/api`'s middleware is what actually sets it.
 */
export type LoggerVariables = { log: Logger };

/**
 * Build the provider registry. The `providers` array is the patch point every
 * `logger-<provider>` module appends to — see `src/index.ts`.
 */
export function defineLogger(config: LoggerConfig): LoggerRegistry {
  const providers = config.providers;
  const redactKeys = new Set(
    [...DEFAULT_REDACT_KEYS, ...(config.redact ?? [])].map((key) => key.toLowerCase()),
  );

  return {
    providers,
    create(env: LoggerEnv): Logger {
      const provider = selectProvider(providers, env.LOGGER_PROVIDER);
      const level = parseLevel(env.LOG_LEVEL);
      const threshold = LEVELS[level];

      function build(bound: LogFields): Logger {
        function emit(eventLevel: LogLevel, message: string, fields?: LogFields): void {
          if (LEVELS[eventLevel] < threshold) return;
          // No provider registered: a silent no-op, never a throw. See `selectProvider`.
          if (!provider) return;

          // Normalization lives *inside* the boundary, not above it: a caller's `fields` can
          // carry a throwing getter or a proxy, so the spread, the error flattening and the
          // redaction walk are all as capable of throwing as `write()` is. Building the event
          // outside the `try` would let a hostile field object fail the request the log line
          // was only describing.
          try {
            // Call-site fields win over bound ones, so a child's `requestId` can still be
            // overridden at a single call site that means a different request.
            const merged: LogFields = { ...bound, ...fields };
            const err = takeError(merged);

            const event: LogEvent = {
              level: eventLevel,
              message,
              time: new Date().toISOString(),
              fields: redact(merged, redactKeys),
            };
            if (err) event.err = err;

            provider.write(env, event);
          } catch {
            // Swallowed on purpose, and swallowed *silently* — there is no `EmailError`
            // equivalent here because a logger that throws is a self-inflicted outage, and
            // reporting the failure through `console` would be the very thing that just
            // failed. A broken sink costs its lines, not the request.
          }
        }

        return {
          provider: provider?.name ?? "none",
          level,
          trace: (message, fields) => emit("trace", message, fields),
          debug: (message, fields) => emit("debug", message, fields),
          info: (message, fields) => emit("info", message, fields),
          warn: (message, fields) => emit("warn", message, fields),
          error: (message, fields) => emit("error", message, fields),
          fatal: (message, fields) => emit("fatal", message, fields),
          child: (fields: LogFields) => build({ ...bound, ...fields }),
        };
      }

      return build({});
    },
  };
}

/**
 * `LOGGER_PROVIDER` is **optional**, the deliberate divergence from `EMAIL_PROVIDER`:
 * unset selects the first registered provider, and no providers at all yields a no-op
 * logger rather than an error. Only a value naming a provider that isn't registered
 * throws, because that one is unambiguously a typo in a deploy config.
 *
 * The asymmetry is the point. Mail that silently stops sending is invisible; logs that
 * silently stop are their own alarm, and throwing at boot would mean the observability
 * layer caused the outage.
 */
function selectProvider(
  providers: LogProvider[],
  selected: string | undefined,
): LogProvider | undefined {
  if (!selected) return providers[0];

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    const registered = providers.map((p) => p.name);
    const known =
      registered.length > 0
        ? `Registered providers: ${registered.join(", ")}.`
        : "No providers are registered — install one, e.g. `saasaloy add logger-console`.";
    throw new Error(`LOGGER_PROVIDER is "${selected}", which is not registered. ${known}`);
  }
  return provider;
}

/**
 * An unrecognized `LOG_LEVEL` falls back to `info` silently — a bad value must not be an
 * outage.
 *
 * The membership test is `Object.hasOwn`, not a bare `LEVELS[normalized]` lookup: a bare
 * lookup resolves inherited `Object.prototype` keys, so `LOG_LEVEL=constructor` (or
 * `__proto__`, `toString`, …) would pass the guard and leave `threshold` non-numeric —
 * every comparison against it false, every level emitted, `trace` and `debug` included.
 */
function parseLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_LEVEL;
  return Object.hasOwn(LEVELS, normalized) ? (normalized as LogLevel) : DEFAULT_LEVEL;
}

/**
 * Pull an `Error` passed as the `err` field out of the merged fields and flatten it, so
 * providers never see a raw `Error` — `JSON.stringify(new Error())` is `{}`. A non-`Error`
 * `err` is left in `fields` untouched: flattening a string into `{name, message}` would
 * invent structure the caller didn't have.
 */
function takeError(fields: LogFields): SerializedError | undefined {
  const value = fields.err;
  if (!(value instanceof Error)) return undefined;
  delete fields.err;
  return serializeError(value, true);
}

function serializeError(error: Error, withCause: boolean): SerializedError {
  const serialized: SerializedError = { name: error.name, message: error.message };
  if (error.stack) serialized.stack = error.stack;
  // Exactly one level of `cause`. A cause chain can be arbitrarily long or cyclic, and an
  // unbounded walk inside a log call is CPU a request pays for.
  if (withCause && error.cause instanceof Error) {
    serialized.cause = serializeError(error.cause, false);
  }
  return serialized;
}

/**
 * Replace denied values with `[redacted]`, at the top level and **one level below it**.
 * Bounded on purpose: an unbounded deep walk is CPU on every log call, and the fields a
 * route actually logs are flat or nearly so. Anything that isn't a plain object — a
 * `Headers`, a `Date`, a class instance, an array — passes through untouched, so a secret
 * inside one is not caught. The `saasaloy-logger` skill says so plainly.
 */
function redact(fields: LogFields, keys: Set<string>): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (keys.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = isPlainObject(value) ? redactShallow(value, keys) : value;
  }
  return out;
}

function redactShallow(value: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = keys.has(key.toLowerCase()) ? REDACTED : nested;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
