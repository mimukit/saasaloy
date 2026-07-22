import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { hashContent, pathExists } from "./fs-utils.js";
import type { Manifest } from "./manifest.js";
import type { LoadedModule } from "./registry.js";
import { resolveTarget } from "./saasaloy-config.js";
import type { SaasaloyConfig } from "./schema.js";

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
export type FileAction = "create" | "overwrite" | "unchanged" | "drift" | "conflict";

/** Actions that are safe to write; drift/conflict are held back for a merge. */
export const WRITABLE: ReadonlySet<FileAction> = new Set<FileAction>([
  "create",
  "overwrite",
  "unchanged",
]);

export interface PlannedFile {
  module: string;
  /** Absolute path of the source file inside the module folder. */
  source: string;
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

export interface Plan {
  /** Modules being applied, in topological order. */
  install: string[];
  /** Requested modules already installed (skipped). */
  alreadyInstalled: string[];
  files: PlannedFile[];
  /** Union of npm deps declared across the installed modules. */
  dependencies: string[];
  /** Union of env vars declared (name → description) — reported, not written. */
  envVars: Record<string, string>;
  /** Modules declaring non-empty `patches` — deferred to the patch engine (issue #7). */
  deferredPatches: string[];
  /** Modules declaring `scaffolds` — deferred (capability scaffolding, issues #8/#9). */
  deferredScaffolds: string[];
}

// Recursively list files under a directory as paths relative to it (POSIX-joined).
async function listFilesRelative(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFilesRelative(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

async function classify(
  targetAbs: string,
  target: string,
  newHash: string,
  manifest: Manifest,
): Promise<{ action: FileAction; oldContent?: string }> {
  if (!(await pathExists(targetAbs))) {
    return { action: "create" };
  }
  const oldContent = await readFile(targetAbs, "utf8");
  const oldHash = hashContent(oldContent);
  if (oldHash === newHash) {
    return { action: "unchanged", oldContent };
  }
  const managed = manifest.managed[target];
  if (managed) {
    return { action: managed.hash === oldHash ? "overwrite" : "drift", oldContent };
  }
  return { action: "conflict", oldContent };
}

async function planModuleFile(
  module: LoadedModule,
  sourceRel: string,
  target: string,
  root: string,
  manifest: Manifest,
  isSkill: boolean,
): Promise<PlannedFile> {
  const source = join(module.dir, sourceRel);
  const content = await readFile(source, "utf8");
  const newHash = hashContent(content);
  const targetAbs = join(root, ...target.split("/"));
  const { action, oldContent } = await classify(targetAbs, target, newHash, manifest);
  return {
    module: module.item.name,
    source,
    target,
    targetAbs,
    content,
    newHash,
    action,
    oldContent,
    isSkill,
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
  const dependencies: string[] = [];
  const envVars: Record<string, string> = {};
  const deferredPatches: string[] = [];
  const deferredScaffolds: string[] = [];

  for (const name of install) {
    const mod = modules.get(name);
    if (!mod) continue;
    const { item } = mod;

    for (const file of item.files ?? []) {
      const target = resolveTarget(config.aliases, file.target);
      files.push(await planModuleFile(mod, file.path, target, root, manifest, false));
    }

    // `agent.skills` folders are copied into .claude/skills/<folder-name>/… and every
    // file recorded in the manifest, so `remove` can undo them (build spec §2.13, §3.3).
    for (const skillRel of item.agent?.skills ?? []) {
      const skillDir = join(mod.dir, skillRel);
      const folderName = posix.basename(skillRel);
      const skillFiles = await listFilesRelative(skillDir);
      for (const rel of skillFiles) {
        const target = posix.join(".claude/skills", folderName, rel);
        files.push(await planModuleFile(mod, posix.join(skillRel, rel), target, root, manifest, true));
      }
    }

    for (const dep of item.dependencies ?? []) dependencies.push(dep);
    for (const [key, value] of Object.entries(item.envVars ?? {})) envVars[key] = value;
    if (item.patches && Object.keys(item.patches).length > 0) deferredPatches.push(name);
    if (item.scaffolds && item.scaffolds.length > 0) deferredScaffolds.push(name);
  }

  return {
    install,
    alreadyInstalled,
    files,
    dependencies,
    envVars,
    deferredPatches,
    deferredScaffolds,
  };
}

export interface ApplyResult {
  written: PlannedFile[];
  /** drift + conflict files, held back for the merge path. */
  heldBack: PlannedFile[];
}

// Write the safe files, record each in the manifest with its content hash, and mark
// the modules installed. Drift/conflict files are left on disk untouched and returned
// so the caller can emit an AI-merge plan (the non-deterministic seam, build spec §2.9).
export async function executePlan(
  plan: Plan,
  root: string,
  config: SaasaloyConfig,
  manifest: Manifest,
): Promise<ApplyResult> {
  const written: PlannedFile[] = [];
  const heldBack: PlannedFile[] = [];

  for (const file of plan.files) {
    if (WRITABLE.has(file.action)) {
      await mkdir(dirname(file.targetAbs), { recursive: true });
      await writeFile(file.targetAbs, file.content, "utf8");
      manifest.managed[file.target] = { module: file.module, hash: file.newHash };
      written.push(file);
    } else {
      heldBack.push(file);
    }
  }

  // A module counts as installed once its clean files have landed. Preserve insertion
  // order and dedupe against what's already there.
  for (const name of plan.install) {
    if (!config.installed.includes(name)) config.installed.push(name);
  }

  return { written, heldBack };
}
