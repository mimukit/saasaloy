import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RefusalError } from "./exit.js";
import { pathExists } from "./fs-utils.js";
import { validateManifest } from "./schema.js";
import type { RegistryPatch, When } from "./schema.js";

// `.saasaloy/manifest.json` records every file a module applied — copied source
// files and copied skill files — by owning module and content hash. On update the
// tool re-hashes a managed file: match → safe overwrite; drift → route to AI-merge.
// This replaces in-file `// saasaloy:managed` markers (see build spec §2.9 / §3.2).
// Shape is validated by schemas/manifest.schema.json (see lib/schema.ts).

export interface ManagedEntry {
  /** Name of the module that applied this file. */
  module: string;
  hash: string;
  /**
   * The hash is of bytes found on disk, not bytes the tool wrote (`adoptBase`). Those
   * bytes may hold hand edits the tool knows nothing about, so an adopted entry never
   * earns the `overwrite` verdict: `classifyUpdate` sends it to the merge plan instead.
   * Dropped the first time the tool writes the file itself, which is when the recorded
   * hash finally describes template output.
   */
  adopted?: boolean;
  /**
   * Module-relative source path this file was copied from (e.g. `files/lib/email.ts`).
   * `update` needs it to fetch the same file at two commit SHAs, which the hash alone
   * can't express. Optional: entries written before this shipped don't carry it, and
   * `update` falls back to re-deriving the target from the descriptor (issue #48).
   */
  from?: string;
  /**
   * The descriptor `when` this file was written under (#242). `remove X` reads it offline
   * to find another module's entries that only shipped because `X` was installed.
   */
  when?: When;
  /**
   * sha256 of the module's version a merge took in. Set by `saasaloy update --resolved`
   * (#223), whose `hash` is then of the merged bytes, a person's edits included. While the
   * module still ships that version there is nothing to merge; once it moves, the file
   * goes to the merge plan rather than being overwritten. Dropped the first time the tool
   * writes the file itself.
   */
  mergedWith?: string;
}

// A structural config patch that actually landed on disk, recorded so `remove` can undo
// it — or, for a kind with no inverse, warn the user which file it can't clean up (see
// the `PlannedPatch` comment in applier.ts). `patch` is the op as authored, which is all
// `reversePatch` reads: the four config kinds are reversible from this record alone, and
// the record carries no pre-patch content or hash, so drift is detected structurally
// against the recorded payload rather than by comparison (#36).
export interface ManifestPatch {
  /** Name of the module that applied this patch. */
  module: string;
  /** Project-relative POSIX path of the file that was patched. */
  file: string;
  /** The op as authored (kind + payload + file, and its `when` when it has one). */
  patch: RegistryPatch;
  /** The op's `when`, repeated at the top level so `remove` reads it like a file's (#242). */
  when?: When;
}

export interface Manifest {
  managed: Record<string, ManagedEntry>;
  links: Record<string, string>;
  patches: ManifestPatch[];
  /** Module name to warnings shown before removal. */
  removeWarnings: Record<string, string[]>;
}

export const MANIFEST_FILE = join(".saasaloy", "manifest.json");

/**
 * Structural equality on the (module, file, patch) triple — good enough since both sides
 * are parsed from the same registry-item.json descriptor, so key order is stable across a
 * `--force` re-apply. `add` dedupes new entries with it; `remove` untracks with it, and
 * needs the structural form rather than reference identity because the plan it walks and
 * the manifest it edits can be separate loads of the same file.
 */
export function samePatchEntry(a: ManifestPatch, b: ManifestPatch): boolean {
  return (
    a.module === b.module &&
    a.file === b.file &&
    JSON.stringify(a.patch) === JSON.stringify(b.patch)
  );
}

