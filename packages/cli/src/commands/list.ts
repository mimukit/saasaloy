import { logger } from "../lib/logger.js";

// Phase 1: list module descriptors discovered in the registry (local modules/ dir).
export async function runList(_argv: string[]): Promise<number> {
  logger.error("`saasaloy list` is not implemented yet.");
  return 1;
}
