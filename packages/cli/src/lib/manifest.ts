import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathExists } from "./fs-utils.js";

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

export interface Manifest {
  managed: Record<string, ManagedEntry>;
  links: Record<string, string>;
}

export const MANIFEST_FILE = join(".saasaloy", "manifest.json");

export function emptyManifest(): Manifest {
  return { managed: {}, links: {} };
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
  };
}

export async function saveManifest(root: string, manifest: Manifest): Promise<void> {
  const file = join(root, MANIFEST_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