/** What `recordManagedFile` needs to write one `managed` entry. */
export interface ManagedFileRecord {
  /**
   * True only for a file the tool adopted off disk rather than wrote. Passing `false` or
   * leaving it out drops the field, which is the drop rule in `ManagedEntry` made
   * structural: a real write cannot carry `adopted` forward by accident.
   */
  adopted?: boolean;
  from?: string;
  hash: string;
  /** See `ManagedEntry.mergedWith`. Left out on every write the tool makes itself. */
  mergedWith?: string;
  module: string;
  /** Project-relative POSIX path of the file on disk. */
  target: string;
  /** The descriptor `when` the file was written under; omitted for an unconditional one. */
  when?: When;
}

/**
 * Write one `managed` entry. Every caller that lands a file — `applier`, `updater`,
 * `base` — records it here, so the entry shape is owned by this file rather than
 * re-derived at each write site (#150).
 */
export function recordManagedFile(
  manifest: Manifest,
  record: ManagedFileRecord
): void {
  manifest.managed[record.target] = {
    hash: record.hash,
    module: record.module,
    ...(record.adopted ? { adopted: true } : {}),
    ...(record.from === undefined ? {} : { from: record.from }),
    ...(record.when === undefined ? {} : { when: record.when }),
    ...(record.mergedWith === undefined
      ? {}
      : { mergedWith: record.mergedWith }),
  };
}

/** Drop one `managed` entry. The file becomes plain user-owned content. */
export function untrackManagedFile(manifest: Manifest, target: string): void {
  delete manifest.managed[target];
}

/**
 * Append a patch entry unless an equal one is already tracked. The dedupe is what makes a
 * `--force` re-apply idempotent: the same op lands again and the manifest still lists it
 * once, so `remove` reverses it once.
 */
export function recordPatch(manifest: Manifest, entry: ManifestPatch): void {
  if (manifest.patches.some((existing) => samePatchEntry(existing, entry))) {
    return;
  }
  // The top-level `when` is copied from the op, so a caller cannot record one that
  // disagrees with the op it describes (#242, A7).
  const when = entry.patch.when;
  manifest.patches.push({
    file: entry.file,
    module: entry.module,
    patch: entry.patch,
    ...(when === undefined ? {} : { when }),
  });
}

/** Drop every patch entry structurally equal to `entry`. */
export function untrackPatch(manifest: Manifest, entry: ManifestPatch): void {
  manifest.patches = manifest.patches.filter(
    (patch) => !samePatchEntry(patch, entry)
  );
}

/** Record a skill link: `target` is the real folder, `path` is the link that points at it. */
export function recordLink(
  manifest: Manifest,
  target: string,
  path: string
): void {
  manifest.links[target] = path;
}

/** Drop one link record (ADR 0015 symmetry with `add`). */
export function untrackLink(manifest: Manifest, target: string): void {
  delete manifest.links[target];
}

export function emptyManifest(): Manifest {
  return { links: {}, managed: {}, patches: [], removeWarnings: {} };
}

export async function loadManifest(root: string): Promise<Manifest> {
  const file = join(root, MANIFEST_FILE);
  if (!(await pathExists(file))) {
    return emptyManifest();
  }
  // A half-written file parses as nothing at all, which is as invalid as a bad hash and
  // takes the same exit code. Left to throw, `SyntaxError` reaches `exitCodeFor` as a
  // plain failure (1) and never names the file it came from.
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (error) {
    throw new RefusalError(
      `${MANIFEST_FILE} is invalid:\n  ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  // This file decides whether a target is safe to overwrite, so a hash that isn't a
  // digest or a half-written entry has to stop the command rather than reach the applier
  // as a typed object that lies about its shape (#98). Same posture as `loadConfig`.
  const result = await validateManifest(raw);
  if (!result.valid) {
    throw new RefusalError(
      `${MANIFEST_FILE} is invalid:\n  ${result.errors.join("\n  ")}`
    );
  }
  const parsed = raw as Partial<Manifest>;
  return {
    links: parsed.links ?? {},
    managed: parsed.managed ?? {},
    patches: parsed.patches ?? [],
    removeWarnings: parsed.removeWarnings ?? {},
  };
}

export async function saveManifest(
  root: string,
  manifest: Manifest
): Promise<void> {
  const file = join(root, MANIFEST_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}
