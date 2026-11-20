import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { cancel, intro, isCancel, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { abortApply, apply, checkCleanTree } from "../engine/apply.js";
import type { ApplyReport, PathResult, ResultKind } from "../engine/apply.js";
import { ensureCachedSnapshot } from "../engine/payload.js";
import type { Payload } from "../engine/payload.js";
import {
  assertReadyToRun,
  isLocalRegistry,
  loadSide,
  readProjectState,
} from "../engine/project.js";
import type {
  LoadedSide,
  ModuleCoordinate,
  ProjectState,
  SideSpec,
} from "../engine/project.js";
import { closure, fixedOrder } from "../engine/render.js";
import type { RenderOptions } from "../engine/render.js";
import {
  detectCliMismatches,
  formatCliMismatches,
  upgradeCommand,
} from "../lib/cli-requires.js";
import { lineDiff } from "../lib/diff.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_WORK_PENDING,
  formatFailure,
  RefusalError,
} from "../lib/exit.js";
import { pathExists, resolveWithinRoot } from "../lib/fs-utils.js";
import { createOutput, printJson } from "../lib/json-output.js";
import type { Output, TuiOptions } from "../lib/json-output.js";
import type { PendingNote } from "../lib/manifest.js";
import { matchDone, mergePendingNotes } from "../lib/pending-notes.js";
import { confirm, multiselect, select } from "../lib/prompts.js";
import { findProjectRoot } from "../lib/project.js";
import {
  DEFAULT_SOURCE,
  REGISTRY_ENV,
  releaseTag,
  RemoteRegistrySource,
} from "../lib/registry.js";
import { listLabel } from "../lib/requested.js";
import type { Graph } from "../lib/resolve.js";
import { compareVersions, parseVersion } from "../lib/semver.js";
import { isInteractive, TUI_ON_STDERR, wrapForNote } from "../lib/tui.js";
import { selectUpdateNotes } from "../lib/update-note-select.js";
import type { ModuleNoteSource } from "../lib/update-note-select.js";
import { baseUpdateNotesDir, UPDATE_NOTES_DIR } from "../lib/update-notes.js";
import type { UpdateNoteText } from "../lib/update-notes.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import {
  ADD_JSON_SCHEMA_VERSION,
  parseArgs as parseAddArgs,
  parseModuleRequest,
} from "./add-args.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `init`, `add`, `remove` and `update` on the render engine (plan 0116, Phase 4), behind
// `SAASALOY_ENGINE=next`. Each command is one `apply(oldLock, newLock)`:
//
//   init    from nothing to the base template
//   add     the lock's `requested` list plus the named modules
//   remove  the list minus the named module
//   update  the same list, moved to the running CLI's release
//
// The clean-tree rule (plan 0116, "Commands and safety"): `update` refuses a dirty tree,
// and `add` and `remove` refuse only when the run must merge or delete a file with
// uncommitted changes. `--force` overrides both. Every run first refuses a journal left by
// an unfinished run and a file that still holds conflict markers, with exit 2.
//
// Phase 6 makes this file the commands and deletes the old engine and the flag.

// --- Shared ------------------------------------------------------------------------------

const KIND_LABEL: Record<ResultKind, string> = {
  "already-equal": pc.dim("already equal"),
  "both-no-base": pc.yellow("merge, no base"),
  clean: pc.cyan("merge"),
  conflict: pc.yellow("conflict"),
  deleted: pc.red("delete"),
  "generated-overwritten": pc.yellow("overwrite"),
  gone: pc.dim("untrack"),
  "kept-deleted": pc.yellow("left deleted"),
  new: pc.green("create"),
  "no-base": pc.yellow("merge, no base"),
  "once-kept": pc.dim("kept"),
  "once-left": pc.yellow("upstream changed"),
  restored: pc.green("restore"),
  unchanged: pc.dim("unchanged"),
  updated: pc.cyan("update"),
  "upstream-deleted-owner-edited": pc.yellow("kept, untracked"),
};

/** The results a person reads: everything but the quiet kinds. */
function shownResults(report: ApplyReport): PathResult[] {
  return report.results.filter(
    (result) =>
      result.kind !== "unchanged" &&
      result.kind !== "already-equal" &&
      result.kind !== "gone"
  );
}

const MAX_DIFF_LINES = 60;

function renderDiff(result: PathResult): string {
  const lines = lineDiff(result.before ?? "", result.after ?? "").filter(
    (line) => line.kind !== "context"
  );
  const shown = lines
    .slice(0, MAX_DIFF_LINES)
    .map((line) =>
      line.kind === "add"
        ? pc.green(`+ ${line.text}`)
        : pc.red(`- ${line.text}`)
    );
  if (lines.length > MAX_DIFF_LINES) {
    shown.push(pc.dim(`  … ${lines.length - MAX_DIFF_LINES} more lines`));
  }
  return shown.join("\n");
}

function summarize(report: ApplyReport, title: string, tui: TuiOptions): void {
  const shown = shownResults(report);
  const body =
    shown.length === 0
      ? pc.dim("No file changes.")
      : shown
          .map((result) => `${KIND_LABEL[result.kind]}  ${result.path}`)
          .join("\n");
  note(wrapForNote(body), title, tui);
}

