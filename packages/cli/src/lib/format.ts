import { spawn } from "node:child_process";
import { join } from "node:path";
import { log } from "@clack/prompts";
import type { LogMessageOptions } from "@clack/prompts";
import { pathExists } from "./fs-utils.js";

// Format the files a config patch rewrote, with the project's own Prettier.
//
// The patch engine edits an AST and prints the result with its own layout: `import {x}`
// with no spaces, and a `providers` array kept on one line however long it grows. A
// project's `pnpm lint` ends with `prettier --check .`, so every `add` used to leave the
// project failing its own gate until the next commit ran lint-staged (issue #152).
//
// Only patched files. A file `add` writes whole is a module's own source, formatted in
// the registry already, and its manifest hash must keep matching the bytes it shipped.
//
// It runs the project's Prettier, never one of ours: the project's config and plugins
// decide the layout, the same ones its hook and its `pnpm lint` use. Before the first
// `pnpm install` there is no Prettier to run, and the caller says so instead.

export type FormatOutcome =
  | { kind: "nothing" }
  | { kind: "formatted"; files: string[] }
  | { kind: "no-prettier"; files: string[] }
  | { kind: "failed"; files: string[]; message: string };

export interface RunResult {
  ok: boolean;
  message?: string;
}

export type Runner = (
  command: string,
  args: string[],
  cwd: string
) => Promise<RunResult>;

/** The project's Prettier bin. pnpm writes a `.cmd` shim on Windows. */
export function prettierBin(root: string): string {
  const name = process.platform === "win32" ? "prettier.cmd" : "prettier";
  return join(root, "node_modules", ".bin", name);
}

/**
 * Run the project's Prettier over `files`, each relative to `root`. Never throws: a
 * formatting failure must not undo an apply that already landed, so it comes back as
 * `failed` for the caller to report.
 */
export async function formatFiles(
  root: string,
  files: readonly string[],
  run: Runner = runChild
): Promise<FormatOutcome> {
  const unique = [...new Set(files)];
  if (unique.length === 0) {
    return { kind: "nothing" };
  }
  const bin = prettierBin(root);
  if (!(await pathExists(bin))) {
    return { files: unique, kind: "no-prettier" };
  }
  // `--ignore-unknown` because a patch can land in a file Prettier has no parser for.
  // `--` so a path that starts with a dash is never read as a flag.
  const result = await run(
    bin,
    ["--write", "--ignore-unknown", "--log-level", "warn", "--", ...unique],
    root
  );
  if (!result.ok) {
    return {
      files: unique,
      kind: "failed",
      message: result.message ?? "prettier failed",
    };
  }
  return { files: unique, kind: "formatted" };
}

export interface FormatReport {
  level: "step" | "info" | "warn";
  message: string;
}

/**
 * The one line a command prints for an outcome, or `null` when there is nothing to say.
 * A missing Prettier and a failed one both name `pnpm format`, which is the fix for each.
 */
export function formatReport(outcome: FormatOutcome): FormatReport | null {
  if (outcome.kind === "nothing") {
    return null;
  }
  const count = `${String(outcome.files.length)} patched file${outcome.files.length === 1 ? "" : "s"}`;
  if (outcome.kind === "formatted") {
    return { level: "step", message: `format  ${count} with Prettier` };
  }
  if (outcome.kind === "no-prettier") {
    return {
      level: "info",
      message: `Prettier isn't installed yet, so ${count} kept the patch layout. Run \`pnpm install\`, then \`pnpm format\`.`,
    };
  }
  return {
    level: "warn",
    message: `Couldn't format ${count} — ${outcome.message}. Run \`pnpm format\`.`,
  };
}

/**
 * Format `files` and print the outcome's line. What `add`, `remove` and `update` call.
 * `update` passes its stderr option, because its stdout may carry a merge plan.
 */
export async function formatPatchedFiles(
  root: string,
  files: readonly string[],
  options?: LogMessageOptions
): Promise<void> {
  const report = formatReport(await formatFiles(root, files));
  if (report !== null) {
    log[report.level](report.message, options);
  }
}

// Output is buffered, so a failure can say why and a success prints nothing. On Windows
// the bin is a `.cmd` shim, which a bare spawn will not run, so it goes through the shell.
function runChild(
  command: string,
  args: string[],
  cwd: string
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      resolvePromise({ message: error.message, ok: false });
    });
    child.on("close", (code) => {
      resolvePromise(
        code === 0
          ? { ok: true }
          : {
              message:
                output.trim() || `prettier exited with code ${String(code)}`,
              ok: false,
            }
      );
    });
  });
}
