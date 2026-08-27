import { readdir, readFile, rm as rmPath, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { classifyLink, hashContent, pathExists, resolveWithinRoot } from "./fs-utils.js";
import type { Lockfile } from "./lock.js";
import type { Manifest, ManifestPatch } from "./manifest.js";
import { reversePatch } from "./patch/index.js";
import type { SaasaloyConfig } from "./schema.js";

// The deterministic core of `saasaloy remove` — mirrors applier.ts's buildPlan/
// executePlan split, but for undoing a module's application (issue #27). Fully
// offline: the module descriptor isn't available at remove time (a remote add's
// temp dir is long gone), so everything here derives from the three local state
// files — manifest.managed/links/patches, saasaloy.json's installed[]/aliases, and
// the lock's dependsOn.

// How an owned managed file relates to what's actually on disk right now:
//   delete  — on-disk content matches the manifest hash → safe to remove
//   drift   — exists but hand-edited since (hash mismatch) → needs confirmation
//   missing — already gone → nothing to delete, just untrack
export type FileRemoveAction = "delete" | "drift" | "missing";

export interface PlannedRemoveFile {
  module: string;
  /** Project-relative POSIX path (manifest key). */
  target: string;
  /** Absolute path on disk. */
  targetAbs: string;
  action: FileRemoveAction;
  /** On-disk content at plan time — undefined when `missing`. Used by `--diff`. */
  oldContent?: string;
}

// How a module-owned `.claude/skills/<name>` symlink relates to what's on disk:
//   remove   — the correct link is there → safe to unlink
//   missing  — nothing there → nothing to unlink
//   conflict — something else occupies the path → leave it, warn (symmetric with `add`)
export type LinkRemoveAction = "remove" | "missing" | "conflict";

export interface PlannedRemoveLink {
  module: string;
  /** manifest.links key — the real folder the link points at (e.g. .agents/skills/<name>). */
  target: string;
  targetAbs: string;
  /** manifest.links value — the symlink path (e.g. .claude/skills/<name>). */
  path: string;
  pathAbs: string;
  action: LinkRemoveAction;
}

export interface RemovePlan {
  module: string;
  files: PlannedRemoveFile[];
  links: PlannedRemoveLink[];
  /** This module's entries in manifest.patches. Every entry is dropped on execute;
   *  a `chained-route` entry is also *reversed* on disk first (the one kind with an
   *  inverse — see `reversePatch`). The command warns naming each file it can't undo. */
  patches: ManifestPatch[];
  /** Installed modules whose lock `dependsOn` names this module — block removal
   *  without `--force`. */
  dependents: string[];
  /** Installed modules with no lock entry at all — dependent detection is
   *  incomplete for them (they might depend on this module; we can't tell). */
  missingLockEntries: string[];
}

export interface BuildRemovePlanArgs {
  root: string;
  /** Module to remove. */
  name: string;
  config: SaasaloyConfig;
  manifest: Manifest;
  lock: Lockfile;
}

// The manifest attributes overwritten files to the last writer, so whichever module
// owns a file directly under a link's target folder is the current owner of the
// link too (the `saasaloy-<module>` folder convention makes collisions unlikely —
// verified across modules/, same assumption the applier makes).
function ownerOfLinkTarget(manifest: Manifest, linkTargetKey: string): string | undefined {
  const prefix = `${linkTargetKey}/`;
  for (const [target, entry] of Object.entries(manifest.managed)) {
    if (target.startsWith(prefix)) return entry.module;
  }
  return undefined;
}

export async function buildRemovePlan(args: BuildRemovePlanArgs): Promise<RemovePlan> {
  const { root, name, config, manifest, lock } = args;

  const files: PlannedRemoveFile[] = [];
  for (const [target, entry] of Object.entries(manifest.managed)) {
    if (entry.module !== name) continue;
    const targetAbs = resolveWithinRoot(root, target);
    let action: FileRemoveAction;
    let oldContent: string | undefined;
    if (!(await pathExists(targetAbs))) {
      action = "missing";
    } else {
      oldContent = await readFile(targetAbs, "utf8");
      action = hashContent(oldContent) === entry.hash ? "delete" : "drift";
    }
    files.push({ module: name, target, targetAbs, action, oldContent });
  }

  const links: PlannedRemoveLink[] = [];
  for (const [target, path] of Object.entries(manifest.links)) {
    if (ownerOfLinkTarget(manifest, target) !== name) continue;
    const targetAbs = resolveWithinRoot(root, target);
    const pathAbs = resolveWithinRoot(root, path);
    const state = await classifyLink(pathAbs, targetAbs);
    links.push({
      module: name,
      target,
      targetAbs,
      path,
      pathAbs,
      action: state === "missing" ? "missing" : state === "correct" ? "remove" : "conflict",
    });
  }

  const patches = manifest.patches.filter((p) => p.module === name);

  // A reverse-dependency map over the lock's `dependsOn`, restricted to what's
  // actually installed — an uninstalled module's stale dependsOn doesn't matter.
  const dependents: string[] = [];
  const missingLockEntries: string[] = [];
  for (const installedName of config.installed) {
    if (installedName === name) continue;
    const lockEntry = lock.modules[installedName];
    if (!lockEntry) {
      missingLockEntries.push(installedName);
      continue;
    }
    if (lockEntry.dependsOn?.includes(name)) dependents.push(installedName);
  }

  return { module: name, files, links, patches, dependents, missingLockEntries };
}

export interface ExecuteRemoveArgs {
  root: string;
  config: SaasaloyConfig;
  manifest: Manifest;
  lock: Lockfile;
  /**
   * Manifest targets classified `drift` that the caller confirmed to actually
   * delete (an interactive per-file `confirm`). Anything drift-classified but not
   * in this set survives on disk, untracked — the non-interactive `--yes` default
   * (drift never gets silently clobbered).
   */
  deleteDrifted?: ReadonlySet<string>;
}

export interface RemoveResult {
  /** Files actually deleted from disk (hash-clean, or drift confirmed for deletion). */
  deleted: PlannedRemoveFile[];
  /** Drift files left on disk, untracked — the designed survivor outcome. */
  driftSurvivors: PlannedRemoveFile[];
  /** Files already gone from disk — just untracked, nothing to delete. */
  missingUntracked: PlannedRemoveFile[];
  /** `.claude/skills` symlinks actually removed. */
  linksRemoved: PlannedRemoveLink[];
  /** Symlinks left untouched because something else occupies their path. */
  linkConflicts: PlannedRemoveLink[];
  /** Patch entries actually undone on disk — a `chained-route` link and its import. */
  patchesReversed: ManifestPatch[];
  /** Patch entries untracked without being undone: a kind with no inverse yet (#36),
   *  a target file that's gone, or a link already hand-reverted. The command warns. */
  patchesDropped: ManifestPatch[];
  /** Project-relative POSIX directories pruned because this run emptied them. */
  prunedDirs: string[];
  /** saasaloy.json alias names dropped because their prefix directory vanished. */
  droppedAliases: string[];
}

function toPosixRelative(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

// Walk up from each deleted path's directory, removing directories that are now
// empty, stopping at the first non-empty ancestor and never past `root`. Only
// directories a deletion in *this run* could have emptied are ever candidates —
// we start exclusively from paths this run actually removed.
async function pruneEmptyDirs(root: string, deletedAbsPaths: string[]): Promise<string[]> {
  const pruned: string[] = [];
  for (const abs of deletedAbsPaths) {
    let dir = dirname(abs);
    while (dir === root || dir.startsWith(root + sep)) {
      if (dir === root) break;
      if (!(await pathExists(dir))) break; // already pruned via another file's chain
      const entries = await readdir(dir);
      if (entries.length > 0) break; // first non-empty ancestor — stop climbing
      // `recursive` is required by fs.rm to remove a directory at all; safe here
      // since we just confirmed it's empty.
      await rmPath(dir, { recursive: true, force: true });
      pruned.push(toPosixRelative(root, dir));
      dir = dirname(dir);
    }
  }
  return pruned;
}

// A dangling alias would let a future `add` silently recreate a half-workspace;
// dropping it makes `resolveTarget` fail loudly ("Unknown alias") instead.
async function dropDanglingAliases(root: string, config: SaasaloyConfig): Promise<string[]> {
  const dropped: string[] = [];
  for (const [alias, prefix] of Object.entries(config.aliases)) {
    const prefixAbs = join(root, ...prefix.split("/"));
    if (!(await pathExists(prefixAbs))) {
      delete config.aliases[alias];
      dropped.push(alias);
    }
  }
  return dropped;
}

// Whether a planned file still looks the way it did when the plan was built:
//   unchanged — byte-identical to plan time → the plan's verdict still holds
//   changed   — edited since → now user-owned content, must survive
//   gone      — deleted since → nothing left to remove
type FileRecheck = "unchanged" | "changed" | "gone";

// Arbitrary time passes between buildRemovePlan and here — the per-file drift
// confirms are interactive and can sit open indefinitely. Re-reading immediately
// before the delete is what keeps issue #27's "drift is sacred" true in the gap:
// a file the user edited while a prompt was up is drift, whatever the plan said.
async function recheckFile(file: PlannedRemoveFile): Promise<FileRecheck> {
  if (!(await pathExists(file.targetAbs))) return "gone";
  if (file.oldContent === undefined) return "changed"; // planned `missing`, something is there now
  const current = await readFile(file.targetAbs, "utf8");
  return hashContent(current) === hashContent(file.oldContent) ? "unchanged" : "changed";
}

export async function executeRemovePlan(plan: RemovePlan, args: ExecuteRemoveArgs): Promise<RemoveResult> {
  const { root, config, manifest, lock, deleteDrifted } = args;

  const deleted: PlannedRemoveFile[] = [];
  const driftSurvivors: PlannedRemoveFile[] = [];
  const missingUntracked: PlannedRemoveFile[] = [];

  for (const file of plan.files) {
    // Hash-clean, or drift the caller explicitly confirmed deleting — both are
    // "delete this exact content", so both have to prove the content is still that.
    const wantsDelete = file.action === "delete" || (file.action === "drift" && !!deleteDrifted?.has(file.target));
    if (wantsDelete) {
      const state = await recheckFile(file);
      if (state === "unchanged") {
        await rmPath(file.targetAbs, { force: true });
        deleted.push(file);
      } else if (state === "gone") {
        missingUntracked.push(file);
      } else {
        // Edited between planning and now — the confirm the user gave was for
        // different bytes, so it doesn't authorize deleting these.
        driftSurvivors.push(file);
      }
    } else if (file.action === "drift") {
      driftSurvivors.push(file);
    } else {
      missingUntracked.push(file);
    }
    // Untrack in every case — a declined/survivor drift file becomes user-owned
    // (it classifies as a `conflict` on a future re-add, same as any untracked file).
    delete manifest.managed[file.target];
  }

  const linksRemoved: PlannedRemoveLink[] = [];
  const linkConflicts: PlannedRemoveLink[] = [];
  for (const link of plan.links) {
    if (link.action === "remove") {
      // Same staleness window as files: the link may have been replaced by a real
      // file or repointed since planning, and neither is ours to delete.
      const state = await classifyLink(link.pathAbs, link.targetAbs);
      if (state === "correct") {
        await rmPath(link.pathAbs, { force: true });
        linksRemoved.push(link);
      } else if (state === "conflict") {
        linkConflicts.push(link);
      }
      // "missing" — already gone, nothing to unlink.
    } else if (link.action === "conflict") {
      linkConflicts.push(link);
    }
    // Drop the links entry either way (ADR 0015 symmetry with `add`).
    delete manifest.links[link.target];
  }

  // Reverse what can be reversed, then untrack every entry either way. Only
  // `chained-route` has an inverse today (#83); the rest stay report-only until #36
  // generalises the mechanism, and the command warns naming each file.
  //
  // Read fresh disk content rather than trusting the plan, mirroring what `executePlan`
  // does forward: the file may have been hand-edited since the plan was built. The
  // codemod is a no-op when the link it recorded is already gone, so a hand-reverted
  // file is untracked and warned about instead of force-edited.
  const patchesReversed: ManifestPatch[] = [];
  const patchesDropped: ManifestPatch[] = [];
  for (const entry of plan.patches) {
    const fileAbs = resolveWithinRoot(root, entry.file);
    let reversed = false;
    if (await pathExists(fileAbs)) {
      const source = await readFile(fileAbs, "utf8");
      const result = reversePatch(source, entry.patch, entry.file);
      if (result?.changed) {
        await writeFile(fileAbs, result.content, "utf8");
        reversed = true;
      }
    }
    (reversed ? patchesReversed : patchesDropped).push(entry);
  }
  manifest.patches = manifest.patches.filter((p) => p.module !== plan.module);

  const prunedDirs = await pruneEmptyDirs(root, [
    ...deleted.map((f) => f.targetAbs),
    ...linksRemoved.map((l) => l.pathAbs),
  ]);
  const droppedAliases = await dropDanglingAliases(root, config);

  config.installed = config.installed.filter((m) => m !== plan.module);
  delete lock.modules[plan.module];

  return {
    deleted,
    driftSurvivors,
    missingUntracked,
    linksRemoved,
    linkConflicts,
    patchesReversed,
    patchesDropped,
    prunedDirs,
    droppedAliases,
  };
}
