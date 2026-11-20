import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cancel, intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { apply, checkCleanTree } from "../engine/apply.js";
import type { ApplyReport } from "../engine/apply.js";
import {
  candidateLoader,
  convertProject,
  searchedReleases,
} from "../engine/convert.js";
import type { Conversion } from "../engine/convert.js";
import { readManifestState } from "../engine/manifest.js";
import type { Payload } from "../engine/payload.js";
import {
  assertReadyToRun,
  isLocalRegistry,
  loadBaseSides,
  loadSide,
  readProjectState,
} from "../engine/project.js";
import type { LoadedSide, ModuleCoordinate } from "../engine/project.js";
import { closure, fixedOrder } from "../engine/render.js";
import { upgradeCommand } from "../lib/cli-requires.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_WORK_PENDING,
  formatFailure,
  RefusalError,
} from "../lib/exit.js";
import { pathExists, resolveWithinRoot } from "../lib/fs-utils.js";
import type { TuiOptions } from "../lib/json-output.js";
import { loadLock } from "../lib/lock.js";
import type { PendingNote } from "../lib/manifest.js";
import { matchDone, mergePendingNotes } from "../lib/pending-notes.js";
import { findProjectRoot } from "../lib/project.js";
import { RemoteRegistrySource } from "../lib/registry.js";
import { listLabel } from "../lib/requested.js";
import { compareVersions, parseVersion } from "../lib/semver.js";
import { TUI_ON_STDERR } from "../lib/tui.js";
import { selectUpdateNotes } from "../lib/update-note-select.js";
import type { ModuleNoteSource } from "../lib/update-note-select.js";
import { baseUpdateNotesDir, UPDATE_NOTES_DIR } from "../lib/update-notes.js";
import type { UpdateNoteText } from "../lib/update-notes.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import {
  abortRun,
  confirmApply,
  matchPaths,
  NO_TERMINAL_TO_CONFIRM,
  printDiffs,
  printSteps,
  sideSpec,
  summarize,
} from "./apply-run.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy update`: one apply that moves the project to the running CLI's release (plan
// 0116). Every default-registry module moves with it, and a third-party module moves to
// the tip of the ref its lock entry records. There is no update of one module: a staged
// update runs an older CLI, `pnpm dlx saasaloy@<version> update`.
//
// The run renders the lock at its release (the base of each merge, accepted only by its
// hash) and at the new release, writes each file nobody edited, merges each file with
// local edits three ways, and leaves a file written once alone. A conflict does not stop
// it: the file gets markers, the lock and the manifest move, and the run exits 3. Its
// report goes to stdout as Markdown, and the TUI goes to stderr.
//
// The first run in a version 1 project converts its manifest and its lock (plan 0116,
// Phase 5). `update` refuses a dirty tree, so the conversion is one reviewable diff, and
// `--abort` restores the version 1 files.

const USAGE =
  "saasaloy update [--restore <path>]... [--merge <path>]... [--done <id>]... [--dry-run] [--diff] [--force] [--yes] | saasaloy update --abort";
