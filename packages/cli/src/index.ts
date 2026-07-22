#!/usr/bin/env node
// saasaloy CLI entrypoint. Thin dispatcher; each command lives in commands/.
// Roadmap (docs/plans/saasaloy-build-spec.md): Phase 0 `init`, Phase 1 `add`/`list`.

import pc from "picocolors";
import { runAdd } from "./commands/add.js";
import { runInit } from "./commands/init.js";
import { runList } from "./commands/list.js";

interface Command {
  describe: string;
  run: (argv: string[]) => Promise<number> | number;
}

const COMMANDS: Record<string, Command> = {
  init: {
    describe: "scaffold a new Saasaloy project (base: Astro landing + ui + config)",
    run: runInit,
  },
  add: {
    describe: "apply a module into the current project (resolves dependsOn)",
    run: runAdd,
  },
  list: {
    describe: "list available modules",
    run: runList,
  },
};

function printHelp(): void {
  console.log(`${pc.bold("saasaloy")} ${pc.dim("— composable SaaS accelerator for Cloudflare")}\n`);
  console.log(`${pc.bold("Usage:")} saasaloy ${pc.cyan("<command>")} [options]\n`);
  console.log(pc.bold("Commands:"));
  for (const [name, command] of Object.entries(COMMANDS)) {
    console.log(`  ${pc.cyan(name.padEnd(6))} ${pc.dim(command.describe)}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;

  if (!name || name === "--help" || name === "-h" || name === "help") {
    printHelp();
    return 0;
  }

  const command = COMMANDS[name];
  if (!command) {
    console.error(`${pc.red("Unknown command:")} ${name}\n`);
    printHelp();
    return 1;
  }

  return command.run(rest);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