function printDiffs(report: ApplyReport, tui: TuiOptions): void {
  for (const result of report.results) {
    if (result.before === result.after) {
      continue;
    }
    note(renderDiff(result), `${KIND_LABEL[result.kind]}  ${result.path}`, tui);
  }
}

function printReportLines(report: ApplyReport, tui: TuiOptions): void {
  for (const line of report.lines) {
    if (line.startsWith("warning  ")) {
      log.warn(line.slice("warning  ".length), tui);
    } else if (line.startsWith("conflict  ")) {
      log.warn(line, tui);
    } else {
      log.info(line, tui);
    }
  }
}

/** `--abort` on any of the three commands: put back the newest backup. */
async function abortRun(root: string, tui: TuiOptions): Promise<number> {
  const restored = await abortApply(root);
  for (const target of restored.restored) {
    log.step(`${pc.green("restore")}  ${target}`, tui);
  }
  for (const target of restored.removed) {
    log.step(
      `${pc.red("remove")}  ${target} ${pc.dim("(the run created it)")}`,
      tui
    );
  }
  outro(
    pc.green(
      `Restored ${restored.restored.length} file${restored.restored.length === 1 ? "" : "s"} from ${restored.from}.`
    ),
    tui
  );
  return EXIT_OK;
}

/** Ask before a write. `undefined` means go on; a number is the exit code. */
async function confirmApply(
  yes: boolean,
  command: string,
  tui: TuiOptions
): Promise<number | undefined> {
  if (yes) {
    return undefined;
  }
  const proceed = await confirm({
    answeredBy: "`--yes` to apply, or `--dry-run` to preview",
    message: "Proceed?",
    ...(tui.output === undefined ? {} : { output: tui.output }),
  });
  if (isCancel(proceed)) {
    cancel(`${command} cancelled`, tui);
    return EXIT_FAILURE;
  }
  if (!proceed) {
    outro(pc.dim("aborted — nothing applied"), tui);
    return EXIT_OK;
  }
  return undefined;
}

/** A graph over a payload, for the checks `lib/` takes a `Graph` for. */
function graphOf(payload: Payload, names: Iterable<string>): Graph {
  const set = [...names];
  const modules: Graph["modules"] = new Map();
  for (const name of set) {
    const mod = payload.modules.get(name);
    if (mod !== undefined) {
      modules.set(name, { dir: "", item: mod.item });
    }
  }
  return { modules, order: fixedOrder(payload.modules, set) };
}

interface Unmet {
  declaredBy: string;
  options: string[];
}

/** Each `requiresOneOf` in the closure of `requested` that the closure does not meet. */
function unmetRequirements(
  payload: Payload,
  requested: readonly string[]
): Unmet[] {
  const set = closure(payload, requested);
  const unmet: Unmet[] = [];
  for (const name of fixedOrder(payload.modules, set)) {
    const options = payload.modules.get(name)?.item.requiresOneOf ?? [];
    if (options.length > 0 && !options.some((option) => set.has(option))) {
      unmet.push({ declaredBy: name, options: [...options] });
    }
  }
  return unmet;
}

/** Project-relative POSIX paths for `--restore` and `--merge`, as `update` has always read them. */
function matchPaths(
  root: string,
  paths: readonly string[],
  available: ReadonlySet<string>
): { matched: string[]; unmatched: string[] } {
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const path of paths) {
    const hit = [resolve(process.cwd(), path), resolve(root, path)]
      .map((abs) => relative(root, abs).split(sep).join("/"))
      .find(
        (candidate) =>
          candidate !== "" &&
          !candidate.startsWith("..") &&
          available.has(candidate)
      );
    if (hit === undefined) {
      unmatched.push(path);
    } else if (!matched.includes(hit)) {
      matched.push(hit);
    }
  }
  return { matched, unmatched };
}

/**
 * Refuse `add` and `remove` when the project sits at another release than the running
 * CLI: the run would move every default module too, which is `update`'s job (plan 0116,
 * "`saasaloy update <module>`"). A local registry checkout has no release, so it passes.
 */
function assertSameRelease(
  state: ProjectState,
  cliVersion: string,
  command: string
): void {
  if (isLocalRegistry() || state.version === undefined) {
    return;
  }
  if (state.version !== cliVersion) {
    throw new RefusalError(
      `This project is at saasaloy ${state.version}, and ${cliVersion} is running. ` +
        `Run \`saasaloy update\` to move it to ${cliVersion} first, or run \`pnpm dlx saasaloy@${state.version} ${command}\`. Nothing was written.`
    );
  }
}

function sideSpec(
  state: ProjectState,
  requested: readonly string[],
  version: string,
  coordinates: ReadonlyMap<string, ModuleCoordinate> = state.coordinates,
  options: RenderOptions = state.options
): SideSpec {
  return { coordinates, options, requested, version };
}

// --- init --------------------------------------------------------------------------------

/**
 * `init`'s scaffold on the render engine: one apply from nothing to the base template,
 * with the project's name and testing mode. Writes manifest version 2 and the lock with
 * an empty `requested` list. The caller has checked the target and the flags.
 */
export async function scaffoldNext(args: {
  target: string;
  projectName: string;
  testingMode: RenderOptions["testingMode"];
}): Promise<ApplyReport> {
  const cliVersion = await readVersion();
  const options: RenderOptions = {
    projectName: args.projectName,
    ...(args.testingMode === undefined
      ? {}
      : { testingMode: args.testingMode }),
  };
  const { side } = await loadSide(
    { coordinates: new Map(), options, requested: [], version: cliVersion },
    { cliVersion }
  );
  await mkdir(args.target, { recursive: true });
  return apply({ next: side, root: args.target, version: cliVersion });
}

