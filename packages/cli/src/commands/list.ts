import { cancel, intro, note, outro } from "@clack/prompts";
import { join } from "node:path";
import pc from "picocolors";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { pathExists } from "../lib/fs-utils.js";
import { findProjectRoot } from "../lib/project.js";
import {
  createRegistrySource,
  parseCoordinate,
  REGISTRY_ENV,
} from "../lib/registry.js";
import type { RegistrySource } from "../lib/registry.js";
import { CONFIG_FILE, loadConfig } from "../lib/saasaloy-config.js";
import { wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy list [owner/repo[@ref]]` — enumerate the modules a registry offers, the same
// seam `add`'s picker reads from. With no argument it lists the default repo (or the local
// modules/ checkout when SAASALOY_REGISTRY_DIR is set); an `owner/repo` coordinate lists a
// third-party registry. Names only — matching the picker — so it stays a cheap, one-call
// lookup (no per-module descriptor fetch).
//
// Run inside a project, each name is marked installed or not, and anything installed the
// registry no longer offers is listed under its own heading. Before #98 the output was a
// flat list a user had to diff against saasaloy.json by hand.

interface Options {
  source?: string;
  /** Show only what this project has installed. */
  installed: boolean;
  /** Show only what the registry offers and this project has not installed. */
  available: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--installed", "--available", "--help", "-h"]);
const USAGE = "saasaloy list [<owner/repo[@ref]>] [--installed] [--available]";
const HELP: CommandHelp = {
  name: "list",
  describe: DESCRIPTIONS.list,
  usage: USAGE,
  flags: {
    "--installed": "list only the modules this project has installed",
    "--available": "list only the modules this project has not installed",
  },
};

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const unknown: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      positional.push(arg);
    } else if (!KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  unknown.push(...positional.slice(1));
  return {
    available: argv.includes("--available"),
    installed: argv.includes("--installed"),
    source: positional[0],
    unknown,
  };
}

interface LocalProject {
  /** Modules `saasaloy add` applied here. */
  installed: Set<string>;
  /** The base app `init` scaffolded, which is not a module and is in no registry. */
  base?: string;
}

/**
 * What this project has, or nothing when `list` is run outside one. Listing a registry
 * from anywhere is the point of the command, so a missing `saasaloy.json` is not an error
 * here — it only means nothing can be marked.
 *
 * Test for the file rather than catching whatever `loadConfig` throws. A bare catch also
 * swallowed a corrupt or schema-invalid `saasaloy.json`, so a project whose config would
 * stop every other command read here as "not in a project" and quietly lost its installed
 * marks. Only absence is tolerated; a file that is there and will not load is reported
 * through the caller's own error path (#98).
 */
async function localProject(): Promise<LocalProject> {
  const root = await findProjectRoot();
  if (!(await pathExists(join(root, CONFIG_FILE)))) {
    return { installed: new Set() };
  }
  const config = await loadConfig(root);
  return {
    installed: new Set(config.installed),
    ...(config.base === undefined ? {} : { base: config.base }),
  };
}

export async function runList(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  intro(pc.bgCyan(pc.black(" saasaloy list ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }
  if (opts.installed && opts.available) {
    cancel(
      `\`--installed\` and \`--available\` exclude each other — pass neither to see both.`
    );
    return EXIT_REFUSED;
  }

  let source: RegistrySource | undefined;
  try {
    const coord = parseCoordinate(opts.source);
    source = createRegistrySource(coord);
    if (process.env[REGISTRY_ENV] && (coord.owner || coord.repo)) {
      note(
        `Ignoring source "${coord.owner}/${coord.repo}" — ${REGISTRY_ENV} override is set.`,
        pc.yellow("Warning")
      );
    }

    const project = await localProject();
    const installed = project.installed;
    const modules = await source.listModules();
    if (modules.length === 0) {
      note(`No modules found in ${source.label}.`, "Registry");
      outro(pc.dim("0 modules"));
      return EXIT_OK;
    }

    const offeredAndInstalled = modules.filter((name) => installed.has(name));
    const offeredOnly = modules.filter((name) => !installed.has(name));
    // Installed here but absent from this registry: a module from another registry, or
    // one renamed upstream. Say so rather than omitting it. The base app is not in this
    // list — it is not a module, so no registry ever offers it.
    const elsewhere = [...installed]
      .filter((name) => !modules.includes(name))
      .toSorted();

    const shown: string[] = [];
    if (!opts.available) {
      shown.push(...offeredAndInstalled);
    }
    if (!opts.installed) {
      shown.push(...offeredOnly);
    }

    const lines = shown.map((name) =>
      installed.has(name)
        ? `${pc.green("✔")} ${pc.cyan(name)} ${pc.dim("installed")}`
        : `${pc.dim("·")} ${pc.cyan(name)}`
    );
    if (lines.length === 0) {
      lines.push(
        pc.dim(
          opts.installed
            ? "nothing from this registry is installed here"
            : "every module this registry offers is already installed"
        )
      );
    }
    if (elsewhere.length > 0 && !opts.available) {
      lines.push(
        "",
        pc.dim(`installed but not in this registry: ${elsewhere.join(", ")}`)
      );
    }
    if (project.base && !opts.available && !opts.installed) {
      lines.push(
        "",
        pc.dim(
          `base app: ${project.base} — scaffolded by \`saasaloy init\`, not a module`
        )
      );
    }

    note(
      wrapForNote(lines.join("\n")),
      `Modules ${pc.dim(`(${source.label})`)}`
    );
    const total = shown.length;
    outro(
      pc.dim(
        `${total} module${total === 1 ? "" : "s"}${
          opts.installed || opts.available
            ? ""
            : ` · ${offeredAndInstalled.length} installed`
        }`
      )
    );
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  } finally {
    await source?.cleanup?.();
  }
}
