import {
  lstat,
  mkdir,
  readdir,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { restoreLatestBackup, writeBackup } from "../lib/backup.js";
import type { RestoreResult } from "../lib/backup.js";
import { EXIT_OK, EXIT_WORK_PENDING, RefusalError } from "../lib/exit.js";
import { formatSource } from "../lib/format.js";
import {
  assertNoSymlinkPath,
  hashContent,
  pathExists,
  readIfPresent,
  resolveWithinRoot,
} from "../lib/fs-utils.js";
import { dirtyPaths, workingTreeState } from "../lib/git-state.js";
import { loadLock, saveLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import type { PendingNote } from "../lib/manifest.js";
import type { ModuleProvenance } from "../lib/registry.js";
import { linkAgentSkills } from "../lib/skill-links.js";
import type { FileClass } from "./classes.js";
import { mergeJson, mergesByKey } from "./json-merge.js";
import { createTextMerger, hasConflictMarkers } from "./merge.js";
import type { MergeOutput, TextMerger } from "./merge.js";
import { loadManifestV2, nextLock, saveManifestV2 } from "./manifest.js";
import type { FileRecord, ManifestV2 } from "./manifest.js";
import type { Payload } from "./payload.js";
import { render } from "./render.js";
import type { RenderedFile, RenderOptions, RenderResult } from "./render.js";

// `apply(oldLock, newLock)` (plan 0116, "One operation"): the one code path that decides
// every write. `init` is an apply from nothing, `add X` and `remove X` change the
// requested set, and `update` moves the version.
//
// For each path the engine holds three sides: `base`, the render of the old lock, taken
// only when its sha256 equals the manifest's hash; `theirs`, the new render; and `mine`,
// the disk. It picks one action: leave, write, delete, merge, or report. Every result is
// staged in memory first, so a refusal leaves the project as it found it.
//
// Then the commit, in a fixed order: copy each file the run changes through
// `lib/backup.ts`, write the journal, write the project, write the manifest and the lock
// last, and remove the journal. A journal left behind is an unfinished run, and the next
// run refuses until `abortApply` restores the backup.

/** Marks an unfinished run. */
export const JOURNAL_FILE = join(".saasaloy", "journal.json");

export type ApplyAction = "leave" | "write" | "delete" | "merge" | "report";

/**
 * What the engine found for one path. The six result kinds of research 0013 are `clean`,
 * `already-equal`, `conflict`, `both-no-base`, `upstream-deleted-owner-edited` and
 * `no-base`; the rest are the plain cases around them.
 */
export type ResultKind =
  /** Upstream did not change the file: left. */
  | "unchanged"
  /** The path is new to the project: written. */
  | "new"
  /** The disk equals the base: the new render is written. */
  | "updated"
  /** The disk already equals the new render: left, and the record moves. */
  | "already-equal"
  /** A three-way merge with no conflict: the merge is written. */
  | "clean"
  /** A three-way merge with conflicts: written with markers. */
  | "conflict"
  /** The file exists on both sides and has no record: two-way markers. */
  | "both-no-base"
  /** A tracked file the owner changed, and no render matches its record: two-way markers. */
  | "no-base"
  /** Upstream dropped the file and the disk equals the record: deleted. */
  | "deleted"
  /** Upstream dropped a file the owner changed: kept, its record dropped. */
  | "upstream-deleted-owner-edited"
  /** Upstream dropped a file the owner had already deleted: the record goes. */
  | "gone"
  /** The owner deleted a tracked file, and upstream changed it: it stays deleted. */
  | "kept-deleted"
  /** `restore` wrote a deleted file again. */
  | "restored"
  /** A `once` file upstream changed: left, one report line. */
  | "once-left"
  /** A `once` path that already holds a file with no record: left, and now tracked. */
  | "once-kept"
  /** An owner-edited `generated` file overwritten under `force`. */
  | "generated-overwritten";

const ACTION_OF: Record<ResultKind, ApplyAction> = {
  "already-equal": "leave",
  "both-no-base": "merge",
  clean: "merge",
  conflict: "merge",
  deleted: "delete",
  "generated-overwritten": "write",
  gone: "leave",
  "kept-deleted": "report",
  new: "write",
  "no-base": "merge",
  "once-kept": "leave",
  "once-left": "report",
  restored: "write",
  unchanged: "leave",
  updated: "write",
  "upstream-deleted-owner-edited": "report",
};

export interface PathResult {
  path: string;
  kind: ResultKind;
  action: ApplyAction;
  class: FileClass;
  module: string;
  /** The disk before the run; `undefined` when no file was there. */
  before: string | undefined;
  /** The disk after the run; `undefined` when the file is absent after it. */
  after: string | undefined;
  /** Conflict regions in `after`, for a merge. */
  conflicts?: number;
}

export interface ApplyReport {
  /** One entry for each path the render or the manifest names, in path order. */
  results: PathResult[];
  /** Paths whose bytes the run changes: written, merged or deleted. */
  changed: string[];
  /** Files the run leaves with conflict markers: the manifest's `pendingMerges`. */
  pendingMerges: string[];
  /** `once` files upstream changed in this run. */
  onceChanged: string[];
  /** Tracked files the owner deleted and upstream changed: left deleted. */
  keptDeleted: string[];
  /** Files upstream dropped that the owner changed: kept, no longer tracked. */
  keptEdited: string[];
  /** The render's warnings and the skill link problems. */
  warnings: string[];
  /** The human report, one line each, ending with the `pnpm check` line after a merge. */
  lines: string[];
  /** `EXIT_WORK_PENDING` when a file holds markers, else `EXIT_OK`. */
  exitCode: number;
  dryRun: boolean;
  /** The backup directory, relative to the project. Absent on a dry run. */
  backup?: string;
  /** The manifest and the lock the run writes, or would write on a dry run. */
  manifest: ManifestV2;
  lock: Lockfile;
}

/** Formats one file's text as the project would. `undefined` keeps the raw text. */
export type SourceFormatter = (
  path: string,
  content: string
) => Promise<string | undefined>;

/**
 * Which uncommitted work stops a run (plan 0116, "The clean-tree rule"). `whole`: any
 * change to a tracked file, for `update`. `touched`: a change to a file the run merges or
 * deletes, for `add` and `remove`. `none` skips the check. `force` overrides both.
 */
export type CleanTreeRule = "whole" | "touched" | "none";

export interface PlanArgs {
  root: string;
  manifest: ManifestV2;
  /** The new render. */
  theirs: RenderResult;
  /** The render of the old lock, or `undefined` on a first run. */
  base?: RenderResult;
  /** The release that writes this render: the record version and the marker label. */
  version: string;
  /** Overwrite an owner-edited `generated` file instead of refusing. */
  force?: boolean;
  /** Tracked files the owner deleted, to write again (`update --restore`). */
  restore?: readonly string[];
  /** `once` files to merge three ways (`update --merge`). */
  merge?: readonly string[];
  /**
   * The base of the `merge` paths when it differs from `base`: the render at the release
   * that wrote a `once` file, whose record is older than the old lock.
   */
  mergeBase?: RenderResult;
  format?: SourceFormatter;
  merger?: TextMerger;
  /**
   * Reads a project file. The disk under `root` when absent; the registry round trip
   * passes an in-memory tree.
   */
  read?: (path: string) => Promise<string | undefined>;
}

export interface Plan {
  results: PathResult[];
  manifest: ManifestV2;
}

const sha = hashContent;

function recordOf(file: RenderedFile, version: string): FileRecord {
  return {
    class: file.class,
    from: file.from,
    hash: sha(file.content),
    module: file.module,
    version,
  };
}

/**
 * Decide every path and stage its result in memory. Reads the disk and runs merges; writes
 * nothing. Throws `RefusalError` for an owner-edited `generated` file without `force`, for
 * a `restore` or `merge` path the render does not write, and for a merge with no git.
 */
export async function planApply(args: PlanArgs): Promise<Plan> {
  const { root, manifest, theirs, base, version } = args;
  const restore = new Set(args.restore);
  const mergeOnce = new Set(args.merge);
  for (const path of [...restore, ...mergeOnce]) {
    if (!theirs.files.has(path)) {
      throw new RefusalError(
        `${path} is not a file this render writes, so the run can't restore or merge it.`
      );
    }
  }
  const formatter: SourceFormatter =
    args.format ?? ((path, content) => formatSource(root, path, content));
  const merger = args.merger ?? createTextMerger();
  const read =
    args.read ??
    ((path: string) => readIfPresent(resolveWithinRoot(root, path)));

  const formatted = new Map<string, string>();
  // A patched file reached the disk through the project's Prettier, so both sides of it
  // are compared in that layout. Every other file is compared as rendered.
  const fmt = async (
    path: string,
    content: string,
    transformed: boolean
  ): Promise<string> => {
    if (!transformed) {
      return content;
    }
    const key = `${path}\0${sha(content)}`;
    let out = formatted.get(key);
    if (out === undefined) {
      out = (await formatter(path, content)) ?? content;
      formatted.set(key, out);
    }
    return out;
  };

  const runMerge = (
    path: string,
    mine: string,
    baseText: string | undefined,
    theirsText: string
  ): Promise<MergeOutput> => {
    const input = { base: baseText, mine, path, theirs: theirsText, version };
    return mergesByKey(path) ? mergeJson(input, merger) : merger.merge(input);
  };

  const files: Record<string, FileRecord> = { ...manifest.files };
  const results: PathResult[] = [];
  const refused: string[] = [];
  const paths = [
    ...new Set([...theirs.files.keys(), ...Object.keys(manifest.files)]),
  ].toSorted();

  for (const path of paths) {
    const next = theirs.files.get(path);
    const record = manifest.files[path];
    const old = (
      mergeOnce.has(path) && args.mergeBase !== undefined
        ? args.mergeBase
        : base
    )?.files.get(path);
    const baseFile =
      old !== undefined &&
      record !== undefined &&
      sha(old.content) === record.hash
        ? old
        : undefined;
    const mine = await read(path);
    const fileClass = next?.class ?? record?.class ?? "merged";
    const module = next?.module ?? record?.module ?? "";
    const push = (
      kind: ResultKind,
      after: string | undefined,
      conflicts?: number
    ): void => {
      results.push({
        action: ACTION_OF[kind],
        after,
        before: mine,
        class: fileClass,
        kind,
        module,
        path,
        ...(conflicts === undefined ? {} : { conflicts }),
      });
    };

    // The disk still holds the render the manifest records, raw or as Prettier left it.
    const pristine = async (): Promise<boolean> => {
      if (mine === undefined || record === undefined) {
        return false;
      }
      if (sha(mine) === record.hash) {
        return true;
      }
      return (
        baseFile?.transformed === true &&
        mine === (await fmt(path, baseFile.content, true))
      );
    };
    const written = (file: RenderedFile): Promise<string> =>
      fmt(path, file.content, file.transformed === true);
    const equalsTheirs = async (file: RenderedFile): Promise<boolean> =>
      mine === file.content || mine === (await written(file));
    const merge = async (
      file: RenderedFile,
      kindIfBase: "clean" | "conflict",
      noBaseKind: "no-base" | "both-no-base"
    ): Promise<void> => {
      const theirsText = await written(file);
      const baseText =
        baseFile === undefined
          ? undefined
          : await fmt(path, baseFile.content, baseFile.transformed === true);
      const out = await runMerge(path, mine ?? "", baseText, theirsText);
      const kind =
        baseText === undefined
          ? noBaseKind
          : out.conflicts > 0
            ? "conflict"
            : kindIfBase;
      push(kind, out.content, out.conflicts);
      files[path] = recordOf(file, version);
    };

    if (next !== undefined && record !== undefined) {
      const upstreamMoved = sha(next.content) !== record.hash;
      if (mine === undefined) {
        if (restore.has(path) || next.class === "generated") {
          push(restore.has(path) ? "restored" : "updated", await written(next));
          files[path] = recordOf(next, version);
        } else if (upstreamMoved) {
          push("kept-deleted", undefined);
          files[path] = recordOf(next, version);
        } else {
          push("unchanged", undefined);
          files[path] = { ...record, class: next.class };
        }
        continue;
      }
      if (next.class === "once" && mergeOnce.has(path)) {
        if (await equalsTheirs(next)) {
          push("already-equal", mine);
          files[path] = recordOf(next, version);
        } else {
          await merge(next, "clean", "no-base");
        }
        continue;
      }
      if (next.class === "once") {
        // The base render equals the new one: upstream moved in an earlier run, and that
        // run already printed the line.
        const movedThisRun =
          upstreamMoved &&
          (old === undefined || sha(old.content) !== sha(next.content));
        push(movedThisRun ? "once-left" : "unchanged", mine);
        // The record keeps the release that wrote the file, so its base stays findable.
        files[path] = { ...record, class: next.class };
        continue;
      }
      if (next.class === "generated") {
        if ((await pristine()) || (await equalsTheirs(next))) {
          const out = await written(next);
          push(out === mine ? "unchanged" : "updated", out);
        } else if (args.force) {
          push("generated-overwritten", await written(next));
        } else {
          refused.push(path);
          continue;
        }
        files[path] = recordOf(next, version);
        continue;
      }
      // merged
      if (!upstreamMoved) {
        push("unchanged", mine);
        files[path] = { ...record, class: next.class };
      } else if (await equalsTheirs(next)) {
        push("already-equal", mine);
        files[path] = recordOf(next, version);
      } else if (await pristine()) {
        push("updated", await written(next));
        files[path] = recordOf(next, version);
      } else {
        await merge(next, "clean", "no-base");
      }
      continue;
    }

    if (next !== undefined) {
      // A path with no record.
      if (mine === undefined) {
        push("new", await written(next));
      } else if (await equalsTheirs(next)) {
        push("already-equal", mine);
      } else if (next.class === "once") {
        // The file exists, so a `once` path is the owner's already.
        push("once-kept", mine);
      } else if (next.class === "generated") {
        if (!args.force) {
          refused.push(path);
          continue;
        }
        push("generated-overwritten", await written(next));
      } else {
        await merge(next, "clean", "both-no-base");
        continue;
      }
      files[path] = recordOf(next, version);
      continue;
    }

    if (record !== undefined) {
      // Upstream no longer renders the path.
      delete files[path];
      if (mine === undefined) {
        push("gone", undefined);
      } else if (await pristine()) {
        push("deleted", undefined);
      } else {
        push("upstream-deleted-owner-edited", mine);
      }
    }
  }

  if (refused.length > 0) {
    throw new RefusalError(
      [
        "The project changed files the CLI writes in full on every run:",
        ...refused.map((path) => `  ${path}`),
        "Move the change out of each file, or run again with --force to overwrite them.",
      ].join("\n")
    );
  }

  const pendingMerges = results
    .filter((result) => (result.conflicts ?? 0) > 0)
    .map((result) => result.path);
  return {
    manifest: {
      ...manifest,
      files,
      pendingMerges,
    },
    results,
  };
}

/** The paths among `pending` that still hold a marker line. Reads only those files. */
export async function scanPendingMerges(
  root: string,
  pending: readonly string[]
): Promise<string[]> {
  const left: string[] = [];
  for (const path of pending) {
    const text = await readIfPresent(resolveWithinRoot(root, path));
    if (text !== undefined && hasConflictMarkers(text)) {
      left.push(path);
    }
  }
  return left;
}

/** Refuses when a journal marks an unfinished run. */
export async function assertNoJournal(root: string): Promise<void> {
  if (await pathExists(join(root, JOURNAL_FILE))) {
    throw new RefusalError(
      `A saasaloy run did not finish: ${JOURNAL_FILE} is still there. Run the command again with --abort to restore the files it changed.`
    );
  }
}

/** Refuses while a file still holds conflict markers from an earlier run. */
export function assertNoPendingMerges(pending: readonly string[]): void {
  if (pending.length > 0) {
    throw new RefusalError(
      [
        "Resolve the conflict markers an earlier run left before you run again:",
        ...pending.map((path) => `  ${path}`),
      ].join("\n")
    );
  }
}

/** One side of an apply: a payload, the set asked for, and the render options. */
export interface ApplySide {
  payload: Payload;
  requested: readonly string[];
  options: RenderOptions;
}

export interface ApplyArgs {
  root: string;
  /** The new lock's side: the render to reach. */
  next: ApplySide;
  /** The old lock's side, the base of each merge. Absent on a first run. */
  previous?: ApplySide;
  /** The base of the `merge` paths, when the release that wrote them is older. */
  mergeBase?: ApplySide;
  /** The release that runs. */
  version: string;
  /** Lock provenance for each module. See `nextLock`. */
  provenance?: (module: string) => ModuleProvenance;
  force?: boolean;
  /** Plan and report; write nothing. */
  dryRun?: boolean;
  restore?: readonly string[];
  merge?: readonly string[];
  /** Default `none`: the command decides (plan 0116, "The clean-tree rule"). */
  cleanTree?: CleanTreeRule;
  /** Replace the manifest's pending update notes. Kept as they are when absent. */
  pendingNotes?: PendingNote[];
  /** Replace the manifest's done note ids. Kept as they are when absent. */
  doneNotes?: string[];
  format?: SourceFormatter;
  merger?: TextMerger;
  /** Called before each project write or delete. Tests throw here to stop a run. */
  beforeWrite?: (path: string) => void | Promise<void>;
}

/**
 * Refuse on uncommitted work, by `rule`. A project outside git, or a box with no git,
 * passes: the check is unknown.
 */
export async function checkCleanTree(
  root: string,
  rule: CleanTreeRule,
  results: readonly PathResult[]
): Promise<void> {
  if (rule === "none") {
    return;
  }
  if (rule === "whole") {
    if ((await workingTreeState(root)) === "dirty") {
      throw new RefusalError(
        "The project has uncommitted changes. Commit or stash them first, or run again with --force."
      );
    }
    return;
  }
  const touched = results
    .filter((result) => result.action === "merge" || result.action === "delete")
    .map((result) => result.path);
  const dirty = await dirtyPaths(root, touched);
  if (dirty !== undefined && dirty.length > 0) {
    throw new RefusalError(
      [
        "The run must merge or delete files that have uncommitted changes:",
        ...dirty.map((path) => `  ${path}`),
        "Commit or stash them first, or run again with --force.",
      ].join("\n")
    );
  }
}

function reportLines(report: Omit<ApplyReport, "lines">): string[] {
  const lines: string[] = [];
  for (const result of report.results) {
    switch (result.kind) {
      case "conflict":
      case "both-no-base":
      case "no-base": {
        if ((result.conflicts ?? 0) > 0) {
          const why =
            result.kind === "conflict"
              ? ""
              : result.kind === "both-no-base"
                ? ", no base: the file existed before the module wrote it"
                : ", no base: no render matches the manifest";
          lines.push(
            `conflict  ${result.path} (${String(result.conflicts)} conflict${result.conflicts === 1 ? "" : "s"}${why})`
          );
        }
        break;
      }
      case "once-left": {
        lines.push(
          `upstream changed  ${result.path} (written once; \`saasaloy update --merge ${result.path}\` merges it)`
        );
        break;
      }
      case "kept-deleted": {
        lines.push(
          `left deleted  ${result.path} (\`saasaloy update --restore ${result.path}\` writes it again)`
        );
        break;
      }
      case "upstream-deleted-owner-edited": {
        lines.push(
          `kept  ${result.path} (upstream removed it and the project changed it; no longer tracked)`
        );
        break;
      }
      default: {
        break;
      }
    }
  }
  for (const warning of report.warnings) {
    lines.push(`warning  ${warning}`);
  }
  if (report.results.some((result) => result.action === "merge")) {
    lines.push("Run `pnpm check` to typecheck and test the merged files.");
  }
  return lines;
}

/** Remove empty folders from `abs`'s parent up to, and not including, `root`. */
async function pruneEmptyParents(root: string, abs: string): Promise<void> {
  const rootAbs = resolve(root);
  let dir = dirname(resolve(abs));
  while (dir.startsWith(rootAbs + sep)) {
    try {
      if ((await readdir(dir)).length > 0) {
        return;
      }
      await rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

/** Drop `.claude/skills/<name>` links whose `.agents/skills/<name>` folder is gone. */
async function dropDanglingSkillLinks(
  root: string,
  names: readonly string[]
): Promise<void> {
  for (const name of names) {
    const link = join(root, ".claude", "skills", name);
    try {
      const stat = await lstat(link);
      if (
        stat.isSymbolicLink() &&
        !(await pathExists(join(root, ".agents", "skills", name)))
      ) {
        await unlink(link);
      }
    } catch {
      // No link there: nothing to drop.
    }
  }
}

async function skillNamesOnDisk(root: string): Promise<string[]> {
  try {
    return await readdir(join(root, ".claude", "skills"));
  } catch {
    return [];
  }
}

/**
 * Render the old and the new lock, decide every path, and write the result: the one
 * operation behind `init`, `add`, `remove` and `update`. Refuses with exit 2 (a thrown
 * `RefusalError`) when a journal is left, when merges are pending, when an owner-edited
 * `generated` file is in the way, on uncommitted work under `cleanTree`, and when a merge
 * needs git and finds none. A conflict does not stop the run: the report's `exitCode` is
 * 3, and the lock and the manifest still move.
 */
export async function apply(args: ApplyArgs): Promise<ApplyReport> {
  const { root, version } = args;
  await assertNoJournal(root);
  const manifest = await loadManifestV2(root);
  const pending = await scanPendingMerges(root, manifest.pendingMerges);
  assertNoPendingMerges(pending);
  const previousLock = await loadLock(root);

  const theirs = render(args.next);
  const base = args.previous === undefined ? undefined : render(args.previous);
  const plan = await planApply({
    base,
    manifest: { ...manifest, pendingMerges: [] },
    root,
    theirs,
    version,
    ...(args.force === undefined ? {} : { force: args.force }),
    ...(args.restore === undefined ? {} : { restore: args.restore }),
    ...(args.merge === undefined ? {} : { merge: args.merge }),
    ...(args.mergeBase === undefined
      ? {}
      : { mergeBase: render(args.mergeBase) }),
    ...(args.format === undefined ? {} : { format: args.format }),
    ...(args.merger === undefined ? {} : { merger: args.merger }),
  });
  if (!args.force) {
    await checkCleanTree(root, args.cleanTree ?? "none", plan.results);
  }

  const nextManifest: ManifestV2 = {
    ...plan.manifest,
    doneNotes: args.doneNotes ?? manifest.doneNotes,
    pendingNotes: args.pendingNotes ?? manifest.pendingNotes,
  };
  const lock = nextLock({
    payload: args.next.payload,
    previous: previousLock,
    rendered: theirs,
    requested: args.next.requested,
    version,
    ...(args.provenance === undefined ? {} : { provenance: args.provenance }),
  });
  const changed = plan.results
    .filter((result) => result.before !== result.after)
    .map((result) => result.path);
  const pick = (kind: ResultKind): string[] =>
    plan.results.filter((result) => result.kind === kind).map((r) => r.path);
  const draft: Omit<ApplyReport, "lines"> = {
    changed,
    dryRun: args.dryRun === true,
    exitCode:
      plan.manifest.pendingMerges.length > 0 ? EXIT_WORK_PENDING : EXIT_OK,
    keptDeleted: pick("kept-deleted"),
    keptEdited: pick("upstream-deleted-owner-edited"),
    lock,
    manifest: nextManifest,
    onceChanged: pick("once-left"),
    pendingMerges: plan.manifest.pendingMerges,
    results: plan.results,
    warnings: [...theirs.warnings],
  };
  if (args.dryRun) {
    return { ...draft, lines: reportLines(draft) };
  }

  const backup = await writeBackup({
    cliVersion: version,
    root,
    targets: changed,
  });
  const journal = join(root, JOURNAL_FILE);
  await mkdir(dirname(journal), { recursive: true });
  await writeFile(
    journal,
    `${JSON.stringify({ backup, changed, startedAt: new Date().toISOString(), version }, null, 2)}\n`,
    "utf-8"
  );

  for (const result of plan.results) {
    if (result.before === result.after) {
      continue;
    }
    const abs = resolveWithinRoot(root, result.path);
    await assertNoSymlinkPath(root, abs);
    await args.beforeWrite?.(result.path);
    if (result.after === undefined) {
      await rm(abs, { force: true });
      await pruneEmptyParents(root, abs);
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, result.after, "utf-8");
    }
  }
  await saveManifestV2(root, nextManifest);
  await saveLock(root, lock);

  const warnings = [...draft.warnings];
  await dropDanglingSkillLinks(root, base?.skills ?? []);
  const links = await linkAgentSkills(root);
  for (const name of links.conflicts) {
    warnings.push(
      `.claude/skills/${name} holds something that is not a link to .agents/skills/${name}; left as it is.`
    );
  }
  for (const failure of links.failures) {
    warnings.push(`.claude/skills/${failure.name}: ${failure.message}`);
  }
  if (links.unreadable !== undefined) {
    warnings.push(`.agents/skills could not be read: ${links.unreadable}`);
  }

  await rm(journal, { force: true });
  const done = { ...draft, backup, warnings };
  return { ...done, lines: reportLines(done) };
}

/**
 * Undo the last run, finished or not: restore the newest backup byte for byte, drop the
 * folders and skill links the run left empty or dangling, and remove the journal. What
 * `--abort` calls.
 */
export async function abortApply(root: string): Promise<RestoreResult> {
  const restored = await restoreLatestBackup(root);
  for (const path of restored.removed) {
    await pruneEmptyParents(root, resolveWithinRoot(root, path));
  }
  await dropDanglingSkillLinks(root, await skillNamesOnDisk(root));
  await rm(join(root, JOURNAL_FILE), { force: true });
  return restored;
}
