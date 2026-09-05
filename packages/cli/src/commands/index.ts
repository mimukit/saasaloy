import { runAdd } from "./add.js";
import { DESCRIPTIONS } from "./descriptions.js";
import { runDoctor } from "./doctor.js";
import { runEnv } from "./env.js";
import { runInit } from "./init.js";
import { runList } from "./list.js";
import { runNew } from "./new.js";
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
// configure → inspect → refresh → undo → browse), then the author-facing `new` and
// `doctor` — the pair a registry author uses and a consumer never does — and it
// is the order both help and the picker render. `env` sits directly after `add` because
// it is the step `add`'s own next-steps note sends you to, and `outdated` sits directly
// before `update` because it is the question `update` is the answer to. Append with that
// in mind. No explicit `order`/`group` field until the list outgrows a single screen.
export const COMMANDS: CommandRegistry = {
  init: { describe: DESCRIPTIONS.init, run: runInit },
  add: { describe: DESCRIPTIONS.add, run: runAdd },
  env: { describe: DESCRIPTIONS.env, run: runEnv },
  outdated: { describe: DESCRIPTIONS.outdated, run: runOutdated },
  update: { describe: DESCRIPTIONS.update, run: runUpdate },
  remove: { describe: DESCRIPTIONS.remove, run: runRemove },
  list: { describe: DESCRIPTIONS.list, run: runList },
  new: { describe: DESCRIPTIONS.new, run: runNew },
  doctor: { describe: DESCRIPTIONS.doctor, run: runDoctor },
};