// --- add ---------------------------------------------------------------------------------

const ADD_USAGE =
  "saasaloy add [<module>...|<owner/repo[@ref]/module>...] [--with <module>]... [--dry-run [--json]] [--diff] [--yes] [--force] | saasaloy add --abort";
const ADD_HELP: CommandHelp = {
  describe: DESCRIPTIONS.add,
  flags: {
    "--abort": "put back the files the last add, remove or update changed",
    "--diff": "show a per-file diff and write nothing",
    "--dry-run": "show the plan and write nothing",
    "--force":
      "write even over uncommitted changes, overwrite edited generated files, and write the deleted files of a named module again",
    "--json": "with --dry-run, print the plan as one JSON document on stdout",
    "--with <module>":
      "answer a `requiresOneOf` choice, e.g. `--with database-postgres` (repeatable)",
    "-y, --yes": "skip the confirmation prompt",
  },
  name: "add",
  usage: ADD_USAGE,
};

/** The plan as `add --dry-run --json` prints it on the render engine. */
export function nextPlanDocument(args: {
  requested: readonly string[];
  prerequisites: readonly string[];
  install: readonly string[];
  alreadyInstalled: readonly string[];
  report: ApplyReport | undefined;
}): Record<string, unknown> {
  const { report } = args;
  return {
    alreadyInstalled: [...args.alreadyInstalled],
    engine: "next",
    files: (report === undefined ? [] : shownResults(report)).map((result) => ({
      action: result.kind,
      class: result.class,
      module: result.module,
      target: result.path,
    })),
    install: [...args.install],
    onceChanged: report?.onceChanged ?? [],
    pendingMerges: report?.pendingMerges ?? [],
    prerequisites: [...args.prerequisites],
    requested: [...args.requested],
    warnings: report?.warnings ?? [],
  };
}

export async function runAddNext(argv: string[]): Promise<number> {
  const abort = argv.includes("--abort");
  const opts = parseAddArgs(argv.filter((arg) => arg !== "--abort"));
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(ADD_HELP);
    return EXIT_OK;
  }
  const out = createOutput(opts.json, ADD_JSON_SCHEMA_VERSION);
  const { tui } = out;
  intro(pc.bgCyan(pc.black(" saasaloy add ")), tui);
  if (opts.unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${ADD_USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  if (opts.json && (!opts.dryRun || opts.diff)) {
    return out.refuse(
      "`--json` prints the `--dry-run` plan — pass `--dry-run --json`, without `--diff`.",
      EXIT_REFUSED
    );
  }
  try {
    const root = await findProjectRoot();
    if (abort) {
      return await abortRun(root, tui);
    }
    return await addNext(root, opts, out);
  } catch (error) {
    return out.fail(error);
  }
}

async function listOffered(
  cliVersion: string,
  state: ProjectState
): Promise<string[]> {
  if (isLocalRegistry()) {
    return listModuleDirs(resolve(process.env[REGISTRY_ENV] ?? ""));
  }
  // The default registry at the project's release: one cached snapshot.
  const { snapshot } = await ensureCachedSnapshot({
    ref: releaseTag(state.version ?? cliVersion),
    source: DEFAULT_SOURCE,
  });
  return listModuleDirs(snapshot.modulesDir);
}

async function listModuleDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (await pathExists(join(dir, entry.name, "registry-item.json")))
    ) {
      names.push(entry.name);
    }
  }
  return names.toSorted();
}

