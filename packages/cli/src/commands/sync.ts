import { join } from "node:path";
import { loadAgentConfig } from "../lib/agent-config.js";
import { compileAgentViews } from "../lib/agent-views.js";
import { pathExists } from "../lib/fs-utils.js";
import { loadManifest, saveManifest } from "../lib/manifest.js";
import { findProjectRoot } from "../lib/project.js";
import { logger } from "../lib/logger.js";

// `saasaloy sync` — regenerate every agent-tool view from the canonical .agents/
// source: concat AGENTS.md, one-line CLAUDE.md import, and .claude/skills links.
// Managed outputs and the link map are recorded in .saasaloy/manifest.json.

export async function runSync(): Promise<number> {
  const root = await findProjectRoot();
  const config = await loadAgentConfig(root);
  const sourceDir = join(root, config.source);

  if (!(await pathExists(sourceDir))) {
    logger.error(`No canonical agent source found at ${config.source}/.`);
    logger.step("Nothing to sync. Run this from a Saasaloy project root.");
    return 1;
  }

  const result = await compileAgentViews(root, config);

  // Preserve manifest entries owned by modules; replace only the agent-compiled ones.
  const manifest = await loadManifest(root);
  for (const [path, entry] of Object.entries(manifest.managed)) {
    if (entry.source !== "agent-compile") continue;
    if (!(path in result.managed)) delete manifest.managed[path];
  }
  manifest.managed = { ...manifest.managed, ...result.managed };
  manifest.links = result.links;
  await saveManifest(root, manifest);

  logger.success(
    `synced ${result.fragmentCount} fragment(s) → ${config.concat.map((t) => t.path).join(", ")}`,
  );
  const linkCount = Object.keys(result.links).length;
  if (result.skillCount > 0) {
    logger.step(`linked ${linkCount} skill(s) into ${config.skills.map((s) => s.dir).join(", ")}`);
  }
  return 0;
}
