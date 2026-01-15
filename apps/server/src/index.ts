import { api } from "@repo/api";
import "@repo/config/env/server";
import { logger } from "@repo/logger";

logger.info("💡 Server starting...");

const apiServer = api;

export default apiServer;
