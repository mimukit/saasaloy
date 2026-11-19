// Links each breaking item in the generated CHANGELOG to the update note its commit added
// (issue #298). The changelog stays short: the breaking summary line, then a link to the
// note file at the release tag. The full upgrade steps live only in the note.
//
// `packages/cli/.release-it.js` passes `finalizeUpdateNotes` to the changelog plugin as
// `writerOpts.finalizeContext`. That hook sees every breaking note with its commit, which a
// per-commit `transform` would too, but a `transform` replaces the preset's own and
// `finalizeContext` replaces only conventional-changelog's tag guessing. release-it already
// hands the writer `previousTag` and `currentTag`, so the one thing that guessing still did
// was turn on the compare link, and `finalizeUpdateNotes` does that too.
//
// A note can also come late (issue #358): a later commit adds it and carries
// `Update-Note-For: <full sha>`. `lateUpdateNotes` maps each footer in a range to the notes
// its commit added, and `finalizeUpdateNotes` links those to the named commit's breaking
// item exactly as it links a same-commit note. It reads `<previousTag>..HEAD`, because
// release-it writes the changelog before it creates the new tag.
//
// `release-preflight.ts` uses `addedUpdateNotes`, `commitsInRange` and `lateUpdateNotes`
// to require a note on each breaking commit.
//
// Imports node: builtins and `./update-note-footer.ts`, which imports nothing. Node 24
// strips the types, so there is no build step; `pnpm typecheck` checks it via
// tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { updateNoteForFooters } from "./update-note-footer.ts";

/** Runs git with these arguments and returns its stdout. Injected so tests need no repo. */
export type Git = (args: readonly string[]) => string;

const REPO_URL = "https://github.com/mimukit/saasaloy";

/** A file under a folder named exactly `update-notes`, at any depth. */
const UPDATE_NOTE_PATH = /(?:^|\/)update-notes\//;

export function isUpdateNotePath(path: string): boolean {
  return UPDATE_NOTE_PATH.test(path);
}

/**
 * The update-note files a commit added, as repo-root paths. `--root` makes a root commit
 * diff against the empty tree rather than print nothing.
 */
export function addedUpdateNotes(git: Git, hash: string): string[] {
  return git([
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-only",
    "-r",
    "--diff-filter=A",
    hash,
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && isUpdateNotePath(line));
}

/** One non-merge commit from `git log`: its full SHA and its whole message. */
export interface LoggedCommit {
  hash: string;
  message: string;
}

const FIELD = "\u001F";
const RECORD = "\u001E";

/**
 * The non-merge commits in a range such as `v0.8.0..HEAD`, newest first. Merges are
 * skipped: a PR merge commit adds nothing of its own, and the commits it brings in are
 * read one by one.
 */
export function commitsInRange(git: Git, range: string): LoggedCommit[] {
  const log = git([
    "log",
    "--no-merges",
    `--format=%H${FIELD}%B${RECORD}`,
    range,
  ]);
  const commits: LoggedCommit[] = [];
  for (const record of log.split(RECORD)) {
    const separator = record.indexOf(FIELD);
    if (separator === -1) {
      continue;
    }
    commits.push({
      hash: record.slice(0, separator).trim(),
      message: record.slice(separator + 1).trim(),
    });
  }
  return commits;
}

/** One `Update-Note-For:` footer, with the commit that carries it and the notes it added. */
export interface LateNoteFooter {
  /** The commit that carries the footer. */
  commit: LoggedCommit;
  /** The footer value as written. */
  value: string;
  /** The full SHA it names in lower case, or null when the value is not a full SHA. */
  target: string | null;
  /** The update notes the footer's commit added. */
  notes: string[];
}

/** Every `Update-Note-For:` footer in these commits, with the notes each commit added. */
export function lateNoteFooters(
  git: Git,
  commits: readonly LoggedCommit[]
): LateNoteFooter[] {
  return commits.flatMap((commit) => {
    const footers = updateNoteForFooters(commit.message);
    if (footers.length === 0) {
      return [];
    }
    const notes = addedUpdateNotes(git, commit.hash);
    return footers.map((footer) => ({
      commit,
      value: footer.value,
      target: footer.sha,
      notes,
    }));
  });
}

/** The late notes per named commit: full SHA to the note paths later commits added for it. */
export function lateUpdateNotes(
  footers: readonly LateNoteFooter[]
): Map<string, string[]> {
  const byTarget = new Map<string, string[]>();
  for (const footer of footers) {
    if (footer.target === null || footer.notes.length === 0) {
      continue;
    }
    const notes = byTarget.get(footer.target) ?? [];
    notes.push(...footer.notes.filter((path) => !notes.includes(path)));
    byTarget.set(footer.target, notes);
  }
  return byTarget;
}

/** The note file on GitHub at the release tag, which is where it stays fixed. */
export function updateNoteUrl(version: string, path: string): string {
  return `${REPO_URL}/blob/v${version}/${path}`;
}

interface WriterNote {
  text: string;
  commit?: { hash?: string | null };
}

interface WriterContext {
  version?: string;
  previousTag?: string | null;
  currentTag?: string | null;
  linkCompare?: boolean;
  noteGroups?: { notes: WriterNote[] }[];
}

/**
 * Append a link to each breaking note whose commit added an update note, or that a later
 * commit since `previousTag` covered with `Update-Note-For:`. Mutates and returns the
 * context, which is the contract `finalizeContext` has.
 */
export function finalizeUpdateNotes<T extends WriterContext>(
  context: T,
  git: Git = repoGit
): T {
  if (
    typeof context.linkCompare !== "boolean" &&
    context.previousTag &&
    context.currentTag
  ) {
    context.linkCompare = true;
  }
  const { version } = context;
  if (version === undefined) {
    return context;
  }
  let late: Map<string, string[]> | undefined;
  const lateFor = (hash: string): string[] => {
    if (!context.previousTag) {
      return [];
    }
    late ??= lateUpdateNotes(
      lateNoteFooters(git, commitsInRange(git, `${context.previousTag}..HEAD`))
    );
    return late.get(hash.toLowerCase()) ?? [];
  };
  for (const group of context.noteGroups ?? []) {
    for (const note of group.notes) {
      const hash = note.commit?.hash;
      if (!hash) {
        continue;
      }
      const paths = addedUpdateNotes(git, hash);
      for (const path of lateFor(hash)) {
        if (!paths.includes(path)) {
          paths.push(path);
        }
      }
      const links = paths.map(
        (path) => `[${path}](${updateNoteUrl(version, path)})`
      );
      if (links.length > 0) {
        note.text = `${note.text.trimEnd()} (update note: ${links.join(", ")})`;
      }
    }
  }
  return context;
}

/** git in the current directory. Paths from `diff-tree` are repo-root relative anyway. */
function repoGit(args: readonly string[]): string {
  const result = spawnSync("git", args, { encoding: "utf-8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr?.trim() || String(result.error)}`
    );
  }
  return result.stdout;
}
