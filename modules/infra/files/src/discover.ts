import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

// Repo root is two levels up from `infra/src/` (`infra/` sits at the repo root, a
// sibling of `apps/` and `packages/` — see `modules/infra/registry-item.json`'s
// `scaffolds[].workspace: "infra"`).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICE_ROOTS = ["apps", "packages"];

export interface WranglerConfig {
  name?: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  vars?: Record<string, string>;
  d1_databases?: Array<{
    binding: string;
    database_name: string;
    database_id: string;
    migrations_dir?: string;
  }>;
  [key: string]: unknown;
}

export interface DiscoveredService {
  /** The wrangler.jsonc "name" field, falling back to the workspace directory name. */
  name: string;
  /** Absolute path to the service's workspace directory (e.g. `<root>/apps/api`). */
  dir: string;
  /** Parsed wrangler.jsonc contents. */
  config: WranglerConfig;
}

/**
 * Find every `wrangler.jsonc` one level under `apps/` or `packages/` and parse each
 * with `jsonc-parser` — the same library the CLI's own config-patch engine uses
 * (ADR 0010), so `infra` never grows a second JSON-with-comments parser. A workspace
 * with no `wrangler.jsonc` isn't a deployable service and is silently skipped; one that
 * has a `wrangler.jsonc` but fails to parse throws (fail loud, don't guess at intent).
 */
export async function discoverServices(): Promise<DiscoveredService[]> {
  const services: DiscoveredService[] = [];

  for (const root of SERVICE_ROOTS) {
    const rootDir = join(REPO_ROOT, root);
    let entries: string[];
    try {
      entries = await readdir(rootDir);
    } catch {
      continue; // no apps/ or packages/ workspace yet — nothing to discover there
    }

    for (const entry of entries) {
      const dir = join(rootDir, entry);
      const configPath = join(dir, "wrangler.jsonc");
      const source = await readFile(configPath, "utf8").catch(() => null);
      if (source === null) continue; // no wrangler.jsonc — not a deployable service

      const config = parse(source) as WranglerConfig | undefined;
      if (!config || typeof config !== "object") {
        throw new Error(`infra: ${configPath} is not valid JSON(C) — fix it before deploying.`);
      }

      services.push({ name: config.name ?? entry, dir, config });
    }
  }

  return services;
}
