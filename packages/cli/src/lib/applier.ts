import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import {
  assertNoSymlinkPath,
  classifyLink,
  createDirLink,
  hashContent,
  joinModulePath,
  listFilesRelative,
  pathExists,
  readIfPresent,
  resolveWithinRoot,
} from "./fs-utils.js";
import { samePatchEntry } from "./manifest.js";
import type { Manifest, ManifestPatch } from "./manifest.js";
import { applyPatch } from "./patch/index.js";
import type { PatchMatch } from "./patch/index.js";
import type { LoadedModule } from "./registry.js";
import { resolveTarget } from "./saasaloy-config.js";
import type { RegistryPatch, SaasaloyConfig } from "./schema.js";

// The deterministic core of `saasaloy add`: turn the modules-to-install into a plan of
// concrete file writes, classify each against the manifest's content hashes, then
// execute the safe ones (build spec §2.9, §3.2). Convention-based file-drop is the
// whole spine here; structural AST patches are the separate 10% (issue #7).

// How a planned file relates to what's already on disk:
//   create    — target doesn't exist yet
//   overwrite — tracked by us and untouched since (hash matches manifest) → safe update
//   unchanged — on-disk content already equals what we'd write
//   drift     — tracked by us but hand-edited (hash ≠ manifest) → route to AI-merge, don't clobber
//   conflict  — exists but we never wrote it (untracked) → don't clobber
export type FileAction =
  "create" | "overwrite" | "unchanged" | "drift" | "conflict";

// Actions safe to apply without a human in the loop; drift/conflict are held back
// for a merge. This is also the set whose content the patch preview reads, since each
// of these leaves the planned bytes on disk.
const SAFE: ReadonlySet<FileAction> = new Set<FileAction>([
  "create",
  "overwrite",
  "unchanged",
]);

// Of the safe actions, the ones that need an actual write. `unchanged` means disk
// already holds these exact bytes, so rewriting it would churn the file's mtime for
// nothing — its manifest entry is still refreshed (#98, matching `executeUpdatePlan`).
const WRITABLE: ReadonlySet<FileAction> = new Set<FileAction>([
  "create",
  "overwrite",
]);

export interface PlannedFile {
  module: string;
  /** Absolute path of the source file inside the module folder. */
  source: string;
  /** Module-relative POSIX source path (`files/lib/x.ts`) — recorded as the manifest's `from`. */
  from: string;
  /** Project-relative POSIX path (manifest key + display). */
  target: string;
  /** Absolute destination path. */
  targetAbs: string;
  content: string;
  newHash: string;
  action: FileAction;
  /** Present when the target already exists — used by `--diff`. */
  oldContent?: string;
  /** True for files copied from an `agent.skills` folder (vs. `files[]`). */
  isSkill: boolean;
}

// How a skill's `.claude/skills/<name>` symlink relates to what's already on disk:
//   create   — nothing there, we'll make the link
//   exists   — the correct link is already present (idempotent re-add)
//   conflict — a real dir/file or a link elsewhere sits there → don't clobber
export type LinkAction = "create" | "exists" | "conflict";

// How a planned config patch relates to its target file:
//   apply     — target resolvable and the patch changes it → write the result
//   unchanged — the patch is already present (idempotent no-op) → skip the write
//   missing   — no target file (not scaffolded this run, not on disk) → can't patch
export type PatchAction = "apply" | "unchanged" | "missing";

// A structural config patch bound to a concrete target file (ADR 0019). Unlike a
// PlannedFile it is never manifest-tracked as a managed file — a patch mutates a
// file another module owns, so it isn't a clean managed copy. `executePlan` records
// each applied patch in `manifest.patches`, which is what `remove` reads back: it
// reverses a `chained-route` entry and warns about every other kind until issue #36
// generalises the inverse.
export interface PlannedPatch {
  module: string;
  /** Project-relative POSIX path of the file being patched. */
  file: string;
  /** Absolute path of the target file. */
  fileAbs: string;
  /** The op as authored (kind + payload + file) — re-applied at execute time. */
  patch: RegistryPatch;
  action: PatchAction;
  /** Unified diff of the would-be change; `""` when unchanged or missing. */
  diff: string;
  /** The would-be content after the patch; undefined when the target is missing. */
  content?: string;
  /** Set when the patch's identity already exists at a different value — the user edited
   *  what we would have written. `update` reports these into its merge plan; `add`
   *  ignores it (issue #48, decision 1). */
  matched?: PatchMatch;
}

