import { cancel, intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { apply } from "../engine/apply.js";
import {
  assertReadyToRun,
  loadSide,
  readProjectState,
} from "../engine/project.js";
import { closure, fixedOrder } from "../engine/render.js";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
  RefusalError,
} from "../lib/exit.js";
import { findProjectRoot } from "../lib/project.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import {
  parseTestingMode,
  readTestingMode,
  TESTING_MODES,
} from "../lib/testing.js";
import { TUI_ON_STDERR } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import {
  abortRun,
  assertSameRelease,
  printReportLines,
  printSteps,
  sideSpec,
} from "./apply-run.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy testing [mode]` (#242, ADR 0053). With no argument it prints the project's
// mode as a bare word, so a script can read it. With a mode it is one apply that renders
// the project for that mode (plan 0116): `saasaloy.json` records the mode, the testing
// block in the root `AGENTS.md` changes with it (a three-way merge keeps the owner's own
// text), and each gated test file whose `when` now holds is written.
//
// `off` deletes nothing (ADR 0053). A test file the project holds may be the owner's own
// work, so each gated file stays on disk and the manifest stops tracking it. The rules of
// `add` hold too: the project's release must be the running CLI's, and the run refuses
// when it must merge a file with uncommitted changes.

export interface Options {
  /** The mode to set, raw; absent means "print the mode". */
  mode?: string;
  abort: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--abort", "--help", "-h"]);
const USAGE = `saasaloy testing [${TESTING_MODES.join("|")}] | saasaloy testing --abort`;
const HELP: CommandHelp = {
  name: "testing",
  describe: DESCRIPTIONS.testing,
  usage: USAGE,
  flags: {
    "--abort":
      "put back the files the last add, remove, update or testing run changed",
  },
};

export function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const unknown: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      positional.push(arg);
    } else if (!KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  const abort = argv.includes("--abort");
  // `--abort` takes no mode: a mode beside it is reported, not run.
  unknown.push(...positional.slice(abort ? 0 : 1));
  return {
    abort,
    ...(positional[0] === undefined || abort ? {} : { mode: positional[0] }),
    unknown,
  };
}

async function printMode(): Promise<number> {
  try {
    const config = await loadConfig(await findProjectRoot());
    process.stdout.write(`${readTestingMode(config)}\n`);
    return EXIT_OK;
  } catch (error) {
    // stderr, so stdout carries the mode word or nothing at all.
    cancel(formatFailure(error), TUI_ON_STDERR);
    return exitCodeFor(error);
  }
}

export async function runTesting(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }
  if (opts.unknown.length === 0 && opts.mode === undefined && !opts.abort) {
    return printMode();
  }

  intro(pc.bgCyan(pc.black(" saasaloy testing ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  try {
    const root = await findProjectRoot();
    if (opts.abort) {
      return await abortRun(root, {});
    }
    const mode = parseTestingMode(opts.mode ?? "");
    const cliVersion = await readVersion();
    await assertReadyToRun(root);
    const state = await readProjectState(root);
    assertSameRelease(state, cliVersion, `testing ${mode}`);

    const version = state.version ?? cliVersion;
    const previous = await loadSide(sideSpec(state, state.requested, version), {
      cliVersion,
    });
    const payload = previous.side.payload;
    // A module that turns testing on keeps it on (ADR 0054): the render cannot be off.
    const enabler = fixedOrder(
      payload.modules,
      closure(payload, state.requested)
    ).find((name) => payload.modules.get(name)?.item.enablesTesting === true);
    if (mode === "off" && enabler !== undefined) {
      throw new RefusalError(
        `${enabler} turns testing on, so the mode cannot be off while it is installed. Nothing was written.`
      );
    }
    const next = await loadSide(
      sideSpec(state, state.requested, version, state.coordinates, {
        ...state.options,
        testingMode: mode,
      }),
      { cliVersion }
    );
    const report = await apply({
      cleanTree: "touched",
      // The set does not change, so the only tracked files the new render drops are the
      // gated test files: `off` keeps each one on disk.
      keep: Object.keys(state.manifest.files),
      next: next.side,
      previous: previous.side,
      provenance: next.provenance,
      root,
      version: cliVersion,
    });
    printSteps(report, {});
    printReportLines(report, {});
    if (report.results.some((result) => result.kind === "untracked")) {
      log.info(
        "The test files stay on disk and are yours now: `off` deletes nothing."
      );
    }
    outro(pc.green(`Testing mode: ${mode}.`));
    return report.exitCode;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }
}
