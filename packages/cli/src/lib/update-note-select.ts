import { compareVersions, parseVersion } from "./semver.js";
import type { SemVer } from "./semver.js";
import {
  BASE_NOTE_OWNER,
  listUpdateNotes,
  moduleUpdateNotesDir,
} from "./update-notes.js";
import type { UpdateNote } from "./update-notes.js";
import { whenHolds } from "./when.js";
import type { WhenContext } from "./when.js";

// Which update notes a run hands to the agent (#298 Phase 3). Base notes ship inside the
// CLI, so they go by CLI version range: newer than the lock's `base.cliVersion`, up to and
// including the running CLI. Module notes go by folder: a note file in the new revision's
// `update-notes/` that the old revision lacks is new in that range. Every note then passes
// the `when` test a descriptor entry takes (ADR 0054).
//
// A note the run cannot place goes to a "may apply" group rather than being dropped or
// asserted: a module with no merge base has no old folder to compare, and an adopted base
// has no record of the CLI that really rendered it. A module `update` installs as a new
// prerequisite has no old revision at all, so its old folder counts as empty and every
// note it ships applies.

/** The notes a run shows: the ones it can place, and the ones the agent has to check. */
export interface NoteSelection {
  notes: UpdateNote[];
  mayApply: UpdateNote[];
}

/** The version range base notes are selected over. */
export interface BaseNoteRange {
  /** `lock.base.cliVersion`. */
  recorded: string;
  /** The running CLI, from `readVersion()`. */
  running: string;
}

/** One module's two `update-notes/` folders, as the run fetched them. */
export interface ModuleNoteSource {
  name: string;
  /** The module directory at the new revision. */
  theirsDir: string;
  /** The module directory at the old revision; absent when there is no merge base. */
  baseDir?: string;
  /** A module this update installs as a new prerequisite: its old folder is empty. */
  fresh?: boolean;
}

export interface SelectUpdateNotesArgs {
  /** The base notes folder and range; absent when the run does not consider the base. */
  base?: BaseNoteRange & { dir: string };
  /** In plan order. */
  modules: readonly ModuleNoteSource[];
  /** The install set after the update, and the project's testing mode. */
  when: WhenContext;
}

/** Base notes by `version`, then by serial. */
function byVersion(a: UpdateNote, b: UpdateNote): number {
  const av = parseVersion(a.version ?? "");
  const bv = parseVersion(b.version ?? "");
  const order = av && bv ? compareVersions(av, bv) : 0;
  return order === 0 ? a.serial - b.serial : order;
}

/** Whether a note's version sits in `(lower, upper]`; `lower` undefined means no floor. */
function inRange(
  note: UpdateNote,
  lower: SemVer | undefined,
  upper: SemVer
): boolean {
  const version = parseVersion(note.version ?? "");
  if (!version || compareVersions(version, upper) > 0) {
    return false;
  }
  return lower === undefined || compareVersions(version, lower) > 0;
}

/** Split the base notes into the range this run covers and the ones it cannot place. */
export function selectBaseNotes(
  all: readonly UpdateNote[],
  range: BaseNoteRange
): NoteSelection {
  const running = parseVersion(range.running);
  if (!running) {
    return { notes: [], mayApply: [] };
  }
  const sorted = all.toSorted(byVersion);
  const lower = parseVersion(range.recorded);
  if (!lower) {
    // A recorded label that is not semver says nothing about where the project stands.
    return {
      notes: [],
      mayApply: sorted.filter((n) => inRange(n, undefined, running)),
    };
  }
  return {
    notes: sorted.filter((n) => inRange(n, lower, running)),
    mayApply: [],
  };
}

/**
 * Split one module's notes. `base` is the old revision's notes: `[]` for a module new to
 * the project, and `undefined` when there is no merge base to compare against.
 */
export function selectModuleNotes(
  theirs: readonly UpdateNote[],
  base: readonly UpdateNote[] | undefined
): NoteSelection {
  if (base === undefined) {
    return { notes: [], mayApply: [...theirs] };
  }
  const seen = new Set(base.map((n) => n.id));
  return { notes: theirs.filter((n) => !seen.has(n.id)), mayApply: [] };
}

/** Read, select and filter every note this run shows. */
export async function selectUpdateNotes(
  args: SelectUpdateNotesArgs
): Promise<NoteSelection> {
  const groups: NoteSelection[] = [];
  if (args.base) {
    groups.push(
      selectBaseNotes(
        await listUpdateNotes(args.base.dir, BASE_NOTE_OWNER),
        args.base
      )
    );
  }
  for (const source of args.modules) {
    const theirs = await listUpdateNotes(
      moduleUpdateNotesDir(source.theirsDir),
      source.name
    );
    const base = source.fresh
      ? []
      : source.baseDir === undefined
        ? undefined
        : await listUpdateNotes(
            moduleUpdateNotesDir(source.baseDir),
            source.name
          );
    groups.push(selectModuleNotes(theirs, base));
  }

  const seen = new Set<string>();
  const keep = (note: UpdateNote): boolean => {
    if (seen.has(note.id) || !whenHolds(note.when, args.when)) {
      return false;
    }
    seen.add(note.id);
    return true;
  };
  const notes = groups.flatMap((g) => g.notes).filter(keep);
  const mayApply = groups.flatMap((g) => g.mayApply).filter(keep);
  return { notes, mayApply };
}
