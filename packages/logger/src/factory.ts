import { createPinoLogger } from "./providers/pino";
import type { Logger, LoggerConfig } from "./types";

export type LoggerProvider = "pino";

export function createLogger({
  provider = "pino",
  config,
}: {
  provider: LoggerProvider;
  config?: LoggerConfig;
}): Logger {
  switch (provider) {
    case "pino":
      return createPinoLogger(config);
    default:
      throw new Error(`Unknown logger provider: ${provider}`);
  }
}