// A `.claude/skills/<name>` symlink pointing at the real, committed `.agents/skills/<name>`
// folder, so Claude Code discovers the skill while every other agent reads the files directly.
export interface PlannedLink {
  module: string;
  /** Project-relative POSIX path of the symlink (under `.claude/skills`). */
  path: string;
  /** Absolute path of the symlink. */
  pathAbs: string;
  /** Project-relative POSIX path the link points at (under `.agents/skills`). */
  target: string;
  /** Absolute path of the link target. */
  targetAbs: string;
  action: LinkAction;
}

export interface Plan {
  /** Modules being applied, in topological order. */
  install: string[];
  /** Requested modules already installed (skipped). */
  alreadyInstalled: string[];
  files: PlannedFile[];
  /** `.claude/skills/<name>` symlinks the installed skills register (created by executePlan). */
  links: PlannedLink[];
  /** Union of npm `dependencies[]` declared across the installed modules. */
  dependencies: string[];
  /** Union of npm `devDependencies[]` declared across the installed modules. */
  devDependencies: string[];
  /** Union of env vars declared (name → description) — reported, not written. */
  envVars: Record<string, string>;
  /** Union of the local-dev values declared for those vars — written into `.dev.vars.example`. */
  devVars: Record<string, string>;
  /** Aliases the installed scaffolds register into saasaloy.json (applied by executePlan). */
  aliases: Record<string, string>;
  /** Human-readable notes where a scaffold alias would redefine an existing one to a new path. */
  aliasConflicts: string[];
  /** Structural config patches to apply (previewed against the would-be on-disk state). */
  patches: PlannedPatch[];
}

/** A file one revision of a module ships: where it comes from and where it lands. */
export interface ModuleFileRef {
  /** Module-relative POSIX source path (`files/lib/x.ts`) — the manifest's `from`. */
  from: string;
  /** Project-relative POSIX target path. */
  target: string;
  /** Absolute path of the source file inside the module folder. */
  abs: string;
}

/**
 * Every file a module ships, keyed by its project-relative target — `files[]`, each
 * scaffold's workspace files, and each `agent.skills` folder expanded.
 *
 * The one place those three rules live. `buildPlan` walks it to plan an `add`, and
 * `buildUpdatePlan` walks it at two SHAs to diff a module against itself, so `update`
 * always sees exactly the set `add` would have written. Each engine carried its own copy
 * of these rules until #98, which is how the write-path guards drifted apart.
 */
export async function listModuleFiles(
  mod: LoadedModule,
  aliases: Record<string, string>
): Promise<Map<string, ModuleFileRef>> {
  const out = new Map<string, ModuleFileRef>();
  const record = (from: string, target: string): void => {
    out.set(target, { from, target, abs: joinModulePath(mod.dir, from) });
  };

  for (const file of mod.item.files ?? []) {
    record(file.path, resolveTarget(aliases, file.target));
  }
  for (const scaffold of mod.item.scaffolds ?? []) {
    for (const file of scaffold.files) {
      record(file.path, posix.join(scaffold.workspace, file.target));
    }
  }
  for (const skillRel of mod.item.agent?.skills ?? []) {
    const folderName = posix.basename(skillRel);
    for (const rel of await listFilesRelative(
      joinModulePath(mod.dir, skillRel)
    )) {
      record(
        posix.join(skillRel, rel),
        posix.join(".agents/skills", folderName, rel)
      );
    }
  }
  return out;
}

/** True for a target under the `.agents/skills/` namespace an `agent.skills` folder fills. */
function isSkillTarget(target: string): boolean {
  return target.startsWith(".agents/skills/");
}

/**
 * A file this run plans to lay down, as the patch preview needs to see it: the content,
 * and whether that content actually reaches disk. A held-back file keeps whatever is
 * there, so its planned content is only a last resort.
 */
export interface PatchSourceFile {
  /** The content this run would write; `undefined` when the module dropped the file. */
  content?: string;
  /** True when this run leaves that content on disk. */
  landsOnDisk: boolean;
}

export interface PreviewPatchesArgs {
  root: string;
  /** Module that authored these ops — recorded on each preview. */
  module: string;
  ops: RegistryPatch[];
  /** Files this run plans, keyed by project-relative target. */
  planned: ReadonlyMap<string, PatchSourceFile>;
}

/**
 * Preview a module's config patches against the state this run will leave behind.
 *
 * Shared by `buildPlan` and `buildUpdatePlan` (#98): both resolve a patch's source the
 * same three ways — a file this run writes, else what is on disk, else a held-back
 * file's planned content — and both need the preview to be pure, because `--dry-run`
 * and `--diff` render it without writing. Only genuinely-absent targets are `missing`.
 * Both engines re-apply against fresh disk state at execute time; this is the preview,
 * never the source of truth for the write.
 */
