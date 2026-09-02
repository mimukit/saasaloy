import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Spawning the real binary is the point of the end-to-end suite: it is the only way to
// catch what actually breaks a release — argument parsing, the preserved shebang, the exit
// code, and whether the published `files` array carried `templates/` and `schemas/`. None
// of that is reachable by calling the command functions in-process.

const PACKAGE_DIR = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Point the harness at another binary. `plan-ship-the-cli-2026-08-01.md`'s release smoke
 * test runs this same suite against an installed tarball rather than `dist/`, so the
 * binary under test is a parameter, not a constant. Give it a path to an executable (the
 * `saasaloy` bin) or to a `.js` entry point; a `.js` path is run through the current node.
 */
export const BIN_ENV = "SAASALOY_E2E_BIN";

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  /** Both streams, in the order each chunk arrived — what a person sees in a terminal. */
  output: string;
}

export interface RunOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Written to the child's stdin, then closed. Defaults to closing it immediately. */
  stdin?: string;
}

/** The command and leading arguments that invoke the CLI under test. */
export function cliCommand(): { command: string; args: string[] } {
  const override = process.env[BIN_ENV];
  if (override) {
    return override.endsWith(".js")
      ? { args: [override], command: process.execPath }
      : { args: [], command: override };
  }
  return {
    args: [join(PACKAGE_DIR, "dist", "index.js")],
    command: process.execPath,
  };
}

/**
 * Fail loudly when the CLI has not been built, rather than running `pnpm build` from
 * inside a test. A build that a test triggers is a build nobody reads the output of, and
 * it hides "the suite passes only because it rebuilt what CI was meant to check".
 */
export async function assertCliBuilt(): Promise<void> {
  const { args, command } = cliCommand();
  const entry = args[0] ?? command;
  try {
    await access(entry);
  } catch {
    throw new Error(
      `No CLI to test at ${entry}. Run \`pnpm --filter saasaloy build\` first, or set ${BIN_ENV} to an installed binary.`
    );
  }
}

export function runCli(argv: string[], options: RunOptions): Promise<CliRun> {
  const { args, command } = cliCommand();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args, ...argv], {
      cwd: options.cwd,
      env: {
        ...process.env,
        // The CLI's clack prompts read a terminal; with none the commands take their
        // documented non-interactive path, which is what these tests drive.
        NO_COLOR: "1",
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, output, stderr, stdout });
    });
    child.stdin.end(options.stdin ?? "");
  });
}

/** Absolute path of a fixture directory that ships with the package. */
export function fixture(...segments: string[]): string {
  return join(PACKAGE_DIR, "test", "fixtures", ...segments);
}

/** The repo's own `modules/` registry — four directories up from `test/support`. */
export function repoModulesDir(): string {
  return resolve(dirname(PACKAGE_DIR), "..", "modules");
}