async function addNext(
  root: string,
  opts: ReturnType<typeof parseAddArgs>,
  out: Output
): Promise<number> {
  const { tui } = out;
  const cliVersion = await readVersion();
  const request = parseModuleRequest(opts.names, ADD_USAGE);
  const coord = request.source;
  let { names } = request;
  const state = await readProjectState(root);
  await assertReadyToRun(root, state.manifest);
  assertSameRelease(state, cliVersion, "add");

  // Where the named modules come from: the default registry at the project's release, a
  // third-party registry at a commit, or a local checkout.
  const coordinates = new Map(state.coordinates);
  const thirdParty =
    coord.owner !== undefined &&
    `${coord.owner}/${coord.repo ?? ""}` !== DEFAULT_SOURCE;
  if (isLocalRegistry()) {
    if (coord.owner !== undefined || coord.repo !== undefined) {
      log.warn(
        `Ignoring source "${coord.owner ?? ""}/${coord.repo ?? ""}" — ${REGISTRY_ENV} override is set.`,
        tui
      );
    }
  } else if (thirdParty) {
    const remote = new RemoteRegistrySource(
      coord.owner ?? "",
      coord.repo ?? "",
      coord.ref
    );
    await remote.resolveSha();
    const provenance = remote.provenance();
    for (const name of names) {
      coordinates.set(name, provenance);
    }
  } else if (coord.ref !== undefined) {
    throw new RefusalError(
      `The default registry moves as one release on the render engine, so \`@${coord.ref}\` cannot pin one module. Run \`saasaloy update\` to move every module to this CLI's release.`
    );
  }

  const installed = new Set(state.installed);
  if (names.length === 0) {
    if (!isInteractive() || opts.json) {
      return out.refuse(
        `No module named and no terminal to pick one in — usage: \`${ADD_USAGE}\`.`,
        EXIT_REFUSED
      );
    }
    const available = (await listOffered(cliVersion, state)).filter(
      (name) => !installed.has(name)
    );
    if (available.length === 0) {
      note("Every module is already installed.", "Nothing to add", tui);
      outro(pc.dim("nothing to do"), tui);
      return EXIT_OK;
    }
    const picked = await multiselect({
      answeredBy: "one or more module names",
      message: `Pick modules to add ${pc.dim(`(${installed.size} already installed)`)}`,
      options: available.map((name) => ({ label: name, value: name })),
      required: true,
    });
    if (isCancel(picked)) {
      cancel("add cancelled", tui);
      return EXIT_FAILURE;
    }
    names = picked;
  }

  const forced = opts.force ? names.filter((name) => installed.has(name)) : [];
  const fresh = names.filter((name) => !installed.has(name));
  if (fresh.length === 0 && forced.length === 0) {
    if (opts.json) {
      printJson(
        nextPlanDocument({
          alreadyInstalled: names,
          install: [],
          prerequisites: [],
          report: undefined,
          requested: names,
        }),
        ADD_JSON_SCHEMA_VERSION
      );
    }
    note(
      `${listLabel(names.map((name) => pc.cyan(name)))} ${names.length === 1 ? "is" : "are"} already installed.`,
      "Nothing to do",
      tui
    );
    outro(
      pc.dim("use --force to write a named module's deleted files again"),
      tui
    );
    return EXIT_OK;
  }

  const cannotConfirm =
    !opts.yes && !opts.dryRun && !opts.diff && !process.stdin.isTTY;
  const version = state.version ?? cliVersion;
  const requested = [...new Set([...state.requested, ...fresh])];
  const load = (list: readonly string[]): Promise<LoadedSide> =>
    loadSide(sideSpec(state, list, version, coordinates), { cliVersion });

  // `requiresOneOf`: `--with` answers a choice up front, a terminal gets one prompt per
  // unmet choice, and anything else refuses and names the options.
  let next = await load([...requested, ...opts.with]);
  let unmet = unmetRequirements(next.side.payload, requested);
  const pending = new Set(opts.with);
  for (let progressed = true; pending.size > 0 && progressed;) {
    progressed = false;
    for (const name of pending) {
      if (!unmet.some((requirement) => requirement.options.includes(name))) {
        continue;
      }
      requested.push(name);
      pending.delete(name);
      unmet = unmetRequirements(next.side.payload, requested);
      progressed = true;
    }
  }
  if (pending.size > 0) {
    return out.refuse(
      `Cannot add ${listLabel(names)} — ${[...pending].map((name) => `--with ${name}`).join(", ")} answers no unmet requirement. ` +
        "`--with` picks one option of a `requiresOneOf` list; add any other module with its own `saasaloy add`.",
      EXIT_REFUSED
    );
  }
  const unmetMessage = (list: Unmet[]): string =>
    [
      `Cannot add ${listLabel(names)} — unmet requirement${list.length > 1 ? "s" : ""}:`,
      ...list.map(
        (requirement) =>
          `  ${requirement.declaredBy} needs one of: ${requirement.options.join(", ")}, and none is installed. Re-run as \`saasaloy add ${names.join(" ")} --with ${requirement.options[0] ?? ""}\`, or pick another from that list.`
      ),
    ].join("\n");
  if (unmet.length > 0 && (!isInteractive() || opts.yes || opts.json)) {
    return out.refuse(unmetMessage(unmet), EXIT_REFUSED);
  }
  for (let round = 0; unmet.length > 0 && round < 8; round++) {
    const requirement = unmet[0];
    if (requirement === undefined) {
      break;
    }
    const picked = await select({
      answeredBy: `\`--with <${requirement.options.join(" | ")}>\``,
      message: `${pc.cyan(requirement.declaredBy)} needs one of these — pick one`,
      options: requirement.options.map((name) => ({
        label: name,
        value: name,
      })),
    });
    if (isCancel(picked)) {
      cancel("add cancelled", tui);
      return EXIT_FAILURE;
    }
    requested.push(picked);
    next = await load(requested);
    unmet = unmetRequirements(next.side.payload, requested);
  }
  if (unmet.length > 0) {
    return out.refuse(unmetMessage(unmet), EXIT_REFUSED);
  }
  if (cannotConfirm) {
    return out.refuse(
      "No terminal to confirm in — re-run with `--yes` to apply, or `--dry-run` to preview.",
      EXIT_REFUSED
    );
  }
  next = await load(requested);

  const nextSet = closure(next.side.payload, requested);
  const mismatches = detectCliMismatches({
    cliVersion,
    graph: graphOf(next.side.payload, nextSet),
  });
  if (mismatches.length > 0) {
    return out.refuse(
      formatCliMismatches(mismatches, names.join(" "), cliVersion),
      EXIT_REFUSED
    );
  }
  const install = fixedOrder(next.side.payload.modules, nextSet).filter(
    (name) => !installed.has(name)
  );
  const prerequisites = install.filter((name) => !names.includes(name));
  const alreadyInstalled = names.filter(
    (name) => installed.has(name) && !forced.includes(name)
  );

  // `--force` on an installed module writes its tracked files the project deleted again.
  const restore: string[] = [];
  for (const [path, record] of Object.entries(state.manifest.files)) {
    if (
      forced.includes(record.module) &&
      !(await pathExists(resolveWithinRoot(root, path)))
    ) {
      restore.push(path);
    }
  }
  const previous = await load(state.requested);
  const run = (dryRun: boolean): Promise<ApplyReport> =>
    apply({
      cleanTree: dryRun ? "none" : "touched",
      dryRun,
      force: opts.force,
      next: next.side,
      previous: previous.side,
      provenance: next.provenance,
      restore,
      root,
      version: cliVersion,
    });

  const preview = await run(true);
  summarize(preview, "Plan", tui);
  if (opts.diff) {
    printDiffs(preview, tui);
  }
  if (opts.dryRun || opts.diff) {
    printReportLines(preview, tui);
    if (opts.json) {
      printJson(
        nextPlanDocument({
          alreadyInstalled,
          install,
          prerequisites,
          report: preview,
          requested: names,
        }),
        ADD_JSON_SCHEMA_VERSION
      );
    }
    outro(
      pc.dim(
        opts.diff ? "diff only — nothing applied" : "dry run — nothing applied"
      ),
      tui
    );
    return EXIT_OK;
  }
  const declined = await confirmApply(opts.yes, "add", tui);
  if (declined !== undefined) {
    return declined;
  }
  const report = await run(false);
  for (const result of shownResults(report)) {
    log.step(`${KIND_LABEL[result.kind]}  ${result.path}`, tui);
  }
  printReportLines(report, tui);
  if (report.changed.includes("package.json")) {
    log.info(
      `Run ${pc.cyan("pnpm install")} to fetch the new dependencies.`,
      tui
    );
  }
  outro(
    report.exitCode === EXIT_WORK_PENDING
      ? pc.yellow(
          `Applied ${install.join(", ") || names.join(", ")} with conflict markers — resolve them, then run \`pnpm check\`.`
        )
      : pc.green(
          `Applied ${install.map((name) => pc.bold(name)).join(", ") || names.join(", ")} ${pc.dim(`(${report.changed.length} files)`)}`
        ),
    tui
  );
  return report.exitCode;
}

