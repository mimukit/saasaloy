import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RefusalError } from "./exit.js";
import { pathExists } from "./fs-utils.js";
import { validateManifest } from "./schema.js";

// `.saasaloy/manifest.json` as the old engines wrote it: version 1, with no `version` key.
// The render engine writes version 2 (`engine/manifest.ts`). This file only reads a version
// 1 manifest for the conversion that the first `update` runs (`engine/convert.ts`, plan
// 0116 Phase 5). Shape is validated by `schemas/manifest.schema.json`.

/** One file a version 1 manifest tracks. */
export interface ManagedEntry {
  /** Name of the module that applied this file. */
  module: string;
  /** sha256 of the bytes the old engine wrote, or found on disk when `adopted`. */
  hash: string;
  /** The hash is of bytes found on disk, not bytes the old engine wrote. */
  adopted?: boolean;
  /** Module-relative or template-relative source path this file was copied from. */
  from?: string;
  /** The descriptor `when` this file was written under (#242). */
  when?: unknown;
  /** The file was a seed, written once (ADR 0060). */
  seed?: true;
  /** sha256 of the module's version a merge took in (`update --resolved`). */
  mergedWith?: string;
  /** The owner deleted the file and chose to keep it deleted (ADR 0059). */
  deleted?: boolean;
}

/**
 * An update note an applied `saasaloy update` showed and nobody has cleared yet (#298).
 * The rendered body is stored, not a path, so a later report repeats the note with no
 * network. Version 2 keeps the same shape.
 */
export interface PendingNote {
  /** `base/NNNN-<slug>` or `<module>/NNNN-<slug>`. */
  id: string;
  title: string;
  /** The note's Markdown after the frontmatter, as the report rendered it. */
  body: string;
  /** Shown under "Notes that may apply": the run could not place it. */
  mayApply?: boolean;
}

/** A version 1 manifest, as far as the conversion reads it. */
export interface Manifest {
  managed: Record<string, ManagedEntry>;
  pendingNotes?: PendingNote[];
  doneNotes?: string[];
}

export const MANIFEST_FILE = join(".saasaloy", "manifest.json");

/** Read a version 1 manifest. A missing file reads as an empty one. */
export async function loadManifest(root: string): Promise<Manifest> {
  const file = join(root, MANIFEST_FILE);
  if (!(await pathExists(file))) {
    return { managed: {} };
  }
  // A half-written file parses as nothing at all, which is as invalid as a bad hash and
  // takes the same exit code.
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (error) {
    throw new RefusalError(
      `${MANIFEST_FILE} is invalid:\n  ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const result = await validateManifest(raw);
  if (!result.valid) {
    throw new RefusalError(
      `${MANIFEST_FILE} is invalid:\n  ${result.errors.join("\n  ")}`
    );
  }
  const parsed = raw as Partial<Manifest>;
  return {
    managed: parsed.managed ?? {},
    ...(parsed.pendingNotes && parsed.pendingNotes.length > 0
      ? { pendingNotes: parsed.pendingNotes }
      : {}),
    ...(parsed.doneNotes && parsed.doneNotes.length > 0
      ? { doneNotes: parsed.doneNotes }
      : {}),
  };
}
