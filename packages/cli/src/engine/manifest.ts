import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RefusalError } from "../lib/exit.js";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { emptyLock } from "../lib/lock.js";
import type { LockModule, Lockfile } from "../lib/lock.js";
import { MANIFEST_FILE } from "../lib/manifest.js";
import type { PendingNote } from "../lib/manifest.js";
import type { ModuleProvenance } from "../lib/registry.js";
import { validateManifestV2 } from "../lib/schema.js";
import type { FileClass } from "./classes.js";
import type { Payload } from "./payload.js";
import type { RenderResult } from "./render.js";

// Manifest version 2 and the lock's `requested` list (plan 0116, "Formats"). The render
// engine reads and writes these; the old engine keeps `lib/manifest.ts` (version 1) until
// Phase 6 deletes it. Both live at `.saasaloy/manifest.json`. A version 1 file has no
// `version` key, and each schema refuses the other's fields, so neither CLI misreads the
// other's file.

export const MANIFEST_VERSION = 2;

/** One file the engine wrote. */
export interface FileRecord {
  module: string;
  from: string;
  class: FileClass;
  /** sha256 of the raw render, before Prettier. Never of the bytes on disk. */
  hash: string;
  /** The release that wrote this render. */
  version: string;
}

export interface ManifestV2 {
  version: 2;
  files: Record<string, FileRecord>;
  /** Files a run left with conflict markers. */
  pendingMerges: string[];
  pendingNotes: PendingNote[];
  doneNotes: string[];
}

export function emptyManifestV2(): ManifestV2 {
  return {
    doneNotes: [],
    files: {},
    pendingMerges: [],
    pendingNotes: [],
    version: MANIFEST_VERSION,
  };
}

/** What `loadManifestV2` found at `.saasaloy/manifest.json`. */
export type ManifestState =
  { kind: "none" } | { kind: "v1" } | { kind: "v2"; manifest: ManifestV2 };

/**
 * Read `.saasaloy/manifest.json` as the engine needs it. A missing file is a project the
 * engine has not written yet. A version 1 file comes back as `v1` for the conversion of
 * Phase 5; a file that is neither refuses with exit 2.
 */
export async function readManifestState(root: string): Promise<ManifestState> {
  const file = join(root, MANIFEST_FILE);
  if (!(await pathExists(file))) {
    return { kind: "none" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (error) {
    throw new RefusalError(
      `${MANIFEST_FILE} is invalid:\n  ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    !("version" in raw) &&
    "managed" in raw
  ) {
    return { kind: "v1" };
  }
  const result = await validateManifestV2(raw);
  if (!result.valid) {
    throw new RefusalError(
      `${MANIFEST_FILE} is invalid:\n  ${result.errors.join("\n  ")}`
    );
  }
  const parsed = raw as Partial<ManifestV2> & { files: ManifestV2["files"] };
  return {
    kind: "v2",
    manifest: {
      doneNotes: parsed.doneNotes ?? [],
      files: parsed.files,
      pendingMerges: parsed.pendingMerges ?? [],
      pendingNotes: parsed.pendingNotes ?? [],
      version: MANIFEST_VERSION,
    },
  };
}

/**
 * The version 2 manifest, or an empty one when the project has none. A version 1 file
 * refuses: the conversion (plan 0116, Phase 5) runs before the engine reads it.
 */
export async function loadManifestV2(root: string): Promise<ManifestV2> {
  const state = await readManifestState(root);
  if (state.kind === "v1") {
    throw new RefusalError(
      `${MANIFEST_FILE} is a version 1 manifest. Run \`saasaloy update\` first: it converts the project to version 2.`
    );
  }
  return state.kind === "v2" ? state.manifest : emptyManifestV2();
}

/** The manifest as JSON text, files sorted by path, so a re-run writes the same bytes. */
export function serializeManifestV2(manifest: ManifestV2): string {
  const files: Record<string, FileRecord> = {};
  for (const path of Object.keys(manifest.files).toSorted()) {
    const record = manifest.files[path];
    if (record) {
      files[path] = {
        class: record.class,
        from: record.from,
        hash: record.hash,
        module: record.module,
        version: record.version,
      };
    }
  }
  const out: ManifestV2 = {
    version: MANIFEST_VERSION,
    files,
    pendingMerges: [...new Set(manifest.pendingMerges)].toSorted(),
    pendingNotes: manifest.pendingNotes,
    doneNotes: [...new Set(manifest.doneNotes)].toSorted(),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

export async function saveManifestV2(
  root: string,
  manifest: ManifestV2
): Promise<void> {
  const file = join(root, MANIFEST_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializeManifestV2(manifest), "utf-8");
}

/** sha256 over the sorted `(source path, sha256)` pairs of the payload's base template. */
export function payloadTemplateHash(payload: Payload): string {
  const digest = createHash("sha256");
  for (const from of [...payload.base.files.keys()].toSorted()) {
    digest.update(from);
    digest.update("\0");
    digest.update(hashContent(payload.base.files.get(from) ?? ""));
    digest.update("\n");
  }
  return digest.digest("hex");
}

export interface NextLockArgs {
  /** The lock the project holds now, or `undefined` for a first run. */
  previous?: Lockfile;
  /** The modules the owner asked for. */
  requested: readonly string[];
  payload: Payload;
  rendered: RenderResult;
  /** The release that runs: the base record's `cliVersion`. */
  version: string;
  /**
   * The provenance of each module in the set. Defaults to the payload's source and ref,
   * with the ref as the resolved value, which holds for a SHA or a release tag.
   */
  provenance?: (module: string) => ModuleProvenance;
}

/**
 * The lock a run writes: `requested` sorted, one `modules` entry for each module of the
 * resolved set, and the base record of the payload's template.
 */
export function nextLock(args: NextLockArgs): Lockfile {
  const { payload, rendered } = args;
  const lock = emptyLock();
  if (args.previous?.$schema !== undefined) {
    lock.$schema = args.previous.$schema;
  }
  lock.requested = [...new Set(args.requested)].toSorted();
  const provenance =
    args.provenance ??
    ((): ModuleProvenance => ({
      ref: payload.ref,
      resolved: payload.ref,
      source: payload.source,
    }));
  for (const name of rendered.order) {
    const item = payload.modules.get(name)?.item;
    const entry: LockModule = { ...provenance(name) };
    if (item?.dependsOn && item.dependsOn.length > 0) {
      entry.dependsOn = [...item.dependsOn];
    }
    if (item?.conflictsWith && item.conflictsWith.length > 0) {
      entry.conflictsWith = [...item.conflictsWith];
    }
    if (item?.requiresOneOf && item.requiresOneOf.length > 0) {
      entry.requiresOneOf = [...item.requiresOneOf];
    }
    lock.modules[name] = entry;
  }
  const config = rendered.files.get("saasaloy.json");
  const baseName =
    config === undefined
      ? undefined
      : (JSON.parse(config.content) as { base?: unknown }).base;
  if (typeof baseName === "string" && baseName !== "") {
    lock.base = {
      cliVersion: args.version,
      name: baseName,
      templateHash: payloadTemplateHash(payload),
    };
  }
  return lock;
}