export async function previewPatches(
  args: PreviewPatchesArgs
): Promise<PlannedPatch[]> {
  const { root, module, ops, planned } = args;
  const out: PlannedPatch[] = [];
  for (const op of ops) {
    const fileAbs = resolveWithinRoot(root, op.file);
    const plannedFile = planned.get(op.file);
    const source = plannedFile?.landsOnDisk
      ? plannedFile.content
      : ((await readIfPresent(fileAbs)) ?? plannedFile?.content);
    if (source === undefined) {
      out.push({
        module,
        file: op.file,
        fileAbs,
        patch: op,
        action: "missing",
        diff: "",
      });
      continue;
    }
    const { content, changed, diff, matched } = applyPatch(source, op, op.file);
    out.push({
      module,
      file: op.file,
      fileAbs,
      patch: op,
      action: changed ? "apply" : "unchanged",
      diff,
      content,
      ...(matched ? { matched } : {}),
    });
  }
  return out;
}

async function classify(
  targetAbs: string,
  target: string,
  newHash: string,
  manifest: Manifest
): Promise<{ action: FileAction; oldContent?: string }> {
  if (!(await pathExists(targetAbs))) {
    return { action: "create" };
  }
  const oldContent = await readFile(targetAbs, "utf-8");
  const oldHash = hashContent(oldContent);
  if (oldHash === newHash) {
    return { action: "unchanged", oldContent };
  }
  const managed = manifest.managed[target];
  if (managed) {
    return {
      action: managed.hash === oldHash ? "overwrite" : "drift",
      oldContent,
    };
  }
  return { action: "conflict", oldContent };
}

async function planModuleFile(
  module: LoadedModule,
  ref: ModuleFileRef,
  root: string,
  manifest: Manifest
): Promise<PlannedFile> {
  const content = await readFile(ref.abs, "utf-8");
  const newHash = hashContent(content);
  // `add` is the one engine whose input is an untrusted remote descriptor, so the target
  // is resolved under the same guard `remover` and `updater` use on their state files
  // (#98). `join()` normalizes a `..` away silently; this refuses it instead.
  const targetAbs = resolveWithinRoot(root, ref.target);
  const { action, oldContent } = await classify(
    targetAbs,
    ref.target,
    newHash,
    manifest
  );
  return {
    module: module.item.name,
    source: ref.abs,
    from: ref.from,
    target: ref.target,
    targetAbs,
    content,
    newHash,
    action,
    oldContent,
    isSkill: isSkillTarget(ref.target),
  };
}

export interface BuildPlanArgs {
  root: string;
  install: string[];
  alreadyInstalled: string[];
  modules: Map<string, LoadedModule>;
  config: SaasaloyConfig;
  manifest: Manifest;
}

