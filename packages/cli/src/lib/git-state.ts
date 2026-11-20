import { execFile } from "node:child_process";

// Whether the project has uncommitted work, so `update` can refuse to write over it.
//
// Git is the only undo most projects actually have, and an update that lands on top of
// uncommitted edits leaves nothing to diff the damage against. A project that is not a
// git repository, or a box with no git at all, is not blocked: the check reports
// "unknown" and the run continues.

export type WorkingTreeState = "clean" | "dirty" | "unknown";

/** `git status --porcelain` in `root`, reduced to the one verdict `update` needs. */
export async function workingTreeState(
  root: string
): Promise<WorkingTreeState> {
  return new Promise((resolve) => {
    execFile(
      "git",
      // `-- .` scopes the answer to the project. Without it a project nested inside a
      // larger repository reports every unrelated change in that repository as its own.
      ["status", "--porcelain", "--untracked-files=no", "--", "."],
      { cwd: root },
      (error, stdout) => {
        resolve(error ? "unknown" : stdout.trim() === "" ? "clean" : "dirty");
      }
    );
  });
}

function git(root: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: root, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      }
    );
  });
}

/**
 * The paths among `paths` that hold uncommitted changes, untracked files included, as
 * `git status --porcelain -- <paths>` lists them (plan 0116, "The clean-tree rule").
 * `undefined` when the project is not a git repository or git did not run: the check is
 * unknown, and the caller decides.
 */
export async function dirtyPaths(
  root: string,
  paths: readonly string[]
): Promise<string[] | undefined> {
  if (paths.length === 0) {
    return [];
  }
  // Porcelain paths are relative to the repository root, so a project nested inside a
  // larger repository strips its own prefix to get its paths back.
  const prefix = await git(root, ["rev-parse", "--show-prefix"]);
  const stdout = await git(root, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
    "--",
    ...paths,
  ]);
  if (prefix === undefined || stdout === undefined) {
    return undefined;
  }
  const lead = prefix.trim();
  const asked = new Set(paths);
  const dirty = new Set<string>();
  const entries = stdout.split("\0");
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] ?? "";
    if (entry.length <= 3) {
      continue;
    }
    const names = [entry.slice(3)];
    // A rename or copy is followed by its source path in the next field.
    if (entry.startsWith("R") || entry.startsWith("C")) {
      i += 1;
      names.push(entries[i] ?? "");
    }
    for (const name of names) {
      const rel = name.startsWith(lead) ? name.slice(lead.length) : name;
      if (asked.has(rel)) {
        dirty.add(rel);
      }
    }
  }
  return [...dirty].toSorted();
}
