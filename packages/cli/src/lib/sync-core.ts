import type { AgentConfig } from "./agent-config.js";
import { loadAgentConfig } from "./agent-config.js";
import type { SyncResult } from "./agent-views.js";
import { compileAgentViews } from "./agent-views.js";
import { loadManifest, saveManifest } from "./manifest.js";

// Shared by the `sync` command and `init`: compile the agent views for a project
// root and reconcile them into the manifest. Module-owned managed entries are
// preserved; only stale agent-compiled ones are dropped.
export async function syncProject(root: string, config?: AgentConfig): Promise<SyncResult> {
  const cfg = config ?? (await loadAgentConfig(root));
  const result = await compileAgentViews(root, cfg);

  const manifest = await loadManifest(root);
  for (const [path, entry] of Object.entries(manifest.managed)) {
    if (entry.source === "agent-compile" && !(path in result.managed)) {
      delete manifest.managed[path];
    }
  }
  manifest.managed = { ...manifest.managed, ...result.managed };
  manifest.links = result.links;
  await saveManifest(root, manifest);

  return result;
}
