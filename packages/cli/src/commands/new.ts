import { join, relative, resolve } from "node:path";
import {
  cancel,
  intro,
  isCancel,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import { checkTarget, resolveDoctorTarget } from "../lib/doctor.js";
import type { Finding } from "../lib/doctor.js";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { pathExists } from "../lib/fs-utils.js";
import {
  isModuleType,
  MODULE_TYPES,
  nameProblem,
  parseDependsOn,
  REGISTRY_DIR,
  requiresRange,
  TYPE_HINTS,
  writeModule,
} from "../lib/new-module.js";
import type { ModuleSpec, ModuleType } from "../lib/new-module.js";
import { findProjectRoot } from "../lib/project.js";
import { CONFIG_FILE } from "../lib/saasaloy-config.js";
import { isInteractive, wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy new module <name>` — the registry author's scaffold (#50).
//
// Before this the only way to start a module was the `create-module` skill, which made
// authoring a Claude Code feature rather than a CLI one. That is the wrong shape for a
// registry meant to take third-party modules: the skeleton is mechanical, so the tool
// writes it and the skill keeps the judgment about tiers, conventions and slices.
//
// It refuses inside a generated project. `modules/` in a consumer's repo means nothing —
// a project installs modules, it does not host them — and a scaffold landing there is a
// folder the user finds later with no idea what put it there.
//
// The noun is a positional rather than a second registry key, so `COMMANDS` stays the flat
// map `cli.ts` renders help and the picker from. `module` is the only noun today.

/** The nouns `new` knows. Named in the refusal, so adding one updates the message too. */
const NOUNS = ["module"] as const;

export interface Options {
  /** The noun — `module`. Absent when the picker handed off with an empty argv. */
  noun?: string;
  name?: string;
  /** `--type <tier>`: skips the two-tier prompt, for a non-interactive run. */
  type?: string;
  /** `--depends-on <a,b>`: skips the dependency prompt. */
  dependsOn?: string;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--help", "-h"]);
const VALUE_FLAGS = new Set(["--type", "--depends-on"]);
const USAGE = "saasaloy new module <name> [--type <tier>] [--depends-on <a,b>]";
const HELP: CommandHelp = {
  name: "new",
  describe: DESCRIPTIONS.new,
  usage: USAGE,
  flags: {
    "--type <tier>": `${MODULE_TYPES.join(" | ")} — skips the prompt`,
    "--depends-on <a,b>":
      "comma-separated capabilities this module needs — skips the prompt",
  },
};

export function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const unknown: string[] = [];
  const values: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    // `--type feature` and `--type=feature` both work, and a value flag with nothing
    // usable after it is a usage error rather than a silently empty tier — otherwise
    // `--type --depends-on api` scaffolds a module whose type is "--depends-on".
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (VALUE_FLAGS.has(flag)) {
      const next = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
      if (!next || (eq === -1 && next.startsWith("-"))) {
        unknown.push(`${flag} (missing value)`);
        continue;
      }
      if (eq === -1) {
        i++;
      }
      values[flag] = next;
      continue;
    }
    if (!KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  // Two positionals are the whole grammar: the noun and the name.
  unknown.push(...positional.slice(2));

  return {
    ...(positional[0] === undefined ? {} : { noun: positional[0] }),
    ...(positional[1] === undefined ? {} : { name: positional[1] }),
    ...(values["--type"] === undefined ? {} : { type: values["--type"] }),
    ...(values["--depends-on"] === undefined
      ? {}
      : { dependsOn: values["--depends-on"] }),
    unknown,
  };
}

/** One doctor finding as a line, in the shape `saasaloy doctor` prints. */
export function renderFindings(findings: Finding[]): string[] {
  return findings.map(
    (found) => `${pc.yellow(found.where)} ${pc.dim(found.message)}`
  );
}

export async function runNew(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  intro(pc.bgCyan(pc.black(" saasaloy new ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  // The picker hands off an empty argv, and `module` is the only noun there is, so an
  // absent noun is the one the user meant rather than a question worth asking.
  const noun = opts.noun ?? NOUNS[0];
  if (!(NOUNS as readonly string[]).includes(noun)) {
    cancel(
      `\`saasaloy new ${noun}\` isn't a thing — the noun is one of: ${NOUNS.join(", ")}.`
    );
    return EXIT_REFUSED;
  }

  try {
    // A generated project carries `saasaloy.json`, at its root or above the current
    // directory. `new module` authors a *registry* module, so landing one in a consumer's
    // repo would write a folder nothing there reads.
    const projectRoot = await findProjectRoot();
    if (await pathExists(join(projectRoot, CONFIG_FILE))) {
      cancel(
        `${CONFIG_FILE} is present at ${pc.cyan(projectRoot)} — this is a generated project, and ` +
          `\`new module\` authors a module for a registry. Run it in the registry repo instead. Nothing was written.`
      );
      return EXIT_REFUSED;
    }

    let name = opts.name;
    if (name === undefined) {
      if (!isInteractive()) {
        cancel(`No module name — usage: \`${USAGE}\`.`);
        return EXIT_REFUSED;
      }
      const answer = await text({
        message: "Module name (lowercase, digits, hyphens)",
        validate: (value) => nameProblem((value ?? "").trim()),
      });
      if (isCancel(answer)) {
        cancel("Cancelled — nothing written.");
        return EXIT_REFUSED;
      }
      name = answer.trim();
    }

    const problem = nameProblem(name);
    if (problem) {
      cancel(`${problem} Nothing was written.`);
      return EXIT_REFUSED;
    }

    // Prove the folder is free before asking anything: a scaffold that merges into a
    // descriptor somebody wrote would overwrite it, and answering three prompts first
    // only to be refused wastes them.
    const registryDir = resolve(process.cwd(), REGISTRY_DIR);
    const dir = join(registryDir, name);
    if (await pathExists(dir)) {
      cancel(
        `${pc.cyan(`${REGISTRY_DIR}/${name}`)} already exists — pick another name, or edit it by hand. Nothing was written.`
      );
      return EXIT_REFUSED;
    }

    let type: ModuleType;
    if (opts.type !== undefined) {
      if (!isModuleType(opts.type)) {
        cancel(
          `\`--type ${opts.type}\` isn't a tier — use ${MODULE_TYPES.join(" or ")}.`
        );
        return EXIT_REFUSED;
      }
      type = opts.type;
    } else if (isInteractive()) {
      const picked = await select({
        message: "Which tier is this?",
        options: MODULE_TYPES.map((value) => ({
          hint: TYPE_HINTS[value],
          label: value,
          value,
        })),
      });
      if (isCancel(picked)) {
        cancel("Cancelled — nothing written.");
        return EXIT_REFUSED;
      }
      type = picked;
    } else {
      // No terminal to ask on: a prompt nobody can answer is a hang, and a hang in CI is
      // worse than a refusal that names the flag carrying the same answer.
      cancel(
        `No tier — pass ${MODULE_TYPES.map((tier) => `\`--type ${tier}\``).join(" or ")} when there is no terminal to ask.`
      );
      return EXIT_REFUSED;
    }

    let dependsOn: string[] = [];
    if (opts.dependsOn !== undefined) {
      dependsOn = parseDependsOn(opts.dependsOn);
    } else if (isInteractive()) {
      const answer = await text({
        defaultValue: "",
        message: `Capabilities it depends on ${pc.dim("(comma-separated, blank for none)")}`,
        placeholder: "api, database",
      });
      if (isCancel(answer)) {
        cancel("Cancelled — nothing written.");
        return EXIT_REFUSED;
      }
      dependsOn = parseDependsOn(answer);
    }

    const requires = requiresRange(await readVersion());
    const spec: ModuleSpec = {
      dependsOn,
      name,
      type,
      ...(requires === undefined ? {} : { requires }),
    };
    const written = await writeModule(dir, spec);

    const shown = relative(process.cwd(), dir) || dir;
    note(
      wrapForNote(
        written
          .map((path) => `${pc.green("create")} ${shown}/${path}`)
          .join("\n")
      ),
      "Written"
    );

    // Run the same checks `saasaloy doctor` runs, in-process. Shelling out to the binary
    // would need one installed, and the scaffold's whole promise is that what it writes
    // passes — proving it here means a change to either side is caught by the other.
    const reports = await checkTarget(await resolveDoctorTarget(dir));
    const findings = reports.flatMap((report) => report.findings);
    if (findings.length > 0) {
      // Reported, not refused: the files are on disk and correct enough to edit, and the
      // usual cause is a `dependsOn` naming a module this registry does not offer — the
      // author's own input, which they fix in the descriptor rather than by rerunning.
      note(wrapForNote(renderFindings(findings).join("\n")), "Doctor");
      outro(
        pc.yellow(
          `Scaffolded with ${findings.length} finding${findings.length === 1 ? "" : "s"} — fix ${shown}/registry-item.json, then \`saasaloy doctor ${shown}\`.`
        )
      );
      return EXIT_OK;
    }

    outro(
      pc.green(
        `${name} is ready — put its payload in ${shown}/files/ and write its runbook in ${shown}/skills/.`
      )
    );
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }
}
