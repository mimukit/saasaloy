import pc from "picocolors";
import type { PendingNote } from "./manifest.js";
import type { NoteSelection } from "./update-note-select.js";
import type { UpdateNoteText } from "./update-notes.js";

// Pending update notes (#298 Phase 4). Every note an applied `update` shows is recorded in
// the manifest until `update --done <id>` clears it, and a pending note prints in every
// later merge plan. Pure: the command loads and saves the manifest.

/** What a run shows, and the pending list it records when it applies. */
export interface PendingMerge {
  notes: UpdateNoteText[];
  mayApply: UpdateNoteText[];
  pending: PendingNote[];
}

/**
 * Merge the pending notes with this run's selection. A pending note keeps its place and
 * its group; a newly selected one is appended in plan order. One id is listed once. An id
 * in `done` (cleared on an earlier run or by this one) is left out of both what the run
 * shows and what it records.
 */
export function mergePendingNotes(
  pending: readonly PendingNote[],
  selection: NoteSelection,
  done: ReadonlySet<string>
): PendingMerge {
  const merged: PendingNote[] = [];
  const seen = new Set<string>();
  const add = (note: PendingNote): void => {
    if (seen.has(note.id) || done.has(note.id)) {
      return;
    }
    seen.add(note.id);
    merged.push({
      id: note.id,
      title: note.title,
      body: note.body,
      ...(note.mayApply ? { mayApply: true } : {}),
    });
  };
  for (const note of pending) {
    add(note);
  }
  for (const note of selection.notes) {
    add({ id: note.id, title: note.title, body: note.body });
  }
  for (const note of selection.mayApply) {
    add({ id: note.id, title: note.title, body: note.body, mayApply: true });
  }
  const text = (note: PendingNote): UpdateNoteText => ({
    id: note.id,
    title: note.title,
    body: note.body,
  });
  return {
    notes: merged.filter((note) => !note.mayApply).map(text),
    mayApply: merged.filter((note) => note.mayApply).map(text),
    pending: merged,
  };
}

/** The `--done` ids that name a pending note, and the ones that name none. */
export function matchDone(
  ids: readonly string[],
  pending: readonly PendingNote[]
): { matched: Set<string>; unmatched: string[] } {
  const known = new Set(pending.map((note) => note.id));
  const matched = new Set<string>();
  const unmatched: string[] = [];
  for (const id of ids) {
    if (known.has(id)) {
      matched.add(id);
    } else if (!unmatched.includes(id)) {
      unmatched.push(id);
    }
  }
  return { matched, unmatched };
}

/** `1 update note pending`, the count `update`, `outdated` and `doctor` print (#298). */
export function pendingLabel(count: number): string {
  return `${count} update note${count === 1 ? "" : "s"} pending`;
}

/** One line per pending note, `id  title`, for the `outdated` and `doctor` boxes. */
export function pendingNoteLines(pending: readonly PendingNote[]): string[] {
  return [
    ...pending.map(
      (note) =>
        `${pc.yellow("•")} ${pc.cyan(note.id)} ${pc.dim(`— ${note.title}${note.mayApply ? " (may apply)" : ""}`)}`
    ),
    pc.dim(
      "Do each note's work, then run `saasaloy update --done <id>` to clear it."
    ),
  ];
}

/** A pending note as `--json` prints it: the id and the title, never the body. */
export function pendingNoteJson(
  note: PendingNote
): Pick<PendingNote, "id" | "title"> {
  return { id: note.id, title: note.title };
}
