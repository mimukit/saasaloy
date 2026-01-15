import { createLogger } from "./factory";

const logger = createLogger({
  provider: "pino",
  config: {
    level: "info",
    name: "SaasAloy",
  },
});

export { logger };
