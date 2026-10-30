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
// `release-preflight.ts` uses `addedUpdateNotes` to require a note on each breaking commit.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";

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
 * Append a link to each breaking note whose commit added an update note. Mutates and
 * returns the context, which is the contract `finalizeContext` has.
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
  for (const group of context.noteGroups ?? []) {
    for (const note of group.notes) {
      const hash = note.commit?.hash;
      if (!hash) {
        continue;
      }
      const links = addedUpdateNotes(git, hash).map(
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
