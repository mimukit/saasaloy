import { defineLogger } from "./define";
import type { LoggerEnv } from "./provider";

export { defineLogger } from "./define";
export type { Logger, LoggerConfig, LoggerRegistry, LoggerVariables } from "./define";
export type {
  LogEvent,
  LogFields,
  LoggerEnv,
  LogLevel,
  LogProvider,
  SerializedError,
} from "./provider";

// The provider registry, and the patch point every `logger-<provider>` module writes
// into. `saasaloy add logger-console` adds its import and appends `consoleLogger()`
// here — idempotently, so re-running it changes nothing.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal. The codemod behind the `plugin-array` patch kind
// (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and a
// provider install fails silently. Never omit `providers`, even while it's empty.
export const logger = defineLogger({ providers: [] });

/**
 * Get a logger for this request's environment. Mirrors `createEmail(env)`, except nothing
 * here throws on a missing `LOGGER_PROVIDER`: unset selects the first registered provider,
 * and no providers at all yields a no-op logger. Only a `LOGGER_PROVIDER` naming a
 * provider that isn't installed throws.
 *
 * ```ts
 * const log = createLogger(c.env).child({ requestId });
 * log.info("widget created", { widgetId });
 * ```
 *
 * Inside an `apps/api` route, prefer `c.get("log")` — the same logger, already bound to
 * this request's id by the middleware in `apps/api/src/index.ts`. `createLogger(env)` is
 * the escape hatch for code that runs outside a request (a module-scope singleton, a
 * scheduled handler, a queue consumer).
 */
export function createLogger(env: LoggerEnv) {
  return logger.create(env);
}
