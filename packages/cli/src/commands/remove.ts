import { cancel, intro, isCancel, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { apply } from "../engine/apply.js";
import type { ApplyReport } from "../engine/apply.js";
import {
  assertReadyToRun,
  loadSide,
  readProjectState,
} from "../engine/project.js";
import { closure, fixedOrder } from "../engine/render.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_REFUSED } from "../lib/exit.js";
import { createOutput } from "../lib/json-output.js";
import type { Output } from "../lib/json-output.js";
import { select } from "../lib/prompts.js";
import { findProjectRoot } from "../lib/project.js";
import { listLabel } from "../lib/requested.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import {
  abortRun,
  assertSameRelease,
  confirmApply,
  NO_TERMINAL_TO_CONFIRM,
  printDiffs,
  printReportLines,
  printSteps,
  sideSpec,
  summarize,
} from "./apply-run.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy remove <module>`: one apply from the lock's `requested` list to that list
// without the module (plan 0116). A remove is a render without the module, so every edit
// the module made goes with it, a patch included, and nothing needs an inverse.
//
// A file the module wrote and the project never changed is deleted. A file the project
// changed stays, untracked, with one report line, because the CLI never deletes a file it
// did not write (ADR 0034). A file both still render merges three ways. The clean-tree
// rule: the run refuses only when it must merge or delete a file with uncommitted
// changes; `--force` overrides it.

const KNOWN_FLAGS = new Set([
  "--dry-run",
  "--diff",
  "--yes",
  "-y",
  "--force",
  "--abort",
  "--help",
  "-h",
]);

const USAGE =
  "saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force] | saasaloy remove --abort";
const HELP: CommandHelp = {
  name: "remove",
  describe: DESCRIPTIONS.remove,
  usage: USAGE,
  flags: {
    "--dry-run": "show the plan and delete nothing",
    "--diff": "show what each deletion removes, and delete nothing",
    "-y, --yes": "skip the confirmation prompt",
    "--force":
      "delete and merge even over uncommitted changes, and overwrite edited generated files",
    "--abort":
      "put back the files the last add, remove, update or testing run changed",
  },
};

interface Options {
  name: string | undefined;
  dryRun: boolean;
  diff: boolean;
  yes: boolean;
  force: boolean;
}

export async function runRemove(argv: string[]): Promise<number> {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const unknown = [
    ...argv.filter((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg)),
    ...positional.slice(1),
  ];
  if (unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }
  const out = createOutput(false);
  const { tui } = out;
  intro(pc.bgCyan(pc.black(" saasaloy remove ")), tui);
  if (unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  const has = (flag: string): boolean => argv.includes(flag);
  try {
    const root = await findProjectRoot();
    if (has("--abort")) {
      return await abortRun(root, tui);
    }
    return await removeModule(root, out, {
      diff: has("--diff"),
      dryRun: has("--dry-run"),
      force: has("--force"),
      name: positional[0],
      yes: has("--yes") || has("-y"),
    });
  } catch (error) {
    return out.fail(error);
  }
}

async function removeModule(
  root: string,
  out: Output,
  opts: Options
): Promise<number> {
  const { tui } = out;
  const cliVersion = await readVersion();
  const preview = opts.dryRun || opts.diff;
  if (!opts.yes && !preview && !process.stdin.isTTY) {
    return out.refuse(NO_TERMINAL_TO_CONFIRM, EXIT_REFUSED);
  }
  await assertReadyToRun(root);
  const state = await readProjectState(root);
  assertSameRelease(state, cliVersion, "remove");

  let name = opts.name;
  if (name === undefined) {
    if (state.requested.length === 0) {
      note("No module is installed.", "Nothing to remove", tui);
      outro(pc.dim("nothing to do"), tui);
      return EXIT_OK;
    }
    const picked = await select({
      answeredBy: "`<module>`",
      message: "Pick a module to remove",
      options: state.requested.map((value) => ({ label: value, value })),
    });
    if (isCancel(picked)) {
      cancel("remove cancelled", tui);
      return EXIT_FAILURE;
    }
    name = picked;
  }
  if (!state.installed.includes(name)) {
    return out.refuse(`${pc.cyan(name)} isn't installed.`, EXIT_REFUSED);
  }

  const version = state.version ?? cliVersion;
  const previous = await loadSide(sideSpec(state, state.requested, version), {
    cliVersion,
  });
  const remaining = state.requested.filter((entry) => entry !== name);
  const coordinates = new Map(state.coordinates);
  coordinates.delete(name);
  // The modules that keep `name` in the set: a module cannot render without its
  // prerequisite, so `--force` does not override this one.
  const dependents = remaining.filter((other) =>
    closure(previous.side.payload, [other]).has(name)
  );
  if (dependents.length > 0) {
    return out.refuse(
      state.requested.includes(name)
        ? `${pc.cyan(name)} is still depended on by ${listLabel(dependents)}. Remove ${dependents.length === 1 ? "it" : "them"} first.`
        : `${pc.cyan(name)} was installed as a prerequisite of ${listLabel(dependents)}. Remove ${dependents.length === 1 ? "it" : "them"} instead.`,
      EXIT_REFUSED
    );
  }
  const next = await loadSide(
    sideSpec(state, remaining, version, coordinates),
    { cliVersion }
  );
  const before = closure(previous.side.payload, state.requested);
  const after = closure(next.side.payload, remaining);
  const removed = fixedOrder(previous.side.payload.modules, before).filter(
    (module) => !after.has(module)
  );
  for (const module of removed) {
    for (const warning of previous.side.payload.modules.get(module)?.item
      .removeWarnings ?? []) {
      log.warn(`${pc.cyan(module)}: ${warning}`, tui);
    }
  }

  const run = (dryRun: boolean): Promise<ApplyReport> =>
    apply({
      cleanTree: dryRun ? "none" : "touched",
      dryRun,
      force: opts.force,
      next: next.side,
      previous: previous.side,
      provenance: next.provenance,
      root,
      version: cliVersion,
    });
  const plan = await run(true);
  summarize(plan, `Remove ${removed.join(", ")}`, tui);
  if (opts.diff) {
    printDiffs(plan, tui);
  }
  if (preview) {
    printReportLines(plan, tui);
    outro(
      pc.dim(
        opts.diff ? "diff only — nothing removed" : "dry run — nothing removed"
      ),
      tui
    );
    return EXIT_OK;
  }
  const declined = await confirmApply(opts.yes, "remove", tui);
  if (declined !== undefined) {
    return declined;
  }
  const report = await run(false);
  printSteps(report, tui);
  printReportLines(report, tui);
  outro(
    pc.green(`Removed ${removed.map((module) => pc.bold(module)).join(", ")}`),
    tui
  );
  return report.exitCode;
}
