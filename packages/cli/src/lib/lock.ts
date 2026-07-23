import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "./fs-utils.js";
import type { ModuleProvenance } from "./registry.js";
import type { Graph } from "./resolve.js";

// `saasaloy-lock.json` records, for every installed module, the registry source it came
// from and the exact commit SHA it resolved to — the npm-style lock to `saasaloy.json`'s
// intent (ADR 0012). The resolved SHA is the integrity anchor: a re-install against the
// committed lock reproduces identical bytes. Shape: schemas/saasaloy-lock.schema.json.

export const LOCK_FILE = "saasaloy-lock.json";
export const LOCKFILE_VERSION = 1;
const LOCK_SCHEMA_URL = "https://saasaloy.dev/schemas/saasaloy-lock.schema.json";

export interface LockModule extends ModuleProvenance {
  /** The module's declared dependencies, so the resolved graph is self-describing. */
  dependsOn?: string[];
}

export interface Lockfile {
  $schema?: string;
  lockfileVersion: number;
  modules: Record<string, LockModule>;
}

export function emptyLock(): Lockfile {
  return { $schema: LOCK_SCHEMA_URL, lockfileVersion: LOCKFILE_VERSION, modules: {} };
}

export async function loadLock(root: string): Promise<Lockfile> {
  const file = join(root, LOCK_FILE);
  if (!(await pathExists(file))) return emptyLock();
  const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<Lockfile>;
  return {
    $schema: parsed.$schema ?? LOCK_SCHEMA_URL,
    lockfileVersion: parsed.lockfileVersion ?? LOCKFILE_VERSION,
    modules: parsed.modules ?? {},
  };
}

export async function saveLock(root: string, lock: Lockfile): Promise<void> {
  const file = join(root, LOCK_FILE);
  await writeFile(file, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

// Record the modules that were actually applied under one source's provenance —
// intra-repo, so they share the same source/ref/SHA. Only `installed` is written: an
// already-installed dependency keeps the SHA it was fetched at, so the lock never
// misstates the provenance of bytes on disk. `graph` supplies each module's `dependsOn`.
export function upsertLock(
  lock: Lockfile,
  provenance: ModuleProvenance,
  installed: string[],
  graph: Graph,
): void {
  for (const name of installed) {
    const dependsOn = graph.modules.get(name)?.item.dependsOn;
    lock.modules[name] = {
      ...provenance,
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    };
  }
}
