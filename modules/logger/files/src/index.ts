import { defineLogger } from "./define";
import type { LoggerEnv } from "./provider";
import { loggerProviders } from "./providers.generated";

export { defineLogger } from "./define";
export type {
  Logger,
  LoggerConfig,
  LoggerRegistry,
  LoggerVariables,
} from "./define";
export type {
  LogEvent,
  LogFields,
  LoggerEnv,
  LogLevel,
  LogProvider,
  SerializedError,
} from "./provider";

// The provider registry. Every `logger-<provider>` module adds a row to the
// `logger.providers` table, and the CLI writes `./providers.generated.ts` from those rows
// on every run: `saasaloy add logger-console` adds `consoleLogger()`, and `saasaloy remove`
// takes it back out. A provider of your own goes after the spread, never in the generated
// file: the CLI overwrites it, and `saasaloy update` refuses when it was edited.
export const logger = defineLogger({ providers: [...loggerProviders] });

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
