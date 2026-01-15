import { type Logger as PinoInstance, pino } from "pino";

import type { LogContext, Logger, LoggerConfig } from "../types";

class PinoLogger implements Logger {
  private instance: PinoInstance;

  constructor(instance: PinoInstance) {
    this.instance = instance;
  }

  debug(message: string, context?: LogContext): void {
    if (context) {
      this.instance.debug(context, message);
    } else {
      this.instance.debug(message);
    }
  }

  info(message: string, context?: LogContext): void {
    if (context) {
      this.instance.info(context, message);
    } else {
      this.instance.info(message);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (context) {
      this.instance.warn(context, message);
    } else {
      this.instance.warn(message);
    }
  }

  error(message: string, context?: LogContext): void {
    if (context) {
      this.instance.error(context, message);
    } else {
      this.instance.error(message);
    }
  }

  fatal(message: string, context?: LogContext): void {
    if (context) {
      this.instance.fatal(context, message);
    } else {
      this.instance.fatal(message);
    }
  }

  child(bindings: LogContext): Logger {
    return new PinoLogger(this.instance.child(bindings));
  }
}

export function createPinoLogger(config?: LoggerConfig): Logger {
  const instance = pino({
    level: config?.level ?? "info",
    name: config?.name,
    base: config?.context,
  });

  return new PinoLogger(instance);
}
