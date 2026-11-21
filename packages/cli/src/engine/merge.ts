import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RefusalError } from "../lib/exit.js";

// The three-way text merge (plan 0116, "Text merge"): `git merge-file -p`, with
// `--zdiff3` from git 2.35 and `--diff3` below it. The labels are `mine`, `base` and
// `saasaloy <version>`, so a marker names the release the other side came from.
//
// Git is looked up only when a merge runs. A run that merges nothing needs no git, and a
// run that must merge and finds none refuses with exit 2 before it writes a byte, because
// `apply` merges in memory while it stages.

export interface MergeInput {
  /** The project's file on disk. */
  mine: string;
  /**
   * The render the project last took, or `undefined` when no base is known. With no base
   * the result is two-way conflict markers, as git writes for "both added".
   */
  base: string | undefined;
  /** The new render. */
  theirs: string;
  /** The release `theirs` comes from: the marker label `saasaloy <version>`. */
  version: string;
  /** The project-relative path, for the refusal message. */
  path?: string;
}

export interface MergeOutput {
  content: string;
  /** The number of conflict regions git reported. `0` is a clean merge. */
  conflicts: number;
}

export type MergeStyle = "zdiff3" | "diff3";

export interface TextMerger {
  merge(input: MergeInput): Promise<MergeOutput>;
}

export interface TextMergerOptions {
  /** The git binary. Tests point it at a missing path to prove the refusal. */
  git?: string;
}

/** The label of the `theirs` side. */
export function theirsLabel(version: string): string {
  return `saasaloy ${version}`;
}

// A marker line as git writes it: seven characters, then a space and a label or nothing.
const MARKER_LINE = /^(?:<{7}|>{7})(?: |$)|^={7}$/m;

/** True when `text` still holds a conflict marker line. */
export function hasConflictMarkers(text: string): boolean {
  return MARKER_LINE.test(text);
}

/** The merge style a git version supports: `zdiff3` from 2.35. */
export function mergeStyleFor(versionOutput: string): MergeStyle {
  const match = /(\d+)\.(\d+)/.exec(versionOutput);
  const major = Number(match?.[1] ?? 0);
  const minor = Number(match?.[2] ?? 0);
  return major > 2 || (major === 2 && minor >= 35) ? "zdiff3" : "diff3";
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  missing: boolean;
}

function run(file: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, missing: false, stderr, stdout });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        resolve({
          code: typeof code === "number" ? code : -1,
          missing: code === "ENOENT",
          stderr,
          stdout,
        });
      }
    );
  });
}

/** A merger bound to one git binary. It asks git for its version once, on first use. */
export function createTextMerger(options: TextMergerOptions = {}): TextMerger {
  const git = options.git ?? "git";
  let style: Promise<MergeStyle> | undefined;

  const styleOf = (path: string | undefined): Promise<MergeStyle> => {
    style ??= (async () => {
      const result = await run(git, ["--version"]);
      if (result.code !== 0) {
        throw new RefusalError(
          `Merging ${path ?? "a file"} needs git, and git did not run${result.missing ? " (not found)" : ""}. Install git, then run the command again.`
        );
      }
      return mergeStyleFor(result.stdout);
    })();
    return style;
  };

  return {
    async merge(input) {
      const mergeStyle = await styleOf(input.path);
      const dir = await mkdtemp(join(tmpdir(), "saasaloy-merge-"));
      try {
        const mine = join(dir, "mine");
        const base = join(dir, "base");
        const theirs = join(dir, "theirs");
        await writeFile(mine, input.mine, "utf-8");
        await writeFile(base, input.base ?? "", "utf-8");
        await writeFile(theirs, input.theirs, "utf-8");
        const args = [
          "merge-file",
          "-p",
          // With no base, the plain style gives two-way markers, as "both added" does.
          ...(input.base === undefined ? [] : [`--${mergeStyle}`]),
          "-L",
          "mine",
          "-L",
          "base",
          "-L",
          theirsLabel(input.version),
          mine,
          base,
          theirs,
        ];
        const result = await run(git, args);
        // git exits with the conflict count, capped at 127; a negative value is an error.
        if (result.code < 0 || result.code > 127) {
          throw new Error(
            `git merge-file failed on ${input.path ?? "a file"}: ${result.stderr.trim() || `exit ${String(result.code)}`}`
          );
        }
        return { conflicts: result.code, content: result.stdout };
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    },
  };
}
