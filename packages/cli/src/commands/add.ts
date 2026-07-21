import { logger } from "../lib/logger.js";

// Phase 1: local applier — read a module descriptor off disk, resolve dependsOn,
// apply files + deps + patches, drop agent fragments/skills, then `sync`.
export async function runAdd(_argv: string[]): Promise<number> {
  logger.error("`saasaloy add` is not implemented yet.");
  return 1;
}
