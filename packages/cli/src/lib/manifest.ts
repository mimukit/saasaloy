import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathExists } from "./fs-utils.js";
import type { RegistryPatch } from "./schema.js";

// `.saasaloy/manifest.json` records every file a module applied — copied source
// files and copied skill files — by owning module and content hash. On update the
// tool re-hashes a managed file: match → safe overwrite; drift → route to AI-merge.
// This replaces in-file `// saasaloy:managed` markers (see build spec §2.9 / §3.2).
// Shape is validated by schemas/manifest.schema.json (see lib/schema.ts).

export interface ManagedEntry {
  /** Name of the module that applied this file. */
  module: string;
  hash: string;
}

// A structural config patch that actually landed on disk, recorded so `remove` can undo
// it — or, for a kind with no inverse yet, warn the user which file it can't clean up
// (see the `PlannedPatch` comment in applier.ts). `patch` is the op as authored, which is
// what `reversePatch` reads: a `chained-route` entry is reversible from this record alone,
// the other kinds wait on issue #36.
export interface ManifestPatch {
  /** Name of the module that applied this patch. */
  module: string;
  /** Project-relative POSIX path of the file that was patched. */
  file: string;
  /** The op as authored (kind + payload + file). */
  patch: RegistryPatch;
}

export interface Manifest {
  managed: Record<string, ManagedEntry>;
  links: Record<string, string>;
  patches: ManifestPatch[];
}

export const MANIFEST_FILE = join(".saasaloy", "manifest.json");

/**
 * Every module the tool has actually applied to this project, read off what it recorded.
 * A name in `saasaloy.json` `installed[]` that is absent here came from the scaffold
 * template (`web`) or a hand edit: the tool never installed it, so it has no descriptor,
 * no lock entry, and nothing to say about conflicts.
 */
export function managedModules(manifest: Manifest): Set<string> {
  const names = new Set<string>();
  for (const entry of Object.values(manifest.managed)) names.add(entry.module);
  for (const entry of manifest.patches) names.add(entry.module);
  return names;
}

export function emptyManifest(): Manifest {
  return { managed: {}, links: {}, patches: [] };
}

export async function loadManifest(root: string): Promise<Manifest> {
  const file = join(root, MANIFEST_FILE);
  if (!(await pathExists(file))) {
    return emptyManifest();
  }
  const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<Manifest>;
  return {
    managed: parsed.managed ?? {},
    links: parsed.links ?? {},
    patches: parsed.patches ?? [],
  };
}

export async function saveManifest(root: string, manifest: Manifest): Promise<void> {
  const file = join(root, MANIFEST_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
