// The one door every command's prompt goes through (ADR 0046, issue #223).
//
// A clack prompt reads raw-mode stdin and draws on stdout. With no terminal on either
// side nobody can answer it, and before this module each command remembered (or forgot)
// its own `isInteractive()` check: `init` with no name and `remove`'s confirms forgot,
// so an agent driving them with no TTY waited on stdin forever. Here the check is the
// prompt itself. Each wrapper takes clack's own options plus `answeredBy`, the flag or
// argument that gives the same answer, and with no terminal it throws a `RefusalError`
// naming it. A command's catch already maps a refusal onto exit 2 via `exitCodeFor`.
//
// `src/lib/prompts.test.ts` fails any file in `src/commands/` that imports a prompt
// from `@clack/prompts` directly, so a new prompt cannot skip the guard.

import {
  confirm as clackConfirm,
  multiselect as clackMultiselect,
  select as clackSelect,
  text as clackText,
} from "@clack/prompts";
import type {
  CommonOptions,
  ConfirmOptions,
  MultiSelectOptions,
  SelectOptions,
  TextOptions,
} from "@clack/prompts";
import { RefusalError } from "./exit.js";
import { isInteractive, stripAnsi } from "./tui.js";

export interface Answerable {
  /**
   * The flag or argument that answers this prompt with no terminal, written the way the
   * refusal should show it: "`<name>`", or "`--yes` to apply, or `--dry-run` to preview".
   */
  answeredBy: string;
}

// The prompt's own message, first line only and without colour, so the refusal quotes
// the question a person would have seen. `env` puts a description on a second line.
function question(message: string): string {
  const first = stripAnsi(message).split("\n")[0] ?? "";
  return first.trim();
}

// `isInteractive()` for a prompt drawn on stdout. A prompt drawn elsewhere (`update`'s
// confirm goes to stderr so `saasaloy update | claude` keeps its stdout) needs stdin and
// that stream to be terminals, and says nothing about stdout.
function canAsk(output: CommonOptions["output"]): boolean {
  if (output === undefined || output === process.stdout) {
    return isInteractive();
  }
  return process.stdin.isTTY && (output as { isTTY?: boolean }).isTTY === true;
}

function refuse(message: string, answeredBy: string): never {
  // A refusal, so every command's catch maps it onto exit 2 through `exitCodeFor`.
  throw new RefusalError(
    `No terminal to answer "${question(message)}" — pass ${answeredBy}.`
  );
}

export function select<Value>(
  opts: SelectOptions<Value> & Answerable
): Promise<Value | symbol> {
  const { answeredBy, ...rest } = opts;
  if (!canAsk(rest.output)) {
    refuse(rest.message, answeredBy);
  }
  return clackSelect(rest);
}

export function multiselect<Value>(
  opts: MultiSelectOptions<Value> & Answerable
): Promise<Value[] | symbol> {
  const { answeredBy, ...rest } = opts;
  if (!canAsk(rest.output)) {
    refuse(rest.message, answeredBy);
  }
  return clackMultiselect(rest);
}

export function confirm(
  opts: ConfirmOptions & Answerable
): Promise<boolean | symbol> {
  const { answeredBy, ...rest } = opts;
  if (!canAsk(rest.output)) {
    refuse(rest.message, answeredBy);
  }
  return clackConfirm(rest);
}

export function text(opts: TextOptions & Answerable): Promise<string | symbol> {
  const { answeredBy, ...rest } = opts;
  if (!canAsk(rest.output)) {
    refuse(rest.message, answeredBy);
  }
  return clackText(rest);
}
