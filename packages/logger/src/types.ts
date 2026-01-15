export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  child(bindings: LogContext): Logger;
  debug(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
}

export interface LoggerConfig {
  context?: LogContext;
  level?: LogLevel;
  name?: string;
}
