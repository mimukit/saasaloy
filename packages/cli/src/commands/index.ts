import { runAdd } from "./add.js";
import { runInit } from "./init.js";
import { runList } from "./list.js";
import { runRemove } from "./remove.js";
import { runUpdate } from "./update.js";

// The command registry. It is the single source both consumers in `../cli.ts` read —
// `printHelp()` and the bare-invocation picker — so a new command is one entry here and
// shows up in help and in the picker with no second list to keep in sync.

export interface Command {
  describe: string;
  run: (argv: string[]) => Promise<number> | number;
}

export type CommandRegistry = Record<string, Command>;

// Insertion order is deliberate: it is the lifecycle a user walks (scaffold → compose →
// undo → browse), and it is the order both help and the picker render. Append with that
// in mind. No explicit `order`/`group` field until the list outgrows a single screen.
export const COMMANDS: CommandRegistry = {
  init: {
    describe:
      "scaffold a new Saasaloy project (base: Astro landing + ui + config)",
    run: runInit,
  },
  add: {
    describe: "apply a module into the current project (resolves dependsOn)",
    run: runAdd,
  },
  update: {
    describe:
      "re-apply modules at a newer ref, with a merge plan for anything you edited",
    run: runUpdate,
  },
  remove: {
    describe: "undo a module's applied files via the manifest (offline)",
    run: runRemove,
  },
  list: {
    describe: "list available modules",
    run: runList,
  },
};
