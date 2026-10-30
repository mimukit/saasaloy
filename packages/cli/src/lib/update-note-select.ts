import { compareVersions, parseVersion } from "./semver.js";
import type { SemVer } from "./semver.js";
import {
  BASE_NOTE_OWNER,
  listUpdateNotes,
  moduleUpdateNotesDir,
} from "./update-notes.js";
import type { UpdateNote } from "./update-notes.js";
import type { ModuleUpdateInput, UpdatePlan } from "./updater.js";
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
  /**
   * The CLI version the base was adopted at, set only on the first update after the
   * adoption. Notes up to it cannot be placed, so without `from` they go under may apply.
   */
  adoptedAt?: string;
  /** `update --from <version>`: the lower bound the user names for an adopted base. */
  from?: string;
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
  const lower = parseVersion(range.from ?? range.recorded);
  if (!lower) {
    // A recorded label that is not semver says nothing about where the project stands.
    return {
      notes: [],
      mayApply: sorted.filter((n) => inRange(n, undefined, running)),
    };
  }
  const notes = sorted.filter((n) => inRange(n, lower, running));
  const adoptedAt =
    range.from === undefined && range.adoptedAt !== undefined
      ? parseVersion(range.adoptedAt)
      : undefined;
  const mayApply = adoptedAt
    ? sorted.filter((n) => inRange(n, undefined, adoptedAt))
    : [];
  return { notes, mayApply };
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

/**
 * Why `update --from <version>` is refused, or `undefined` when it may run. `--from` only
 * means something on the first update after an adoption: on any other run the lock's
 * `base.cliVersion` already says where the project stands.
 */
export function fromRefusal(
  from: string | undefined,
  firstAfterAdoption: boolean
): string | undefined {
  if (from === undefined) {
    return undefined;
  }
  if (!parseVersion(from)) {
    return `\`--from ${from}\` is not a version. Name the CLI version this project was made with, for example \`--from 0.7.0\`. Nothing was written.`;
  }
  if (!firstAfterAdoption) {
    return "`--from` works only on the first update after `saasaloy update` adopted the base. The lock range is already exact on this project, so run `saasaloy update` without it. Nothing was written.";
  }
  return undefined;
}

/**
 * The module folders a plan reads notes from, in plan order. A new prerequisite comes
 * just ahead of the module that pulled it in, the order `executeUpdatePlan` installs them.
 * The base template is left out: its notes ship with the CLI and go by version.
 */
export function moduleNoteSources(
  inputs: readonly ModuleUpdateInput[],
  plan: Pick<UpdatePlan, "modules">
): ModuleNoteSource[] {
  const byName = new Map(
    inputs.map((input) => [input.theirs.item.name, input])
  );
  const sources: ModuleNoteSource[] = [];
  for (const mod of plan.modules) {
    const input = byName.get(mod.name);
    if (!input || input.baseRecord) {
      continue;
    }
    for (const name of mod.prereqNames) {
      const prereq = input.prereqs?.modules.get(name);
      if (prereq) {
        sources.push({ name, theirsDir: prereq.dir, fresh: true });
      }
    }
    sources.push({
      name: mod.name,
      theirsDir: input.theirs.dir,
      ...(input.base ? { baseDir: input.base.dir } : {}),
    });
  }
  return sources;
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
