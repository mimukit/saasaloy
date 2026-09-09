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
