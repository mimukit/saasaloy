import { runAdd } from "./add.js";
import { DESCRIPTIONS } from "./descriptions.js";
import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";
import { runList } from "./list.js";
import { runOutdated } from "./outdated.js";
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
// inspect → refresh → undo → browse), then the author-facing `doctor`, and it is the
// order both help and the picker render. `outdated` sits directly before `update`
// because it is the question `update` is the answer to. Append with that in mind. No
// explicit `order`/`group` field until the list outgrows a single screen.
export const COMMANDS: CommandRegistry = {
  init: { describe: DESCRIPTIONS.init, run: runInit },
  add: { describe: DESCRIPTIONS.add, run: runAdd },
  outdated: { describe: DESCRIPTIONS.outdated, run: runOutdated },
  update: { describe: DESCRIPTIONS.update, run: runUpdate },
  remove: { describe: DESCRIPTIONS.remove, run: runRemove },
  list: { describe: DESCRIPTIONS.list, run: runList },
  doctor: { describe: DESCRIPTIONS.doctor, run: runDoctor },
};
