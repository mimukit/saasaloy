import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { classifyLink, createDirLink, hashContent, pathExists } from "./fs-utils.js";
import type { Manifest } from "./manifest.js";
import { applyPatch } from "./patch/index.js";
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
export type FileAction = "create" | "overwrite" | "unchanged" | "drift" | "conflict";

// Actions that are safe to write; drift/conflict are held back for a merge.
const WRITABLE: ReadonlySet<FileAction> = new Set<FileAction>([
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
// PlannedFile it is never manifest-tracked — a patch mutates a file another module
// owns, so it isn't a clean managed copy; clean reverse-patching on `remove` is #27.
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
  /** Union of npm deps declared across the installed modules. */
  dependencies: string[];
  /** Union of env vars declared (name → description) — reported, not written. */
  envVars: Record<string, string>;
  /** Aliases the installed scaffolds register into saasaloy.json (applied by executePlan). */
  aliases: Record<string, string>;
  /** Human-readable notes where a scaffold alias would redefine an existing one to a new path. */
  aliasConflicts: string[];
  /** Structural config patches to apply (previewed against the would-be on-disk state). */
  patches: PlannedPatch[];
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
  const links: PlannedLink[] = [];
  const dependencies: string[] = [];
  const envVars: Record<string, string> = {};

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
    if (!mod) continue;
    const { item } = mod;

    for (const file of item.files ?? []) {
      const target = resolveTarget(aliasView, file.target);
      files.push(await planModuleFile(mod, file.path, target, root, manifest, false));
    }

    // A capability's scaffolds[] births a whole workspace: each file's target is
    // relative to the workspace root, so join it onto the workspace dir to get the
    // project-relative path. From there it's an ordinary managed file — classified and
    // recorded like any other, so create/drift/conflict and `remove` all come for free.
    for (const scaffold of item.scaffolds ?? []) {
      for (const file of scaffold.files) {
        const target = posix.join(scaffold.workspace, file.target);
        files.push(await planModuleFile(mod, file.path, target, root, manifest, false));
      }
    }

    // `agent.skills` folders land as real, committed files under `.agents/skills/<folder>/…`
    // (readable by every AI agent, not just Claude Code) — each recorded in the manifest so
    // `remove` can undo it. A `.claude/skills/<folder>` symlink then points back at them so
    // Claude Code still discovers the skill (ADR 0015).
    for (const skillRel of item.agent?.skills ?? []) {
      const skillDir = join(mod.dir, skillRel);
      const folderName = posix.basename(skillRel);
      const skillFiles = await listFilesRelative(skillDir);
      for (const rel of skillFiles) {
        const target = posix.join(".agents/skills", folderName, rel);
        files.push(await planModuleFile(mod, posix.join(skillRel, rel), target, root, manifest, true));
      }
      const linkPath = posix.join(".claude/skills", folderName);
      const linkTarget = posix.join(".agents/skills", folderName);
      const pathAbs = join(root, ...linkPath.split("/"));
      const targetAbs = join(root, ...linkTarget.split("/"));
      const state = await classifyLink(pathAbs, targetAbs);
      links.push({
        module: name,
        path: linkPath,
        pathAbs,
        target: linkTarget,
        targetAbs,
        action: state === "missing" ? "create" : state === "correct" ? "exists" : "conflict",
      });
    }

    for (const dep of item.dependencies ?? []) dependencies.push(dep);
    for (const [key, value] of Object.entries(item.envVars ?? {})) envVars[key] = value;
  }

  // Plan patches after every file is collected, so an op targeting a file another module
  // scaffolds this same run previews against that file's *would-be* content, not disk. The
  // engine is pure, so we can compute the diff up front for `--dry-run`/`--diff`; executePlan
  // re-applies against fresh disk state (below) — the source of truth for the actual write.
  const patches: PlannedPatch[] = [];
  for (const name of install) {
    for (const op of modules.get(name)?.item.patches ?? []) {
      const fileAbs = join(root, ...op.file.split("/"));
      // A writable planned file lands on disk before the patch runs, so preview against it.
      // Otherwise fall back to disk (a held-back file keeps its content; or `api` from a
      // prior run). Only genuinely-absent targets are `missing`.
      const planned = files.find((f) => f.target === op.file);
      let source: string | undefined;
      if (planned && WRITABLE.has(planned.action)) {
        source = planned.content;
      } else if (await pathExists(fileAbs)) {
        source = await readFile(fileAbs, "utf8");
      } else {
        source = planned?.content;
      }
      if (source === undefined) {
        patches.push({ module: name, file: op.file, fileAbs, patch: op, action: "missing", diff: "" });
        continue;
      }
      const { content, changed, diff } = applyPatch(source, op, op.file);
      patches.push({
        module: name,
        file: op.file,
        fileAbs,
        patch: op,
        action: changed ? "apply" : "unchanged",
        diff,
        content,
      });
    }
  }

  return {
    install,
    alreadyInstalled,
    files,
    links,
    dependencies,
    envVars,
    aliases,
    aliasConflicts,
    patches,
  };
}

export interface ApplyResult {
  written: PlannedFile[];
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
  const links: PlannedLink[] = [];
  const linkConflicts: PlannedLink[] = [];
  const patched: PlannedPatch[] = [];
  const patchConflicts: PlannedPatch[] = [];

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
    const source = await readFile(p.fileAbs, "utf8");
    const { content, changed } = applyPatch(source, p.patch, p.file);
    if (changed) {
      await writeFile(p.fileAbs, content, "utf8");
      patched.push(p);
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
    if (!config.installed.includes(name)) config.installed.push(name);
  }

  return { written, heldBack, links, linkConflicts, patched, patchConflicts };
}
