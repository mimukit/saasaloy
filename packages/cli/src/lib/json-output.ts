import type { Writable } from "node:stream";
import { cancel } from "@clack/prompts";
import { exitCodeFor, formatFailure } from "./exit.js";
import { stripAnsi, TUI_ON_STDERR } from "./tui.js";

// `--json` on `list`, `doctor`, `outdated`, `env --check` and `add --dry-run` (#223,
// ADR 0046). The contract an agent reads:
//
// - stdout carries exactly one JSON document, with a top-level `schemaVersion`.
// - The clack TUI and every warning go to stderr, so a person watching still sees them
//   and `JSON.parse(stdout)` never meets a box-drawing character.
// - Exit codes keep their `lib/exit.ts` meaning. A run that reaches its report prints the
//   report whatever the exit: `doctor` with findings exits 2 and still prints them.
// - A run that stops before its report (bad usage, no project, a refusal) prints an
//   error document, `{ schemaVersion, error: { exitCode, message } }`, so stdout parses
//   on every exit, not only on success.
// - `--json` never prompts. A command that would ask refuses instead and names the flag.
//
// A breaking change to any document shape bumps `JSON_SCHEMA_VERSION`; a new field does
// not.

export const JSON_SCHEMA_VERSION = 1;

/** Write one JSON document to stdout, `schemaVersion` first. */
export function printJson(document: object): void {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, ...document }, null, 2)}\n`
  );
}

/** The options object every clack call in a `--json`-aware command takes. */
export interface TuiOptions {
  readonly output?: Writable;
}

export interface Output {
  json: boolean;
  /** `TUI_ON_STDERR` under `--json`, clack's default stdout otherwise. */
  tui: TuiOptions;
  /** Cancel the rail with `message`, print the error document under `--json`, return `code`. */
  refuse(message: string, code: number): number;
  /** `refuse` with the failure's message and its exit code. */
  fail(error: unknown): number;
}

export function createOutput(json: boolean): Output {
  const tui: TuiOptions = json ? TUI_ON_STDERR : {};
  const refuse = (message: string, code: number): number => {
    cancel(message, tui);
    if (json) {
      printJson({ error: { exitCode: code, message: stripAnsi(message) } });
    }
    return code;
  };
  return {
    fail: (error) => refuse(formatFailure(error), exitCodeFor(error)),
    json,
    refuse,
    tui,
  };
}