export async function buildPlan(args: BuildPlanArgs): Promise<Plan> {
  const { root, install, alreadyInstalled, modules, config, manifest } = args;
  const files: PlannedFile[] = [];
  const links: PlannedLink[] = [];
  const dependencies: string[] = [];
  const devDependencies: string[] = [];
  const envVars: Record<string, string> = {};
  const devVars: Record<string, string> = {};

  // Collect the aliases every scaffold in this run registers up front, so a feature's
  // files[] can resolve against a capability's brand-new alias even when both install in
  // the same run. Topo order already lands the capability first; this makes resolution
  // order-independent and keeps the target-resolving view (below) complete (ADR 0013).
  const aliases: Record<string, string> = {};
  for (const name of install) {
    for (const scaffold of modules.get(name)?.item.scaffolds ?? []) {
      for (const [alias, prefix] of Object.entries(scaffold.aliases ?? {})) {
        aliases[alias] = prefix;
      }
    }
  }
  const aliasConflicts: string[] = [];
  for (const [alias, prefix] of Object.entries(aliases)) {
    const existing = config.aliases[alias];
    if (existing !== undefined && existing !== prefix) {
      aliasConflicts.push(`${alias} → ${existing} redefined as ${prefix}`);
    }
  }
  // Scaffold aliases win over the on-disk map when resolving this run's file targets.
  const aliasView = { ...config.aliases, ...aliases };

  for (const name of install) {
    const mod = modules.get(name);
    if (!mod) {
      continue;
    }
    const { item } = mod;

    // One enumeration for all three rules — `files[]`, each scaffold's workspace files,
    // and each `agent.skills` folder — shared with `update` (#98). A scaffold file's
    // target is workspace-relative and a skill file's lands under `.agents/skills/`;
    // from here every one of them is an ordinary managed file, classified and recorded
    // alike, so create/drift/conflict and `remove` all come for free.
    for (const ref of (await listModuleFiles(mod, aliasView)).values()) {
      files.push(await planModuleFile(mod, ref, root, manifest));
    }

    // The skill files themselves are real, committed files under `.agents/skills/<folder>/…`,
    // readable by every AI agent rather than only Claude Code. A `.claude/skills/<folder>`
    // symlink points back at them so Claude Code still discovers the skill (ADR 0015).
    for (const skillRel of item.agent?.skills ?? []) {
      const folderName = posix.basename(skillRel);
      const linkPath = posix.join(".claude/skills", folderName);
      const linkTarget = posix.join(".agents/skills", folderName);
      // Both sides are engine-built from a descriptor-supplied folder name, so both go
      // through the guard — the name is the untrusted part (#98).
      const pathAbs = resolveWithinRoot(root, linkPath);
      const targetAbs = resolveWithinRoot(root, linkTarget);
      const state = await classifyLink(pathAbs, targetAbs);
      links.push({
        module: name,
        path: linkPath,
        pathAbs,
        target: linkTarget,
        targetAbs,
        action:
          state === "missing"
            ? "create"
            : state === "correct"
              ? "exists"
              : "conflict",
      });
    }

    for (const dep of item.dependencies ?? []) {
      dependencies.push(dep);
    }
    for (const dep of item.devDependencies ?? []) {
      devDependencies.push(dep);
    }
    for (const [key, value] of Object.entries(item.devVars ?? {})) {
      devVars[key] = value;
    }
    for (const [key, value] of Object.entries(item.envVars ?? {})) {
      envVars[key] = value;
    }
  }

  // Plan patches after every file is collected, so an op targeting a file another module
  // scaffolds this same run previews against that file's *would-be* content, not disk.
  const planned = new Map<string, PatchSourceFile>(
    files.map((f) => [
      f.target,
      { content: f.content, landsOnDisk: SAFE.has(f.action) },
    ])
  );
  const patches: PlannedPatch[] = [];
  for (const name of install) {
    patches.push(
      ...(await previewPatches({
        root,
        module: name,
        ops: modules.get(name)?.item.patches ?? [],
        planned,
      }))
    );
  }

  return {
    install,
    alreadyInstalled,
    files,
    links,
    dependencies,
    devDependencies,
    devVars,
    envVars,
    aliases,
    aliasConflicts,
    patches,
  };
}

export interface ApplyResult {
  written: PlannedFile[];
  /** Files already byte-identical to what we'd write — manifest refreshed, disk untouched. */
  refreshed: PlannedFile[];
  /** Planned-writable files edited between planning and the write — left alone. */
  lateDrift: PlannedFile[];
  /** drift + conflict files, held back for the merge path. */
  heldBack: PlannedFile[];
  /** `.claude/skills` symlinks created or already correct, recorded in the manifest. */
  links: PlannedLink[];
  /** Symlinks left untouched because something else already occupies their path. */
  linkConflicts: PlannedLink[];
  /** Config patches that actually changed their target file. */
  patched: PlannedPatch[];
  /** Patches whose target file was absent — reported, not applied. */
  patchConflicts: PlannedPatch[];
  /** Patches the codemod declined to apply, each with the reason it gave. Distinct from
   *  an idempotent no-op, which changes nothing and has nothing to report. */
  patchRefusals: PatchRefusal[];
}

/** A patch left unapplied on purpose, and the codemod's own account of why. */
export interface PatchRefusal {
  patch: PlannedPatch;
  reason: string;
}

/**
 * Whether a planned file still looks the way it did when the plan was built. The
 * confirmation prompt sits between the two and can stay open indefinitely, so the
 * verdict is re-earned immediately before the write — the same reason `remover.ts`
 * re-checks before deleting and `updater.ts` before overwriting (#98). A planned
 * `create` matches only while its path is still empty.
 */
async function stillMatches(file: PlannedFile): Promise<boolean> {
  return (await readIfPresent(file.targetAbs)) === file.oldContent;
}

