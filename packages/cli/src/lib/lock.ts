import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RefusalError } from "./exit.js";
import { pathExists } from "./fs-utils.js";
import type { ModuleProvenance } from "./registry.js";
import type { Graph } from "./resolve.js";
import { validateLock } from "./schema.js";

// `saasaloy-lock.json` records, for every installed module, the registry source it came
// from and the exact commit SHA it resolved to — the npm-style lock to `saasaloy.json`'s
// intent (ADR 0012). The resolved SHA is the integrity anchor: a re-install against the
// committed lock reproduces identical bytes. Shape: schemas/saasaloy-lock.schema.json.

export const LOCK_FILE = "saasaloy-lock.json";
export const LOCKFILE_VERSION = 1;
const LOCK_SCHEMA_URL =
  "https://saasaloy.dev/schemas/saasaloy-lock.schema.json";

export interface LockModule extends ModuleProvenance {
  /** The module's declared dependencies, so the resolved graph is self-describing. */
  dependsOn?: string[];
  /** The module's declared `conflictsWith`, so `add` can refuse a conflicting module
   *  that goes in second — the descriptor is gone by then, the lock is not. */
  conflictsWith?: string[];
}

export interface Lockfile {
  $schema?: string;
  lockfileVersion: number;
  modules: Record<string, LockModule>;
}

export function emptyLock(): Lockfile {
  return {
    $schema: LOCK_SCHEMA_URL,
    lockfileVersion: LOCKFILE_VERSION,
    modules: {},
  };
}

export async function loadLock(root: string): Promise<Lockfile> {
  const file = join(root, LOCK_FILE);
  if (!(await pathExists(file))) {
    return emptyLock();
  }
  // Unparseable JSON is the same invalid state as a schema miss, so it takes the same
  // exit code. Left to throw, `SyntaxError` reaches `exitCodeFor` as a plain failure (1)
  // and never names the file it came from.
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (error) {
    throw new RefusalError(
      `${LOCK_FILE} is invalid:\n  ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  // The lock is what `update` diffs against and what `add` reads a module's
  // `conflictsWith` back out of, so an entry with no `resolved` SHA or an unknown
  // `lockfileVersion` has to stop the command here (#98). Same posture as `loadConfig`.
  const result = await validateLock(raw);
  if (!result.valid) {
    throw new RefusalError(
      `${LOCK_FILE} is invalid:\n  ${result.errors.join("\n  ")}`
    );
  }
  const parsed = raw as Partial<Lockfile>;
  return {
    $schema: parsed.$schema ?? LOCK_SCHEMA_URL,
    lockfileVersion: parsed.lockfileVersion ?? LOCKFILE_VERSION,
    modules: parsed.modules ?? {},
  };
}

export async function saveLock(root: string, lock: Lockfile): Promise<void> {
  const file = join(root, LOCK_FILE);
  await writeFile(file, `${JSON.stringify(lock, null, 2)}\n`, "utf-8");
}

// Record the modules that were actually applied under one source's provenance —
// intra-repo, so they share the same source/ref/SHA. Only `installed` is written: an
// already-installed dependency keeps the SHA it was fetched at, so the lock never
// misstates the provenance of bytes on disk. `graph` supplies each module's declared
// `dependsOn` and `conflictsWith` — the two lists `remove` and `add` need to read back
// offline, once the descriptor they came from is gone.
export function upsertLock(
  lock: Lockfile,
  provenance: ModuleProvenance,
  installed: string[],
  graph: Graph
): void {
  for (const name of installed) {
    const item = graph.modules.get(name)?.item;
    const dependsOn = item?.dependsOn;
    const conflictsWith = item?.conflictsWith;
    lock.modules[name] = {
      ...provenance,
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
      ...(conflictsWith && conflictsWith.length > 0 ? { conflictsWith } : {}),
    };
  }
}
