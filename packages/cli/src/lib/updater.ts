import { mkdir, readFile, rm as rmPath, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import {
  buildPlan,
  executePlan,
  listModuleFiles,
  previewPatches,
} from "./applier.js";
import type { LinkAction, Plan, PlannedLink, PlannedPatch } from "./applier.js";
import {
  classifyLink,
  createDirLink,
  hashContent,
  pathExists,
  readIfPresent,
  resolveWithinRoot,
} from "./fs-utils.js";
import type { Lockfile, LockModule } from "./lock.js";
import { samePatchEntry } from "./manifest.js";
import type { Manifest, ManifestPatch } from "./manifest.js";
import { applyPatch } from "./patch/index.js";
import { parseDep, writeDeps } from "./pkg-json.js";
import type { DepChange, PackageJson } from "./pkg-json.js";
import type { LoadedModule } from "./registry.js";
import { classifyTrackedFile } from "./remover.js";
import type { FileRemoveAction } from "./remover.js";
import type { RegistryPatch, SaasaloyConfig } from "./schema.js";

// The deterministic core of `saasaloy update` (issue #48), mirroring the buildPlan/
// executePlan split of applier.ts and remover.ts. Two things live here:
//
//   compareInstalled — "did anything move?", derived from the lockfile alone. Exported
//     on its own because `saasaloy outdated` (#50) is exactly this and nothing else.
//   buildUpdatePlan / executeUpdatePlan — the three-way classification the merge plan
//     is built from: *base* (the module at the lock's old SHA), *theirs* (at the new
//     SHA) and *mine* (what's on disk). The lock's `resolved` SHA is what makes a real
//     merge base reachable at all (ADR 0006, ADR 0012).
//
// Nothing here fetches: the command hands over already-loaded module folders, which is
// what keeps this whole file testable offline.

/** The command named in the summary and the merge plan's Verification section — never run (decision 16). */
export const VERIFY_COMMAND = "pnpm typecheck";

/** Surfaced when the update moved a db schema file — never run, never applied (decision 12). */
export const MIGRATION_COMMAND = "pnpm --filter @repo/db db:generate";

/** The capability that owns migrations; without it there is nothing to regenerate. */
const DATABASE_MODULE = "database";
const DB_ALIAS = "@db";
const DB_SCHEMA_FALLBACK = "packages/db/src/schema/";

// --- Phase 1: did anything move? -------------------------------------------------

/**
 * Where an installed module stands against its registry:
 *   current       — the ref still resolves to the SHA the lock recorded
 *   outdated      — the ref moved; there is an update to apply
 *   pinned        — the lock's `ref` is itself a SHA, so it is frozen by definition
 *   local         — installed from a working copy; nothing to re-resolve
 *   unresolvable  — no lock entry, or the source couldn't be reached
 */
export type UpdateStatus =
  "current" | "outdated" | "pinned" | "local" | "unresolvable";

export interface ModuleComparison {
  name: string;
  /** `owner/repo`, or `local`. */
  source: string;
  /** The ref that was resolved — the lock's, or `--ref`'s override. */
  ref: string;
  /** The SHA the lock records today. */
  current: string;
  /** The SHA the ref resolves to now; equal to `current` when nothing moved. */
  latest: string;
  status: UpdateStatus;
  /** Why, for everything that isn't a plain current/outdated — shown in the summary. */
  detail?: string;
  /**
   * `--ref` named a ref the lock isn't tracking, but it resolves to the SHA already
   * recorded — so there are no files to update and the lock's `ref` still has to move.
   * Without this a `--ref v2` onto a pin whose tag hasn't moved yet would report
   * "already at <sha7>" and silently leave the module pinned forever (criterion 3).
   */
  refRewrite?: boolean;
}

export interface CompareInstalledArgs {
  /** Modules to compare — `saasaloy.json`'s `installed`, or the one module named. */
  installed: string[];
  lock: Lockfile;
  /** Resolve a module's ref to a commit SHA. Rejecting marks the module unresolvable. */
  resolveRef: (name: string, entry: LockModule, ref: string) => Promise<string>;
  /** `--ref <ref>`: the explicit unpin. Only ever set alongside a single named module. */
  overrideRef?: string;
  /** True when SAASALOY_REGISTRY_DIR is set — a working copy replaces the registry. */
  registryOverride?: boolean;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

/** A 40-hex `ref` is a pin, not a moving target — the lock records where it points forever. */
function isSha(ref: string): boolean {
  return SHA_PATTERN.test(ref);
}

function short(sha: string): string {
  return isSha(sha) ? sha.slice(0, 7) : sha;
}

/**
 * Compare every installed module's lock entry against what its ref resolves to now.
 * Pure but for the injected `resolveRef`, so `outdated` (#50) can call it with the same
 * resolver and render a report instead of applying anything. Never throws: an
 * unreachable source becomes an `unresolvable` row so one dead repo can't block the rest
 * (decision 14).
 */
export async function compareInstalled(
  args: CompareInstalledArgs
): Promise<ModuleComparison[]> {
  const { installed, lock, resolveRef, overrideRef, registryOverride } = args;
  const out: ModuleComparison[] = [];

  for (const name of installed) {
    const entry = lock.modules[name];
    if (!entry) {
      out.push({
        name,
        source: "unknown",
        ref: "unknown",
        current: "unknown",
        latest: "unknown",
        status: "unresolvable",
        detail:
          "no lock entry — reinstall it with `saasaloy add` to record its provenance",
      });
      continue;
    }

    // A working copy has no commit identity, so there is no base and nothing to
    // re-resolve — the update re-applies whatever the checkout holds (decision 3).
    if (registryOverride) {
      out.push({
        name,
        source: "local",
        ref: "local",
        current: entry.resolved,
        latest: "local",
        status: "outdated",
        detail: "local install — no merge base",
      });
      continue;
    }

    if (entry.source === "local" || entry.resolved === "local") {
      out.push({
        name,
        source: entry.source,
        ref: entry.ref,
        current: entry.resolved,
        latest: entry.resolved,
        status: "local",
        detail:
          "installed from a working copy — set SAASALOY_REGISTRY_DIR to update it",
      });
      continue;
    }

    // Pinned by definition: the ref *is* the SHA, so re-resolving it can only return
    // itself. `--ref <branch|tag>` is the sanctioned way off it (decision 10).
    if (isSha(entry.ref) && !overrideRef) {
      out.push({
        name,
        source: entry.source,
        ref: entry.ref,
        current: entry.resolved,
        latest: entry.resolved,
        status: "pinned",
        detail: `pinned at ${short(entry.ref)} — nothing to update (use \`--ref <branch|tag>\` to move it)`,
      });
      continue;
    }

    const ref = overrideRef ?? entry.ref;
    try {
      const latest = await resolveRef(name, entry, ref);
      const status: UpdateStatus =
        latest === entry.resolved ? "current" : "outdated";
      out.push({
        name,
        source: entry.source,
        ref,
        current: entry.resolved,
        latest,
        status,
        // An `outdated` module rewrites `ref` as part of moving `resolved`; only a
        // `current` one needs the ref move called out on its own.
        ...(status === "current" && ref !== entry.ref
          ? { refRewrite: true }
          : {}),
      });
    } catch (error) {
      out.push({
        name,
        source: entry.source,
        ref,
        current: entry.resolved,
        latest: entry.resolved,
        status: "unresolvable",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return out;
}

/**
 * Move the lock's `ref` for modules whose ref changed but whose SHA didn't — the
 * `--ref <branch|tag>` unpin of a module the tag already points at. There is nothing to
 * apply, so no update plan is ever built for these; without this the unpin would be
 * dropped on the floor and the module would stay pinned (criterion 3). `resolved` is
 * untouched by construction: it already holds the SHA the new ref resolves to.
 * Returns the names actually rewritten.
 */
export function recordRefRewrites(
  lock: Lockfile,
  comparisons: ModuleComparison[]
): string[] {
  const rewritten: string[] = [];
  for (const comparison of comparisons) {
    if (!comparison.refRewrite) {
      continue;
    }
    const entry = lock.modules[comparison.name];
    // Same guard executeUpdatePlan uses: a comparison against a different source isn't
    // describing this entry's ref.
    if (
      !entry ||
      entry.ref === comparison.ref ||
      entry.source !== comparison.source
    ) {
      continue;
    }
    entry.ref = comparison.ref;
    rewritten.push(comparison.name);
  }
  return rewritten;
}

// --- Phase 2: classify every managed file three ways ------------------------------

/**
 * How a module file at the new SHA relates to base and to disk:
 *   skip           — base === theirs: the module didn't touch it, so neither do we,
 *                    drift or not (the single most important rule here)
 *   create         — the new version adds it and nothing occupies the path
 *   overwrite      — tracked and untouched since it was applied → safe deterministic write
 *   restore        — tracked but missing from disk → put it back (decision 6)
 *   unchanged      — disk already holds exactly what the new version ships
 *   drift          — tracked and hand-edited → merge plan, never written
 *   conflict       — the new version adds a file that already exists untracked → merge
 *                    plan, rendered two-way (decision 13)
 *   delete         — the new version dropped it and disk still matches → remove it
 *   delete-drift   — dropped upstream but hand-edited → keep it, say so (decision 5)
 *   delete-missing — dropped upstream and already gone → just untrack
 */
export type UpdateFileAction =
  | "skip"
  | "create"
  | "overwrite"
  | "restore"
  | "unchanged"
  | "drift"
  | "conflict"
  | "delete"
  | "delete-drift"
  | "delete-missing";

/** `remove`'s verdicts for a tracked file, said in `update`'s vocabulary (same classifier). */
const DELETE_ACTION: Record<FileRemoveAction, UpdateFileAction> = {
  delete: "delete",
  drift: "delete-drift",
  missing: "delete-missing",
};

/** Actions safe to write without a human in the loop (the clean path, spec §2.13). */
const WRITABLE: ReadonlySet<UpdateFileAction> = new Set<UpdateFileAction>([
  "create",
  "overwrite",
  "restore",
  "unchanged",
]);

/** Actions that route a file into the merge plan rather than to disk. */
const NEEDS_MERGE: ReadonlySet<UpdateFileAction> = new Set<UpdateFileAction>([
  "drift",
  "conflict",
  "delete-drift",
]);

export interface PlannedUpdateFile {
  module: string;
  /** Module-relative POSIX source path — the manifest's `from`. */
  from: string;
  /** Project-relative POSIX path (manifest key + display). */
  target: string;
  /** Absolute destination path, validated to sit inside the project root. */
  targetAbs: string;
  action: UpdateFileAction;
  /** Content at the lock's old SHA; absent when the module didn't ship it then, or there's no base. */
  base?: string;
  /** Content at the new SHA; absent when the new version dropped the file. */
  theirs?: string;
  /** Content on disk right now; absent when the file is missing. */
  mine?: string;
  /** sha256 of `theirs` — what the manifest records once written. */
  newHash?: string;
  /**
   * Modules whose config patches also wrote to this file. A patched file's manifest
   * hash is deliberately not re-recorded (the patch belongs to another module, see
   * applier.ts), so it classifies as drift on the next update — this says so, rather
   * than letting the merge plan imply a human edited it. `remove` reverses those patches
   * from the manifest record itself (#36); `update` still has no hash to compare against.
   */
  patchedBy?: string[];
}

/**
 * A config patch bound to a concrete target file, previewed. Identical to `add`'s
 * `PlannedPatch` because one helper builds both (#98): `apply` writes it, `unchanged` is
 * a no-op, `missing` has no target file, and `matched` is the collision that routes it
 * into the merge plan (decision 1).
 */
export type PlannedUpdatePatch = PlannedPatch;

/** A pin the module owns that moved between the two descriptor revisions (decision 8). */
export interface DepBump {
  name: string;
  from: string;
  to: string;
  /** True when the pin lives in package.json's `devDependencies` — the bucket it is rewritten in. */
  dev: boolean;
}

export interface ModuleUpdatePlan {
  name: string;
  comparison: ModuleComparison;
  /** Why there is no merge base, when there isn't one — stamped on the merge plan (decision 3). */
  noMergeBase?: string;
  /** Commit subjects touching the module between the two SHAs (decision 4); `[]` when unavailable. */
  intent: string[];
  /** Every file the new version ships, classified. */
  files: PlannedUpdateFile[];
  /** Every file the new version dropped, classified. */
  removals: PlannedUpdateFile[];
  links: PlannedLink[];
  patches: PlannedUpdatePatch[];
  depAdds: DepChange[];
  devDepAdds: DepChange[];
  depBumps: DepBump[];
  /** Human-readable version disagreements, in `planDeps`'s existing phrasing. */
  depConflicts: string[];
  /** New `dependsOn` prerequisites this version introduces (decision 11). */
  prereqNames: string[];
  /** An ordinary `add` plan for those prerequisites, executed under the same confirmation. */
  prereqPlan?: Plan;
  /** Each prerequisite's own `dependsOn`, so its lock entry stays self-describing. */
  prereqDependsOn: Record<string, string[]>;
  /** Each prerequisite's own `conflictsWith`, for the same reason. */
  prereqConflictsWith: Record<string, string[]>;
  /** The new version's own `dependsOn`, written into the lock entry. */
  dependsOn?: string[];
  /**
   * The new version's own `conflictsWith`, written into the lock entry. The descriptor is
   * gone once the update lands, so the lock is the only offline record of what this
   * module refuses to sit beside — drop it here and the next `add` stops refusing a
   * second driver (#98).
   */
  conflictsWith?: string[];
  /**
   * Env vars the new version requires that the old one did not — named before the
   * confirmation, or a version that starts requiring a secret updates in silence. With no
   * merge base there is nothing to diff against, so the whole set is reported.
   */
  newEnvVars: Record<string, string>;
  /** True when anything about this module routes to the merge plan. */
  needsMerge: boolean;
}

export interface UpdatePlan {
  modules: ModuleUpdatePlan[];
  /** Comparisons that won't be applied (current/pinned/local/unresolvable) — for the summary. */
  skipped: ModuleComparison[];
  /** Installed modules with no lock entry — reported, never fatal (mirrors remover.ts). */
  missingLockEntries: string[];
  /** Set when a db schema file moved and `database` is installed (decision 12). */
  migrationCommand?: string;
  /** Always `pnpm typecheck` — named, never executed (decision 16). */
  verifyCommand: string;
  /** True when any module needs a merge — i.e. a merge plan document is worth emitting. */
  needsMerge: boolean;
}

/** One module's two revisions plus everything the command learned while fetching them. */
export interface ModuleUpdateInput {
  comparison: ModuleComparison;
  /** The module as it exists at the new SHA. */
  theirs: LoadedModule;
  /** The module at the lock's old SHA; absent when the base can't be reached. */
  base?: LoadedModule;
  /** Why `base` is absent — `local install`, `force-pushed branch`, … (decision 3). */
  noMergeBase?: string;
  /** Commit subjects touching `modules/<name>/` between the two SHAs. */
  intent?: string[];
  /** Descriptors for prerequisites the new version introduces, topologically ordered. */
  prereqs?: { order: string[]; modules: Map<string, LoadedModule> };
}

export interface BuildUpdatePlanArgs {
  root: string;
  config: SaasaloyConfig;
  manifest: Manifest;
  lock: Lockfile;
  inputs: ModuleUpdateInput[];
  /** Modules this run considered; defaults to everything installed. Scopes `missingLockEntries`. */
  considered?: string[];
  /** Comparisons the command decided not to update — carried through for one summary. */
  skipped?: ModuleComparison[];
  /** The project root package.json, for dependency-pin bumping. */
  pkg?: PackageJson | null;
}

/** Modules that have applied a config patch to this file, per the manifest's record. */
function patchersOf(manifest: Manifest, target: string): string[] {
  return [
    ...new Set(
      manifest.patches.filter((p) => p.file === target).map((p) => p.module)
    ),
  ];
}

/** Aliases a module's scaffolds register — needed to resolve its own file targets. */
function scaffoldAliases(
  mod: LoadedModule | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const scaffold of mod?.item.scaffolds ?? []) {
    for (const [alias, prefix] of Object.entries(scaffold.aliases ?? {})) {
      out[alias] = prefix;
    }
  }
  return out;
}

export async function buildUpdatePlan(
  args: BuildUpdatePlanArgs
): Promise<UpdatePlan> {
  const { root, config, manifest, lock, inputs, pkg } = args;

  // Scoped to what this run looked at, so `update email` doesn't editorialize about an
  // unrelated module the base template registered without a lock entry.
  const missingLockEntries = (args.considered ?? config.installed).filter(
    (name) => !lock.modules[name]
  );
  const modules: ModuleUpdatePlan[] = [];
  const touched: string[] = [];

  for (const item of inputs) {
    const plan = await planOneModule({
      root,
      config,
      manifest,
      input: item,
      pkg: pkg ?? null,
    });
    modules.push(plan);
    for (const file of plan.files) {
      if (file.action !== "skip" && file.action !== "unchanged") {
        touched.push(file.target);
      }
    }
    for (const file of plan.removals) {
      if (file.action !== "delete-missing") {
        touched.push(file.target);
      }
    }
  }

  // Phase 5: name the migration command when a schema file moved. The `@db` alias is
  // where the database capability's scaffold actually put the schema; the literal is
  // only a fallback for a project whose alias map predates it.
  const schemaPrefix = config.aliases[DB_ALIAS]
    ? `${config.aliases[DB_ALIAS].replace(/\/$/, "")}/schema/`
    : DB_SCHEMA_FALLBACK;
  const migrationCommand =
    config.installed.includes(DATABASE_MODULE) &&
    touched.some((t) => t.startsWith(schemaPrefix))
      ? MIGRATION_COMMAND
      : undefined;

  return {
    modules,
    skipped: args.skipped ?? [],
    missingLockEntries,
    ...(migrationCommand ? { migrationCommand } : {}),
    verifyCommand: VERIFY_COMMAND,
    needsMerge: modules.some((m) => m.needsMerge),
  };
}

interface PlanOneArgs {
  root: string;
  config: SaasaloyConfig;
  manifest: Manifest;
  input: ModuleUpdateInput;
  pkg: PackageJson | null;
}

async function planOneModule(args: PlanOneArgs): Promise<ModuleUpdatePlan> {
  const { root, config, manifest, input, pkg } = args;
  const { theirs, base } = input;
  const name = theirs.item.name;

  // Resolve targets against the aliases that will exist once this run lands: the
  // project's own, plus any scaffold alias either revision (or a new prerequisite)
  // declares — otherwise a brand-new capability's files can't be placed.
  const prereqAliases: Record<string, string> = {};
  for (const prereqName of input.prereqs?.order ?? []) {
    Object.assign(
      prereqAliases,
      scaffoldAliases(input.prereqs?.modules.get(prereqName))
    );
  }
  const aliasView = {
    ...config.aliases,
    ...scaffoldAliases(base),
    ...prereqAliases,
    ...scaffoldAliases(theirs),
  };

  const theirsFiles = await listModuleFiles(theirs, aliasView);
  const baseFiles = base ? await listModuleFiles(base, aliasView) : undefined;

  const files: PlannedUpdateFile[] = [];
  for (const ref of theirsFiles.values()) {
    const theirsContent = await readFile(ref.abs, "utf-8");
    const baseRef = baseFiles?.get(ref.target);
    const baseContent = baseRef
      ? await readFile(baseRef.abs, "utf-8")
      : undefined;
    const targetAbs = resolveWithinRoot(root, ref.target);
    const managed = manifest.managed[ref.target];
    const owned = managed?.module === name ? managed : undefined;
    const mine = await readIfPresent(targetAbs);

    const action = classifyUpdate(
      baseContent,
      theirsContent,
      mine,
      owned?.hash
    );
    const patchedBy = patchersOf(manifest, ref.target);
    files.push({
      module: name,
      from: ref.from,
      target: ref.target,
      targetAbs,
      action,
      base: baseContent,
      theirs: theirsContent,
      mine,
      newHash: hashContent(theirsContent),
      ...(patchedBy.length > 0 ? { patchedBy } : {}),
    });
  }

  // Anything this module owns that the new version no longer ships. Derived from the
  // manifest rather than from base, so it stays right even with no merge base — the
  // manifest is the record of what we actually put there.
  const removals: PlannedUpdateFile[] = [];
  for (const [target, entry] of Object.entries(manifest.managed)) {
    if (entry.module !== name || theirsFiles.has(target)) {
      continue;
    }
    const targetAbs = resolveWithinRoot(root, target);
    const mine = await readIfPresent(targetAbs);
    const baseRef = baseFiles?.get(target);
    removals.push({
      module: name,
      from: entry.from ?? baseRef?.from ?? target,
      target,
      targetAbs,
      action: DELETE_ACTION[classifyTrackedFile(mine, entry.hash)],
      base: baseRef ? await readFile(baseRef.abs, "utf-8") : undefined,
      mine,
    });
  }

  const links = await planLinks(root, theirs);
  const patches = await planPatches(
    root,
    name,
    theirs.item.patches ?? [],
    files
  );
  const deps = planDepChanges(base, theirs, pkg);

  // A `dependsOn` the new version introduces is folded into this same plan rather than
  // left for the user to install by hand (decision 11).
  let prereqPlan: Plan | undefined;
  const prereqDependsOn: Record<string, string[]> = {};
  const prereqConflictsWith: Record<string, string[]> = {};
  const prereqNames = (input.prereqs?.order ?? []).filter(
    (n) => !config.installed.includes(n)
  );
  if (prereqNames.length > 0 && input.prereqs) {
    prereqPlan = await buildPlan({
      root,
      install: prereqNames,
      alreadyInstalled: [],
      modules: input.prereqs.modules,
      config,
      manifest,
    });
    for (const prereq of prereqNames) {
      const prereqItem = input.prereqs.modules.get(prereq)?.item;
      const dependsOn = prereqItem?.dependsOn;
      if (dependsOn && dependsOn.length > 0) {
        prereqDependsOn[prereq] = dependsOn;
      }
      const conflictsWith = prereqItem?.conflictsWith;
      if (conflictsWith && conflictsWith.length > 0) {
        prereqConflictsWith[prereq] = conflictsWith;
      }
    }
  }

  const needsMerge =
    files.some((f) => NEEDS_MERGE.has(f.action)) ||
    removals.some((f) => NEEDS_MERGE.has(f.action)) ||
    patches.some((p) => p.matched !== undefined);

  return {
    name,
    comparison: input.comparison,
    ...(input.noMergeBase ? { noMergeBase: input.noMergeBase } : {}),
    intent: input.intent ?? [],
    files,
    removals,
    links,
    patches,
    ...deps,
    prereqNames,
    ...(prereqPlan ? { prereqPlan } : {}),
    prereqDependsOn,
    prereqConflictsWith,
    ...(theirs.item.dependsOn && theirs.item.dependsOn.length > 0
      ? { dependsOn: theirs.item.dependsOn }
      : {}),
    ...(theirs.item.conflictsWith && theirs.item.conflictsWith.length > 0
      ? { conflictsWith: theirs.item.conflictsWith }
      : {}),
    newEnvVars: newEnvVars(base, theirs),
    needsMerge,
  };
}

/**
 * Env vars `theirs` requires that `base` did not. `base` absent means the run has no
 * merge base at all (a local install, a force-pushed branch), so nothing can be called
 * old — the whole set is returned rather than staying quiet about a secret the project
 * may now need.
 */
function newEnvVars(
  base: LoadedModule | undefined,
  theirs: LoadedModule
): Record<string, string> {
  const known = new Set(Object.keys(base?.item.envVars ?? {}));
  const out: Record<string, string> = {};
  for (const [key, description] of Object.entries(theirs.item.envVars ?? {})) {
    if (base && known.has(key)) {
      continue;
    }
    out[key] = description;
  }
  return out;
}

/**
 * The three-way verdict for one file. `base === theirs` short-circuits everything: the
 * module didn't touch this file, so whatever the user did to it is none of our business
 * (the rule that keeps `update` from re-proposing every hand-edit forever).
 */
function classifyUpdate(
  base: string | undefined,
  theirs: string,
  mine: string | undefined,
  managedHash: string | undefined
): UpdateFileAction {
  if (base !== undefined && base === theirs) {
    return "skip";
  }
  if (mine === undefined) {
    return managedHash === undefined ? "create" : "restore";
  }
  if (mine === theirs) {
    return "unchanged";
  }
  if (managedHash === undefined) {
    return "conflict";
  }
  return hashContent(mine) === managedHash ? "overwrite" : "drift";
}

async function planLinks(
  root: string,
  theirs: LoadedModule
): Promise<PlannedLink[]> {
  const links: PlannedLink[] = [];
  for (const skillRel of theirs.item.agent?.skills ?? []) {
    const folderName = posix.basename(skillRel);
    const path = posix.join(".claude/skills", folderName);
    const target = posix.join(".agents/skills", folderName);
    const pathAbs = resolveWithinRoot(root, path);
    const targetAbs = resolveWithinRoot(root, target);
    const state = await classifyLink(pathAbs, targetAbs);
    const action: LinkAction =
      state === "missing"
        ? "create"
        : state === "correct"
          ? "exists"
          : "conflict";
    links.push({
      module: theirs.item.name,
      path,
      pathAbs,
      target,
      targetAbs,
      action,
    });
  }
  return links;
}

/**
 * Re-apply each of the new version's patches, idempotently, against the content this run
 * will leave behind — so a patch aimed at a file the same update rewrites reads the new
 * bytes. `previewPatches` is the same helper `buildPlan` uses (#98). The interesting
 * outcome is `matched`: the patch is a no-op *because* its identity already holds a
 * different value — the user edited what we would have written — which routes it to the
 * merge plan as prose rather than silently doing nothing (decision 1).
 */
function planPatches(
  root: string,
  module: string,
  ops: RegistryPatch[],
  files: PlannedUpdateFile[]
): Promise<PlannedUpdatePatch[]> {
  return previewPatches({
    root,
    module,
    ops,
    planned: new Map(
      files.map((f) => [
        f.target,
        { content: f.theirs, landsOnDisk: WRITABLE.has(f.action) },
      ])
    ),
  });
}

interface PlannedDeps {
  depAdds: DepChange[];
  devDepAdds: DepChange[];
  depBumps: DepBump[];
  depConflicts: string[];
}

/** `name -> version` for one descriptor revision, per bucket. */
function pinsOf(
  mod: LoadedModule | undefined,
  dev: boolean
): Map<string, string> {
  const specs =
    (dev ? mod?.item.devDependencies : mod?.item.dependencies) ?? [];
  return new Map(
    specs.map((spec) => [parseDep(spec).name, parseDep(spec).version])
  );
}

/**
 * A pin moves only when the module owns it *and* the user hasn't overridden it: base's
 * descriptor says which pins the module moved, and the current package.json still
 * matching base's value proves nobody edited it since (decision 8). Anything else keeps
 * `planDeps`'s existing conflict warning rather than clobbering a deliberate override.
 */
function planDepChanges(
  base: LoadedModule | undefined,
  theirs: LoadedModule,
  pkg: PackageJson | null
): PlannedDeps {
  const depAdds: DepChange[] = [];
  const devDepAdds: DepChange[] = [];
  const depBumps: DepBump[] = [];
  const depConflicts: string[] = [];
  if (!pkg) {
    return { depAdds, devDepAdds, depBumps, depConflicts };
  }

  for (const dev of [false, true]) {
    const bucket = dev ? (pkg.devDependencies ?? {}) : (pkg.dependencies ?? {});
    const otherBucket = dev
      ? (pkg.dependencies ?? {})
      : (pkg.devDependencies ?? {});
    const basePins = pinsOf(base, dev);

    for (const [name, wanted] of pinsOf(theirs, dev)) {
      // The pin may sit in the *other* bucket — the user moved it, or an earlier version
      // of the descriptor declared it there. Bump it where it actually lives: writing it
      // into the bucket this descriptor declares would leave the stale pin behind and
      // package.json would carry the same package at two versions.
      const inDeclaredBucket = bucket[name] !== undefined;
      const current = inDeclaredBucket ? bucket[name] : otherBucket[name];
      if (current === undefined) {
        (dev ? devDepAdds : depAdds).push({ name, version: wanted });
        continue;
      }
      if (current === wanted) {
        continue;
      }

      const basePin = basePins.get(name);
      if (basePin !== undefined && basePin !== wanted && current === basePin) {
        depBumps.push({
          name,
          from: current,
          to: wanted,
          dev: inDeclaredBucket ? dev : !dev,
        });
      } else {
        depConflicts.push(
          `${name}: package.json already has ${current}, ignoring ${wanted}`
        );
      }
    }
  }
  return { depAdds, devDepAdds, depBumps, depConflicts };
}

// --- Phase 3: apply the clean path ------------------------------------------------

export interface ExecuteUpdateArgs {
  root: string;
  config: SaasaloyConfig;
  manifest: Manifest;
  lock: Lockfile;
  /** The root package.json, when dependency pins are being written. */
  pkg?: PackageJson | null;
}

export interface UpdateResult {
  /** Files actually written (create/overwrite/restore). */
  written: PlannedUpdateFile[];
  /** Files already byte-identical to the new version — manifest refreshed, disk untouched. */
  refreshed: PlannedUpdateFile[];
  /** Planned-writable files edited between planning and the write — left alone. */
  lateDrift: PlannedUpdateFile[];
  /** Files deleted because the new version dropped them and disk still matched. */
  deleted: PlannedUpdateFile[];
  /** Dropped-upstream files kept because they were hand-edited — now the user's. */
  driftSurvivors: PlannedUpdateFile[];
  /** Manifest entries dropped for files that were already gone. */
  untracked: PlannedUpdateFile[];
  patched: PlannedUpdatePatch[];
  /** Patches whose target file was absent — reported, not applied. */
  patchConflicts: PlannedUpdatePatch[];
  links: PlannedLink[];
  linkConflicts: PlannedLink[];
  /** Prerequisites installed as part of the same confirmed plan. */
  prereqsInstalled: string[];
  /** Modules whose lock entry moved to the new SHA (those that fully applied). */
  lockMoved: string[];
  /** Modules whose lock `ref` was rewritten by `--ref` while `resolved` stayed put. */
  refsRecorded: string[];
  /** Dependency pins actually written into package.json. */
  depsWritten: DepChange[];
}

/**
 * Whether a planned file still looks the way it did when the plan was built. The
 * confirmation prompt (and, for a bare `update`, a long fetch) sits between the two, so
 * the verdict is re-earned immediately before the write — the same reason remover.ts
 * re-checks before deleting.
 */
async function stillMatches(file: PlannedUpdateFile): Promise<boolean> {
  const now = await readIfPresent(file.targetAbs);
  return now === file.mine;
}

export async function executeUpdatePlan(
  plan: UpdatePlan,
  args: ExecuteUpdateArgs
): Promise<UpdateResult> {
  const { root, config, manifest, lock } = args;
  const result: UpdateResult = {
    written: [],
    refreshed: [],
    lateDrift: [],
    deleted: [],
    driftSurvivors: [],
    untracked: [],
    patched: [],
    patchConflicts: [],
    links: [],
    linkConflicts: [],
    prereqsInstalled: [],
    lockMoved: [],
    refsRecorded: [],
    depsWritten: [],
  };

  const bumpsAsDeps: DepChange[] = [];
  const devBumpsAsDeps: DepChange[] = [];

  for (const mod of plan.modules) {
    // Prerequisites first: a new capability may scaffold the very alias this module's
    // files resolve against, and `executePlan` registers those aliases as it goes.
    if (mod.prereqPlan) {
      await executePlan(mod.prereqPlan, root, config, manifest);
      result.prereqsInstalled.push(...mod.prereqPlan.install);
    }

    let clean = !mod.needsMerge;

    for (const file of mod.files) {
      if (!WRITABLE.has(file.action) || file.theirs === undefined) {
        continue;
      }
      if (!(await stillMatches(file))) {
        result.lateDrift.push(file);
        clean = false;
        continue;
      }
      // `unchanged` means disk already holds these exact bytes, so rewriting it would
      // churn the file's mtime for nothing. Its manifest entry is still refreshed —
      // that is how a file installed before `from` existed acquires one.
      if (file.action === "unchanged") {
        result.refreshed.push(file);
      } else {
        await mkdir(dirname(file.targetAbs), { recursive: true });
        await writeFile(file.targetAbs, file.theirs, "utf-8");
        result.written.push(file);
      }
      manifest.managed[file.target] = {
        module: file.module,
        hash: file.newHash ?? hashContent(file.theirs),
        from: file.from,
      };
    }

    for (const file of mod.removals) {
      if (file.action === "delete") {
        if (await stillMatches(file)) {
          await rmPath(file.targetAbs, { force: true });
          result.deleted.push(file);
        } else {
          // Edited while the confirmation was up — the delete was authorized for
          // different bytes, so it doesn't authorize removing these.
          result.driftSurvivors.push(file);
          clean = false;
        }
      } else if (file.action === "delete-drift") {
        result.driftSurvivors.push(file);
      } else {
        result.untracked.push(file);
      }
      // Untrack in every case: the new version no longer ships this file, so a survivor
      // becomes plain user-owned content rather than something `update` keeps offering
      // to delete on every run.
      delete manifest.managed[file.target];
    }

    for (const p of mod.patches) {
      if (!(await pathExists(p.fileAbs))) {
        result.patchConflicts.push(p);
        clean = false;
        continue;
      }
      // Re-apply against fresh disk state, never the preview — the engine is idempotent,
      // so a patch that already landed is a clean no-op.
      const source = await readFile(p.fileAbs, "utf-8");
      const { content, changed } = applyPatch(source, p.patch, p.file);
      if (!changed) {
        continue;
      }
      await writeFile(p.fileAbs, content, "utf-8");
      result.patched.push(p);
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
    }

    for (const link of mod.links) {
      if (link.action === "conflict") {
        result.linkConflicts.push(link);
        continue;
      }
      if (link.action === "create") {
        await createDirLink(link.pathAbs, link.targetAbs);
      }
      manifest.links[link.target] = link.path;
      result.links.push(link);
    }

    for (const bump of mod.depBumps) {
      (bump.dev ? devBumpsAsDeps : bumpsAsDeps).push({
        name: bump.name,
        version: bump.to,
      });
    }

    // Move `resolved` only for a module that fully landed. While anything still needs
    // merging, the *old* SHA is the only merge base a re-run has — advancing it would
    // strand the drifted files with nothing to diff against (decision 15's boundary).
    if (clean && mod.comparison.latest !== mod.comparison.current) {
      lock.modules[mod.name] = {
        source: mod.comparison.source,
        ref: mod.comparison.ref,
        resolved: mod.comparison.latest,
        ...(mod.dependsOn ? { dependsOn: mod.dependsOn } : {}),
        ...(mod.conflictsWith ? { conflictsWith: mod.conflictsWith } : {}),
      };
      result.lockMoved.push(mod.name);
    } else {
      // `ref` is intent ("track this branch") and `resolved` is fact ("these bytes are
      // on disk"), so an explicit `--ref` unpin is recorded even when files are still
      // out for merge — otherwise the user would have to repeat `--ref` on the re-run
      // the merge plan tells them to do (decision 10).
      const entry = lock.modules[mod.name];
      if (
        entry &&
        entry.ref !== mod.comparison.ref &&
        mod.comparison.source === entry.source
      ) {
        entry.ref = mod.comparison.ref;
        result.refsRecorded.push(mod.name);
      }
    }
    // A prerequisite installed here is pinned to the same SHA as the module that needs it.
    for (const prereq of mod.prereqPlan?.install ?? []) {
      const dependsOn = mod.prereqDependsOn[prereq];
      const conflictsWith = mod.prereqConflictsWith[prereq];
      lock.modules[prereq] = {
        source: mod.comparison.source,
        ref: mod.comparison.ref,
        resolved: mod.comparison.latest,
        ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
        ...(conflictsWith && conflictsWith.length > 0 ? { conflictsWith } : {}),
      };
    }
  }

  const pkg = args.pkg;
  const allAdds = plan.modules.flatMap((m) => m.depAdds);
  const allDevAdds = plan.modules.flatMap((m) => m.devDepAdds);
  if (
    pkg &&
    (allAdds.length > 0 ||
      allDevAdds.length > 0 ||
      bumpsAsDeps.length > 0 ||
      devBumpsAsDeps.length > 0)
  ) {
    const added = [...allAdds, ...bumpsAsDeps];
    const devAdded = [...allDevAdds, ...devBumpsAsDeps];
    // `writeDeps` merges by key, so an existing pin is rewritten in place — which is
    // exactly what a bump is.
    await writeDeps(root, pkg, added, devAdded);
    result.depsWritten = [...added, ...devAdded];
  }

  return result;
}