// Write the safe files, record each in the manifest with its content hash, and mark
// the modules installed. Drift/conflict files are left on disk untouched and returned
// so the caller can emit an AI-merge plan (the non-deterministic seam, build spec §2.9).
export async function executePlan(
  plan: Plan,
  root: string,
  config: SaasaloyConfig,
  manifest: Manifest
): Promise<ApplyResult> {
  const written: PlannedFile[] = [];
  const refreshed: PlannedFile[] = [];
  const lateDrift: PlannedFile[] = [];
  const heldBack: PlannedFile[] = [];
  const links: PlannedLink[] = [];
  const linkConflicts: PlannedLink[] = [];
  const patched: PlannedPatch[] = [];
  const patchConflicts: PlannedPatch[] = [];
  const patchRefusals: PatchRefusal[] = [];

  for (const file of plan.files) {
    if (!SAFE.has(file.action)) {
      heldBack.push(file);
      continue;
    }
    if (!(await stillMatches(file))) {
      // Edited while the confirmation was up — the plan the user approved described
      // different bytes, so it doesn't authorize overwriting these.
      lateDrift.push(file);
      continue;
    }
    if (WRITABLE.has(file.action)) {
      // `resolveWithinRoot` proved the path is lexically inside the project; `writeFile`
      // still follows links, so a planted symlink on any component would carry the write
      // outside it. Refuse before creating the parent dirs (#98), matching `remover`.
      await assertNoSymlinkPath(root, file.targetAbs);
      await mkdir(dirname(file.targetAbs), { recursive: true });
      await writeFile(file.targetAbs, file.content, "utf-8");
      written.push(file);
    } else {
      // `unchanged`: disk already holds these exact bytes. Its manifest entry is still
      // refreshed — that is how a file installed before `from` existed acquires one.
      refreshed.push(file);
    }
    manifest.managed[file.target] = {
      module: file.module,
      hash: file.newHash,
      from: file.from,
    };
  }

  // Apply structural patches after the file writes, so an op targeting a freshly-scaffolded
  // file (e.g. `database`'s D1 binding into api's just-written wrangler.jsonc) reads the real
  // content. Re-read disk here rather than trusting the plan's preview — the file may have been
  // held back as drift/conflict. The engine is idempotent, so a re-apply is a clean no-op, and a
  // patched file is deliberately *not* re-tracked in the manifest (it's another module's copy).
  for (const p of plan.patches) {
    if (!(await pathExists(p.fileAbs))) {
      patchConflicts.push(p);
      continue;
    }
    // The read below follows links just as the write does, so guard before either (#98).
    await assertNoSymlinkPath(root, p.fileAbs);
    const source = await readFile(p.fileAbs, "utf-8");
    const { content, changed, reason } = applyPatch(source, p.patch, p.file);
    if (changed) {
      await writeFile(p.fileAbs, content, "utf-8");
      patched.push(p);
      // Record for `remove` (which reverses only `chained-route` today, and warns for the
      // rest) — deduped so a `--force` re-apply that lands the same op again doesn't
      // duplicate the entry.
      const entry: ManifestPatch = {
        module: p.module,
        file: p.file,
        patch: p.patch,
      };
      if (
        !manifest.patches.some((existing) => samePatchEntry(existing, entry))
      ) {
        manifest.patches.push(entry);
      }
    } else if (reason !== undefined) {
      // The codemod refused rather than no-op'd: nothing is written and nothing is
      // tracked, so the manifest keeps saying `remove` has no business in this file.
      patchRefusals.push({ patch: p, reason });
    }
  }

  // Point `.claude/skills/<name>` at the real `.agents/skills/<name>` folder written above so
  // Claude Code discovers the skill. The native link (junction on Windows, symlink elsewhere) is
  // regenerated per-machine and git-ignored; the manifest tracks source→link for a clean `remove`.
  for (const link of plan.links) {
    if (link.action === "conflict") {
      linkConflicts.push(link);
      continue;
    }
    if (link.action === "create") {
      // Only the `create` leg writes. An `exists` link is our own symlink at the final
      // component, which the guard would (correctly) refuse, so it is not asked (#98).
      await assertNoSymlinkPath(root, link.pathAbs);
      await createDirLink(link.pathAbs, link.targetAbs);
    }
    manifest.links[link.target] = link.path;
    links.push(link);
  }

  // Register the aliases the scaffolds declared so the first feature targeting them
  // resolves against a real path (ADR 0013). Merge is idempotent on re-apply; a conflicting
  // redefinition was surfaced at plan time (plan.aliasConflicts) — last write wins here.
  for (const [alias, prefix] of Object.entries(plan.aliases)) {
    config.aliases[alias] = prefix;
  }

  // A module counts as installed once its clean files have landed. Preserve insertion
  // order and dedupe against what's already there.
  for (const name of plan.install) {
    if (!config.installed.includes(name)) {
      config.installed.push(name);
    }
  }

  return {
    written,
    refreshed,
    lateDrift,
    heldBack,
    links,
    linkConflicts,
    patched,
    patchConflicts,
    patchRefusals,
  };
}
