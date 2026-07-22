import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists } from "./fs-utils.js";
import type { RegistryItem } from "./schema.js";
import { validateRegistryItem } from "./schema.js";

// The registry is the local `modules/` directory — each subfolder holds one module's
// `registry-item.json` descriptor plus the files it drops in (build spec §2.4, §3.3).
// v1 reads it off disk; the graduation to a remote registry is one line (readFile →
// fetch), so this module is the single seam that knows *where* descriptors live.

// Override the registry location — used by tests and by anyone pointing the applier
// at a checkout other than the bundled one.
export const REGISTRY_ENV = "SAASALOY_REGISTRY_DIR";

// Candidate `modules/` locations relative to this file at runtime (dist/index.js):
//   ../modules        → bundled beside dist when the CLI is packaged
//   ../../../modules   → the repo-root modules/ during local development
const CANDIDATE_DIRS = ["../modules", "../../../modules"];

/** Locate the registry directory: explicit env override, else the first candidate that exists. */
export async function findRegistryDir(): Promise<string> {
  const override = process.env[REGISTRY_ENV];
  if (override) {
    const dir = isAbsolute(override) ? override : resolve(process.cwd(), override);
    if (!(await pathExists(dir))) {
      throw new Error(`${REGISTRY_ENV}=${override} does not exist.`);
    }
    return dir;
  }
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of CANDIDATE_DIRS) {
    const dir = resolve(here, candidate);
    if (await pathExists(dir)) return dir;
  }
  throw new Error(
    `Could not find the modules/ registry. Set ${REGISTRY_ENV} to point at it.`,
  );
}

export interface LoadedModule {
  /** Absolute path to the module's folder (source of `files[].path`). */
  dir: string;
  item: RegistryItem;
}

/** Read + validate one module descriptor by name. `requiredBy` sharpens the error when a dependency is missing. */
export async function readModule(
  registryDir: string,
  name: string,
  requiredBy?: string,
): Promise<LoadedModule> {
  const dir = join(registryDir, name);
  const file = join(dir, "registry-item.json");
  if (!(await pathExists(file))) {
    const because = requiredBy ? ` (required by ${requiredBy})` : "";
    throw new Error(`Unknown module "${name}"${because} — no ${name}/registry-item.json in the registry.`);
  }
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  const result = await validateRegistryItem(parsed);
  if (!result.valid) {
    throw new Error(`Module "${name}" has an invalid descriptor:\n  ${result.errors.join("\n  ")}`);
  }
  const item = parsed as RegistryItem;
  if (item.name !== name) {
    throw new Error(
      `Module folder "${name}" declares name "${item.name}" — the folder and descriptor name must match.`,
    );
  }
  return { dir, item };
}
