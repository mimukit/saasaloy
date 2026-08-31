import { readFile } from "node:fs/promises";
import {
  cancel,
  isCancel as clackIsCancel,
  select as clackSelect,
} from "@clack/prompts";
import pc from "picocolors";
import type { CommandRegistry } from "./commands/index.js";
import { COMMANDS } from "./commands/index.js";
import { isInteractive } from "./lib/tui.js";

// Argument parsing and dispatch. Kept out of index.ts — which only bootstraps this and
// maps the resolved code onto process.exit — so a test can import it without running the
// CLI. Everything the picker needs from the outside world (the registry, the prompt) is a
// defaulted parameter, which is the test seam: this package mocks no modules anywhere.

/** The slice of clack's `select` the picker uses, narrowed to string-valued options. */
export type SelectPrompt = (opts: {
  message: string;
  options: { value: string; label: string; hint?: string }[];
}) => Promise<string | symbol>;

export interface CliDeps {
  registry: CommandRegistry;
  select: SelectPrompt;
  /** clack's cancel sentinel is module-private, so recognising it is injectable too. */
  isCancel: (value: unknown) => value is symbol;
}

// The version comes from package.json at runtime rather than a build-time constant, so a
// rebuild is never needed to keep them in step. At runtime import.meta.url is
// <pkg>/dist/index.js and under vitest it's <pkg>/src/cli.ts — ../package.json resolves
// to <pkg>/package.json from both.
export async function cliVersion(): Promise<string> {
  const raw = await readFile(
    new URL("../package.json", import.meta.url),
    "utf-8"
  );
  return (JSON.parse(raw) as { version: string }).version;
}

export function printHelp(registry: CommandRegistry): void {
  console.log(
    `${pc.bold("saasaloy")} ${pc.dim("— composable SaaS accelerator for Cloudflare")}\n`
  );
  console.log(
    `${pc.bold("Usage:")} saasaloy ${pc.cyan("<command>")} [options]\n`
  );
  console.log(pc.bold("Commands:"));
  for (const [name, command] of Object.entries(registry)) {
    console.log(`  ${pc.cyan(name.padEnd(6))} ${pc.dim(command.describe)}`);
  }
}

// Bare invocation on a terminal: show what the tool can do and run the choice, rather
// than making a newcomer read a list, quit, and retype. Options are mapped from the
// registry, never listed by hand, and each carries its `describe` as a hint — which is
// why no help is printed above the picker; that would render the same list twice.
// No intro()/outro() here either: the chosen command opens its own, so the handoff reads
// as one continuous clack rail instead of two stacked boxes.
async function pickCommand(deps: CliDeps): Promise<number> {
  const { registry, select, isCancel } = deps;
  const picked = await select({
    message: "What would you like to do?",
    options: Object.entries(registry).map(([name, command]) => ({
      value: name,
      label: name,
      hint: command.describe,
    })),
  });
  if (isCancel(picked)) {
    cancel("cancelled");
    return 1;
  }
  // The options were mapped from this registry's own keys, so a miss can't happen; the
  // guard is what lets TypeScript narrow the lookup.
  const command = registry[picked];
  if (!command) {
    return 1;
  }
  // Hand off with an empty argv: every command already asks for what it needs (`init`
  // prompts for a name, `add`/`remove` open their module pickers), so the picker
  // deliberately teaches itself nothing about any command's argument shape.
  return command.run([]);
}

export async function main(
  argv: string[],
  deps: Partial<CliDeps> = {}
): Promise<number> {
  const {
    registry = COMMANDS,
    select = clackSelect,
    isCancel = clackIsCancel,
  } = deps;
  const [name, ...rest] = argv;

  if (name === "--version" || name === "-v" || name === "version") {
    console.log(await cliVersion());
    return 0;
  }

  // Explicit help is never the picker, on a TTY as much as anywhere.
  if (name === "--help" || name === "-h" || name === "help") {
    printHelp(registry);
    return 0;
  }

  if (!name) {
    // No TTY (CI, piped stdin, `saasaloy | cat`) → the exact help and exit code this
    // printed before the picker existed. A prompt nobody can answer would hang.
    if (!isInteractive()) {
      printHelp(registry);
      return 0;
    }
    return pickCommand({ registry, select, isCancel });
  }

  // Own keys only: a plain object inherits `toString`, `constructor`, `valueOf` and the
  // rest from Object.prototype, and every one of them is truthy — so a bare `registry[name]`
  // lets `saasaloy toString` past this guard and dies on `.run` instead of saying what it
  // should, that the command is unknown.
  const command = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!command) {
    console.error(`${pc.red("Unknown command:")} ${name}\n`);
    printHelp(registry);
    return 1;
  }

  return command.run(rest);
}