// --- remove ------------------------------------------------------------------------------

const REMOVE_USAGE =
  "saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force] | saasaloy remove --abort";
const REMOVE_HELP: CommandHelp = {
  describe: DESCRIPTIONS.remove,
  flags: {
    "--abort": "put back the files the last add, remove or update changed",
    "--diff": "show what each deletion removes, and delete nothing",
    "--dry-run": "show the plan and delete nothing",
    "--force":
      "delete and merge even over uncommitted changes, and overwrite edited generated files",
    "-y, --yes": "skip the confirmation prompt",
  },
  name: "remove",
  usage: REMOVE_USAGE,
};

const REMOVE_FLAGS = new Set([
  "--dry-run",
  "--diff",
  "--yes",
  "-y",
  "--force",
  "--abort",
  "--help",
  "-h",
]);

export async function runRemoveNext(argv: string[]): Promise<number> {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const unknown = [
    ...argv.filter((arg) => arg.startsWith("-") && !REMOVE_FLAGS.has(arg)),
    ...positional.slice(1),
  ];
  if (unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(REMOVE_HELP);
    return EXIT_OK;
  }
  const out = createOutput(false);
  const { tui } = out;
  intro(pc.bgCyan(pc.black(" saasaloy remove ")), tui);
  if (unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${unknown.join(", ")} — usage: \`${REMOVE_USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  const has = (flag: string): boolean => argv.includes(flag);
  try {
    const root = await findProjectRoot();
    if (has("--abort")) {
      return await abortRun(root, tui);
    }
    return await removeNext(root, out, {
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

async function removeNext(
  root: string,
  out: Output,
  opts: {
    name: string | undefined;
    dryRun: boolean;
    diff: boolean;
    yes: boolean;
    force: boolean;
  }
): Promise<number> {
  const { tui } = out;
  const cliVersion = await readVersion();
  const state = await readProjectState(root);
  const preview = opts.dryRun || opts.diff;
  if (!opts.yes && !preview && !process.stdin.isTTY) {
    return out.refuse(
      "No terminal to confirm in — re-run with `--yes` to apply, or `--dry-run` to preview.",
      EXIT_REFUSED
    );
  }
  await assertReadyToRun(root, state.manifest);
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
    {
      cliVersion,
    }
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
  for (const result of shownResults(report)) {
    log.step(`${KIND_LABEL[result.kind]}  ${result.path}`, tui);
  }
  printReportLines(report, tui);
  outro(
    pc.green(`Removed ${removed.map((module) => pc.bold(module)).join(", ")}`),
    tui
  );
  return report.exitCode;
}

// --- update ------------------------------------------------------------------------------

const UPDATE_USAGE =
  "saasaloy update [--restore <path>]... [--merge <path>]... [--done <id>]... [--dry-run] [--diff] [--force] [--yes] | saasaloy update --abort";
const UPDATE_HELP: CommandHelp = {
  describe: DESCRIPTIONS.update,
  flags: {
    "--abort": "put back the files the last add, remove or update changed",
    "--diff": "show a per-file diff and write nothing",
    "--done <id>":
      "record an update note whose work is finished, so the report stops listing it (repeatable)",
    "--dry-run": "show the report and write nothing",
    "--force":
      "apply even with uncommitted changes in the working tree, and overwrite edited generated files",
    "--merge <path>":
      "merge a file written once with its upstream change, three ways (repeatable)",
    "--restore <path>":
      "write a tracked file the project deleted again, from the current upstream (repeatable)",
    "-y, --yes": "skip the confirmation prompt",
  },
  name: "update",
  usage: UPDATE_USAGE,
};

const UPDATE_FLAGS = new Set([
  "--dry-run",
  "--diff",
  "--yes",
  "-y",
  "--force",
  "--abort",
  "--help",
  "-h",
]);
const UPDATE_VALUE_FLAGS = new Set(["--restore", "--merge", "--done"]);
/** Old-engine flags, refused with a reason rather than as unknown. */
const UPDATE_GONE_FLAGS: Record<string, string> = {
  "--from": "the render engine has no adopted base",
  "--out": "the report goes to stdout; redirect it",
  "--ref": "the default registry moves as one release",
  "--resolved": "a merge clears when its conflict markers are gone",
};

export interface UpdateNextOptions {
  dryRun: boolean;
  diff: boolean;
  yes: boolean;
  force: boolean;
  abort: boolean;
  restore: string[];
  merge: string[];
  done: string[];
  /** Flags we don't know, positionals, and the old engine's flags. */
  unknown: string[];
}

export function parseUpdateArgs(argv: string[]): UpdateNextOptions {
  const values: Record<string, string[]> = {
    "--done": [],
    "--merge": [],
    "--restore": [],
  };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (!arg.startsWith("-")) {
      unknown.push(
        `${arg} (update takes no module name: one update moves every module)`
      );
    } else if (UPDATE_VALUE_FLAGS.has(flag)) {
      const value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
      if (!value || (eq === -1 && value.startsWith("-"))) {
        unknown.push(`${flag} (missing value)`);
        continue;
      }
      if (eq === -1) {
        i++;
      }
      values[flag]?.push(value);
    } else if (UPDATE_GONE_FLAGS[flag] !== undefined) {
      unknown.push(`${flag} (${UPDATE_GONE_FLAGS[flag]})`);
      if (
        eq === -1 &&
        argv[i + 1] !== undefined &&
        !argv[i + 1]?.startsWith("-")
      ) {
        i++;
      }
    } else if (!UPDATE_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  return {
    abort: argv.includes("--abort"),
    diff: argv.includes("--diff"),
    done: values["--done"] ?? [],
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    merge: values["--merge"] ?? [],
    restore: values["--restore"] ?? [],
    unknown,
    yes: argv.includes("--yes") || argv.includes("-y"),
  };
}

export async function runUpdateNext(argv: string[]): Promise<number> {
  const opts = parseUpdateArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(UPDATE_HELP);
    return EXIT_OK;
  }
  // stdout carries the report and nothing else, so the TUI goes to stderr.
  const tui = TUI_ON_STDERR;
  const refuse = (message: string, code: number): number => {
    cancel(message, tui);
    return code;
  };
  intro(pc.bgCyan(pc.black(" saasaloy update ")), tui);
  if (opts.unknown.length > 0) {
    return refuse(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${UPDATE_USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  try {
    const root = await findProjectRoot();
    if (opts.abort) {
      return await abortRun(root, tui);
    }
    return await updateNext(root, opts, refuse);
  } catch (error) {
    return refuse(
      formatFailure(error),
      error instanceof RefusalError ? EXIT_REFUSED : EXIT_FAILURE
    );
  }
}

/** Write each module's `update-notes/` out of a payload, for `selectUpdateNotes`. */
async function writeNoteDirs(
  payload: Payload,
  names: Iterable<string>,
  dir: string
): Promise<Map<string, string>> {
  const dirs = new Map<string, string>();
  for (const name of names) {
    const mod = payload.modules.get(name);
    if (mod === undefined) {
      continue;
    }
    const moduleDir = join(dir, name);
    await mkdir(moduleDir, { recursive: true });
    for (const [rel, content] of mod.files) {
      if (rel.startsWith(`${UPDATE_NOTES_DIR}/`)) {
        const file = join(moduleDir, ...rel.split("/"));
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, content, "utf-8");
      }
    }
    dirs.set(name, moduleDir);
  }
  return dirs;
}

/** The update report: what the run left for an agent. Plain Markdown on stdout. */
export function updateReport(args: {
  report: ApplyReport;
  from: string | undefined;
  to: string;
  notes: readonly UpdateNoteText[];
  mayApply: readonly UpdateNoteText[];
}): string {
  const { report } = args;
  const lines: string[] = [
    `# saasaloy update ${args.from === undefined ? "" : `${args.from} → `}${args.to}`,
    "",
  ];
  const section = (title: string, items: string[]): void => {
    if (items.length > 0) {
      lines.push(`## ${title}`, "", ...items, "");
    }
  };
  section(
    "Files with conflict markers",
    report.results
      .filter((result) => (result.conflicts ?? 0) > 0)
      .map(
        (result) =>
          `- \`${result.path}\`: ${String(result.conflicts)} conflict${result.conflicts === 1 ? "" : "s"}${result.kind === "conflict" ? "" : " (no base: two-way markers)"}`
      )
  );
  section(
    "Written once, changed upstream",
    report.onceChanged.map(
      (path) => `- \`${path}\`: \`saasaloy update --merge ${path}\` merges it`
    )
  );
  section(
    "Left deleted",
    report.keptDeleted.map(
      (path) =>
        `- \`${path}\`: \`saasaloy update --restore ${path}\` writes it again`
    )
  );
  section(
    "Kept, no longer tracked",
    report.keptEdited.map(
      (path) => `- \`${path}\`: upstream removed it and the project changed it`
    )
  );
  section(
    "Warnings",
    report.warnings.map((warning) => `- ${warning}`)
  );
  const noteBlock = (entry: UpdateNoteText): string[] => [
    `### ${entry.id}: ${entry.title}`,
    "",
    entry.body.trimEnd(),
    "",
  ];
  if (args.notes.length > 0 || args.mayApply.length > 0) {
    lines.push("## Update notes", "");
    for (const entry of args.notes) {
      lines.push(...noteBlock(entry));
    }
    if (args.mayApply.length > 0) {
      lines.push("### Notes that may apply", "");
      for (const entry of args.mayApply) {
        lines.push(...noteBlock(entry));
      }
    }
    lines.push(
      "### When a note is done",
      "",
      "```sh",
      `saasaloy update ${[...args.notes, ...args.mayApply].map((entry) => `--done ${entry.id}`).join(" ")} --yes`,
      "```",
      ""
    );
  }
  lines.push(
    "Run `pnpm install`, then `pnpm check`, to typecheck and test the result."
  );
  return `${lines.join("\n")}\n`;
}