const HELP: CommandHelp = {
  describe: DESCRIPTIONS.update,
  flags: {
    "--abort":
      "put back the files the last add, remove, update or testing run changed",
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
  usage: USAGE,
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

export interface UpdateOptions {
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

export function parseUpdateArgs(argv: string[]): UpdateOptions {
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

export async function runUpdate(argv: string[]): Promise<number> {
  const opts = parseUpdateArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
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
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  try {
    const root = await findProjectRoot();
    if (opts.abort) {
      return await abortRun(root, tui);
    }
    return await updateProject(root, opts, refuse);
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
  // A note's own headings nest under its heading, so a note's `## What you do` never
  // ends the report's `## Update notes` section (#298).
  const noteBlock = (entry: UpdateNoteText, level: number): string[] => [
    `${"#".repeat(level)} ${entry.id}: ${entry.title}`,
    "",
    demoteHeadings(entry.body, level + 1).trimEnd(),
    "",
  ];
  if (args.notes.length > 0 || args.mayApply.length > 0) {
    lines.push("## Update notes", "");
    for (const entry of args.notes) {
      lines.push(...noteBlock(entry, 3));
    }
    if (args.mayApply.length > 0) {
      lines.push("### Notes that may apply", "");
      for (const entry of args.mayApply) {
        lines.push(...noteBlock(entry, 4));
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

/**
 * Shift every ATX heading outside a fenced block so the body's highest heading lands at
 * `top`, capped at `######`. A fenced block's lines are content, never headings.
 * Exported for its own test.
 */
export function demoteHeadings(body: string, top: number): string {
  const lines = body.split("\n");
  const headings: (number | undefined)[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) {
        fence = marker;
      } else if (
        marker.startsWith(fence.charAt(0)) &&
        marker.length >= fence.length
      ) {
        fence = undefined;
      }
      headings.push(undefined);
      continue;
    }
    headings.push(
      fence === undefined ? /^(#{1,6})[ \t]/.exec(line)?.[1]?.length : undefined
    );
  }
  const levels = headings.filter((h): h is number => h !== undefined);
  if (levels.length === 0) {
    return body;
  }
  const shift = Math.max(0, top - Math.min(...levels));
  return lines
    .map((line, index) => {
      const level = headings[index];
      return level === undefined
        ? line
        : `${"#".repeat(Math.min(6, level + shift))}${line.slice(level)}`;
    })
    .join("\n");
}

/**
 * The first run of the render engine in a version 1 project converts its manifest and its
 * lock (plan 0116, "Migration and rollback"). The result stays in memory: the run writes
 * it with everything else, after the backup, so `--abort` restores the version 1 files.
 */
async function convertIfVersion1(
  root: string,
  cliVersion: string,
  tui: TuiOptions
): Promise<Conversion | undefined> {
  if ((await readManifestState(root)).kind !== "v1") {
    return undefined;
  }
  const conversion = await convertProject({
    load: candidateLoader(await loadLock(root), { cliVersion }),
    releases: searchedReleases(cliVersion),
    root,
  });
  const found = conversion.files.filter(
    (file) => file.version !== undefined
  ).length;
  const bothSides = conversion.files.filter(
    (file) => file.record === undefined
  ).length;
  const rest =
    bothSides > 0
      ? `; ${String(bothSides)} with no base merge as files on both sides.`
      : ".";
  log.info(
    `Converting a version 1 project: found the base of ${String(found)} of ${String(conversion.files.length)} tracked files${rest}`,
    tui
  );
  return conversion;
}

async function updateProject(
  root: string,
  opts: UpdateOptions,
  refuse: (message: string, code: number) => number
): Promise<number> {
  const tui = TUI_ON_STDERR;
  const cliVersion = await readVersion();
  const conversion = await convertIfVersion1(root, cliVersion, tui);
  await assertReadyToRun(root, conversion?.manifest);
  const state = await readProjectState(
    root,
    conversion === undefined
      ? undefined
      : { lock: conversion.lock, manifest: conversion.manifest }
  );
  const preview = opts.dryRun || opts.diff;

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
    return refuse(NO_TERMINAL_TO_CONFIRM, EXIT_REFUSED);
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
      { ...sideSpec(state, state.requested, previousVersion), partial: true },
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
  // Each record finds its base in the render of the release that wrote it.
  const bases = isLocalRegistry()
    ? undefined
    : await loadBaseSides(state, previousVersion, { cliVersion });
  for (const warning of bases?.warnings ?? []) {
    log.warn(warning, tui);
  }

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
      ...(bases === undefined || bases.sides.size === 0
        ? {}
        : { bases: bases.sides }),
      ...(conversion === undefined
        ? {}
        : {
            state: { lock: conversion.lock, manifest: conversion.manifest },
          }),
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
  printSteps(report, tui);
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
