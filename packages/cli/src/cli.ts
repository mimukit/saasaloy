import {
  cancel,
  isCancel as clackIsCancel,
  select as clackSelect,
} from "@clack/prompts";
import pc from "picocolors";
import type { CommandRegistry } from "./commands/index.js";
import { COMMANDS } from "./commands/index.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_REFUSED } from "./lib/exit.js";
import { isInteractive } from "./lib/tui.js";
import { readVersion } from "./version.js";

// Re-exported so `saasaloy --version` and this module's tests keep one import site; the
// reader itself lives in version.ts, which commands/add.ts also imports (#50).
export { readVersion } from "./version.js";

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
  console.log(`\n${pc.bold("Options:")}`);
  console.log(
    `  ${pc.cyan("-h, --help".padEnd(14))} ${pc.dim("show this help, or a command's own usage")}`
  );
  console.log(
    `  ${pc.cyan("-v, --version".padEnd(14))} ${pc.dim("print the installed saasaloy version")}`
  );
  console.log(`\n${pc.bold("Exit codes:")}`);
  console.log(
    `  ${pc.cyan("0".padEnd(14))} ${pc.dim("done, or you answered no to the confirm")}`
  );
  console.log(
    `  ${pc.cyan("1".padEnd(14))} ${pc.dim("something failed, or you cancelled")}`
  );
  console.log(
    `  ${pc.cyan("2".padEnd(14))} ${pc.dim("saasaloy refused: bad usage, a conflict, an unmet requirement")}`
  );
  console.log(
    `\n${pc.dim("Set SAASALOY_DEBUG=1 to print the full cause chain behind a failure.")}`
  );
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
    return EXIT_FAILURE;
  }
  // The options were mapped from this registry's own keys, so a miss can't happen; the
  // guard is what lets TypeScript narrow the lookup.
  const command = registry[picked];
  if (!command) {
    return EXIT_FAILURE;
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

  // Explicit help is never the picker, on a TTY as much as anywhere.
  if (name === "--help" || name === "-h" || name === "help") {
    printHelp(registry);
    return EXIT_OK;
  }

  // `--version` before dispatch, so it answers even when the project is unscaffolded.
  if (name === "--version" || name === "-v" || name === "version") {
    console.log(await readVersion());
    return EXIT_OK;
  }

  if (!name) {
    // No TTY (CI, piped stdin, `saasaloy | cat`) → the exact help and exit code this
    // printed before the picker existed. A prompt nobody can answer would hang.
    if (!isInteractive()) {
      printHelp(registry);
      return EXIT_OK;
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
    // Bad usage is a refusal, not a failure — nothing broke, the input was wrong.
    return EXIT_REFUSED;
  }

  return command.run(rest);
}