async function updateNext(
  root: string,
  opts: UpdateNextOptions,
  refuse: (message: string, code: number) => number
): Promise<number> {
  const tui = TUI_ON_STDERR;
  const cliVersion = await readVersion();
  const state = await readProjectState(root);
  const preview = opts.dryRun || opts.diff;
  await assertReadyToRun(root, state.manifest);

  // A CLI older than the lock would move the project backwards.
  const recorded = state.version;
  const recordedVersion = parseVersion(recorded ?? "");
  const runningVersion = parseVersion(cliVersion);
  if (
    recorded !== undefined &&
    recordedVersion !== undefined &&
    runningVersion !== undefined &&
    compareVersions(recordedVersion, runningVersion) > 0
  ) {
    return refuse(
      `This project was rendered by saasaloy ${recorded}, and ${cliVersion} is running — updating would move it backwards. ` +
        `Upgrade with \`${upgradeCommand(`>=${recorded}`)}\`. Nothing was written.`,
      EXIT_REFUSED
    );
  }
  if (!preview && !opts.force) {
    await checkCleanTree(root, "whole", []);
  }
  if (!opts.yes && !preview && !process.stdin.isTTY) {
    return refuse(
      "No terminal to confirm in — re-run with `--yes` to apply, or `--dry-run` to preview.",
      EXIT_REFUSED
    );
  }

  const done = matchDone(opts.done, state.manifest.pendingNotes);
  if (done.unmatched.length > 0) {
    const known = state.manifest.pendingNotes.map((entry) => `  ${entry.id}`);
    return refuse(
      [
        `\`--done\` names no pending update note: ${done.unmatched.join(", ")}.`,
        ...(known.length > 0
          ? ["Pending:", ...known]
          : ["No update note is pending."]),
        "Nothing was written.",
      ].join("\n"),
      EXIT_REFUSED
    );
  }
  const records = state.manifest.files;
  const missing = new Set<string>();
  for (const path of Object.keys(records)) {
    if (!(await pathExists(resolveWithinRoot(root, path)))) {
      missing.add(path);
    }
  }
  const restore = matchPaths(root, opts.restore, missing);
  if (restore.unmatched.length > 0) {
    return refuse(
      `\`--restore\` names no tracked file the project deleted: ${restore.unmatched.join(", ")}. Nothing was written.`,
      EXIT_REFUSED
    );
  }
  const onceFiles = new Set(
    Object.entries(records)
      .filter(([path, record]) => record.class === "once" && !missing.has(path))
      .map(([path]) => path)
  );
  const merge = matchPaths(root, opts.merge, onceFiles);
  if (merge.unmatched.length > 0) {
    return refuse(
      `\`--merge\` names no file written once that is on disk: ${merge.unmatched.join(", ")}. Nothing was written.`,
      EXIT_REFUSED
    );
  }

  // The old side renders the lock at its release; the new side moves every default module
  // to the running CLI's release and each third-party module to the tip of its ref.
  const previousVersion = recorded ?? cliVersion;
  let previous: LoadedSide;
  try {
    previous = await loadSide(
      sideSpec(state, state.requested, previousVersion),
      { cliVersion }
    );
  } catch (error) {
    if (error instanceof RefusalError) {
      throw error;
    }
    throw new RefusalError(
      `Could not load saasaloy ${previousVersion}, the base of this update's merges: ${formatFailure(error)}`,
      { cause: error }
    );
  }
  const coordinates = new Map<string, ModuleCoordinate>();
  if (!isLocalRegistry()) {
    for (const [name, coordinate] of state.coordinates) {
      const [owner = "", repo = ""] = coordinate.source.split("/");
      const remote = new RemoteRegistrySource(owner, repo, coordinate.ref);
      await remote.resolveSha();
      coordinates.set(name, remote.provenance());
    }
  }
  const next = await loadSide(
    sideSpec(state, state.requested, cliVersion, coordinates),
    { cliVersion }
  );

  // `--merge` on a file an older release wrote needs that release's render as its base.
  // When it cannot be loaded, the merge falls back to two-way markers.
  let mergeBase: LoadedSide | undefined;
  const mergeVersions = [
    ...new Set(merge.matched.map((path) => records[path]?.version ?? "")),
  ];
  if (mergeVersions.length > 1) {
    return refuse(
      `\`--merge\` names files written by different releases (${mergeVersions.join(", ")}). Merge them in separate runs. Nothing was written.`,
      EXIT_REFUSED
    );
  }
  const mergeVersion = mergeVersions[0];
  if (
    mergeVersion !== undefined &&
    mergeVersion !== previousVersion &&
    !isLocalRegistry()
  ) {
    try {
      mergeBase = await loadSide(
        sideSpec(state, state.requested, mergeVersion),
        {
          cliVersion,
        }
      );
    } catch (error) {
      log.warn(
        `Could not load saasaloy ${mergeVersion}, the release that wrote ${listLabel(merge.matched)}: ${formatFailure(error)}. The merge writes two-way markers.`,
        tui
      );
    }
  }

  // Update notes (ADR 0058): base notes by release range, module notes by folder.
  const scratch = await mkdtemp(join(tmpdir(), "saasaloy-notes-"));
  let notes: {
    notes: UpdateNoteText[];
    mayApply: UpdateNoteText[];
    pending: PendingNote[];
  };
  try {
    const nextSet = closure(next.side.payload, state.requested);
    const previousSet = closure(previous.side.payload, state.requested);
    const theirsDirs = await writeNoteDirs(
      next.side.payload,
      nextSet,
      join(scratch, "theirs")
    );
    const baseDirs = await writeNoteDirs(
      previous.side.payload,
      previousSet,
      join(scratch, "base")
    );
    const modules: ModuleNoteSource[] = fixedOrder(
      next.side.payload.modules,
      nextSet
    ).map((name) => {
      const baseDir = baseDirs.get(name);
      return {
        name,
        theirsDir: theirsDirs.get(name) ?? "",
        ...(baseDir === undefined ? { fresh: true } : { baseDir }),
      };
    });
    const selection = await selectUpdateNotes({
      ...(recorded === undefined
        ? {}
        : {
            base: {
              dir: await baseUpdateNotesDir(),
              recorded,
              running: cliVersion,
            },
          }),
      modules,
      when: {
        installed: nextSet,
        testingMode: state.options.testingMode ?? "off",
      },
    });
    notes = mergePendingNotes(
      state.manifest.pendingNotes,
      selection,
      new Set([...state.manifest.doneNotes, ...done.matched])
    );
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }

  const run = (dryRun: boolean): Promise<ApplyReport> =>
    apply({
      cleanTree: dryRun ? "none" : "whole",
      doneNotes: [...new Set([...state.manifest.doneNotes, ...done.matched])],
      dryRun,
      force: opts.force,
      merge: merge.matched,
      ...(mergeBase === undefined ? {} : { mergeBase: mergeBase.side }),
      next: next.side,
      pendingNotes: notes.pending,
      previous: previous.side,
      provenance: next.provenance,
      restore: restore.matched,
      root,
      version: cliVersion,
    });

  if (recorded !== undefined && recorded !== cliVersion) {
    log.info(
      `Project rendered at ${pc.cyan(recorded)}; ${pc.cyan(cliVersion)} is running.`,
      tui
    );
  }
  const plan = await run(true);
  summarize(plan, "Plan", tui);
  if (opts.diff) {
    printDiffs(plan, tui);
  }
  const document = (report: ApplyReport): string =>
    updateReport({
      from: recorded === cliVersion ? undefined : recorded,
      mayApply: notes.mayApply,
      notes: notes.notes,
      report,
      to: cliVersion,
    });
  if (preview) {
    process.stdout.write(document(plan));
    outro(
      pc.dim(
        opts.diff ? "diff only — nothing applied" : "dry run — nothing applied"
      ),
      tui
    );
    return EXIT_OK;
  }
  const declined = await confirmApply(opts.yes, "update", tui);
  if (declined !== undefined) {
    return declined;
  }
  const report = await run(false);
  for (const result of shownResults(report)) {
    log.step(`${KIND_LABEL[result.kind]}  ${result.path}`, tui);
  }
  process.stdout.write(document(report));
  const pendingNotes = notes.pending.length;
  const exitCode =
    report.exitCode === EXIT_WORK_PENDING || pendingNotes > 0
      ? EXIT_WORK_PENDING
      : EXIT_OK;
  outro(
    exitCode === EXIT_OK
      ? pc.green(`Updated to ${cliVersion}.`)
      : pc.yellow(
          `Updated to ${cliVersion}; ${[
            report.pendingMerges.length > 0
              ? `${String(report.pendingMerges.length)} file${report.pendingMerges.length === 1 ? "" : "s"} with conflict markers`
              : "",
            pendingNotes > 0
              ? `${String(pendingNotes)} update note${pendingNotes === 1 ? "" : "s"} pending`
              : "",
          ]
            .filter(Boolean)
            .join(" and ")} — see the report.`
        ),
    tui
  );
  return exitCode;
}
