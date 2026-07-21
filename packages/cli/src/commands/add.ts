import { logger } from "../lib/logger.js";

// Phase 1: local applier — read a module descriptor off disk, resolve dependsOn,
// apply files + deps + patches, and copy the module's skill folder(s) into
// .claude/skills/ (recorded in the manifest so `remove` can undo them). No agent-view
// generation: AGENTS.md is the fixed base file; module guidance ships as skills.
export async function runAdd(_argv: string[]): Promise<number> {
  logger.error("`saasaloy add` is not implemented yet.");
  return 1;
}
