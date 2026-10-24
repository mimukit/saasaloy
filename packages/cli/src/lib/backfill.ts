import { isAbsolute, resolve } from "node:path";
import { buildPlan, executePlan } from "./applier.js";
import type { ApplyResult, Plan } from "./applier.js";
import { persistLedger } from "./ledger.js";
import type { Lockfile, LockModule } from "./lock.js";
import type { Manifest } from "./manifest.js";
import {
  LocalRegistrySource,
  REGISTRY_ENV,
  RemoteRegistrySource,
} from "./registry.js";
import type { LoadedModule, RegistrySource } from "./registry.js";
import type { LoadedConfig } from "./saasaloy-config.js";
import type { TestingMode } from "./testing.js";
import { isPatchTracked } from "./when.js";

// Backfill (#242, ADR 0054): write every gated entry of an installed module whose `when`
// is now true and whose target the manifest does not track yet. A mode turned on, or a
// module that a `when.installed` names arriving, makes entries true that were false when
// their module landed; nothing else would ever write them.
//
// It is `buildPlan` with a selector, so the collision, ownership and conflict rules of
// `add` apply unchanged: an untracked file the owner wrote at a target is held back for
// a merge, never overwritten. It reads each module at the SHA the lock records, so the
// files it writes match the rest of that module on disk, and it never moves the lock.
// `saasaloy testing <on-mode>`, `add` and `update` call it, and a re-run picks up what a
// partial run left (ADR 0031).

/** Where one installed module is read from for a backfill. */
export type ModuleOrigin =
  | { kind: "local"; dir: string }
  | { kind: "remote"; owner: string; repo: string; sha: string }
  | { kind: "skip"; reason: string };

/**
 * The origin of `name` for a backfill. A working-copy override reads that copy, the same
 * rule `add` and `update` follow. Otherwise the module is read at its lock `resolved` SHA
 * from its lock `source`. A module installed from a working copy has no SHA to read, so
 * it is skipped with a reason rather than refused (A6), as `update` skips it.
 */
export function originFor(
  name: string,
  entry: LockModule | undefined,
  env: NodeJS.ProcessEnv = process.env
): ModuleOrigin {
  const override = env[REGISTRY_ENV];
  if (override) {
    return {
      dir: isAbsolute(override) ? override : resolve(process.cwd(), override),
      kind: "local",
    };
  }
  if (!entry) {
    return {
      kind: "skip",
      reason: `${name} has no lock entry, so there is no commit to read it at`,
    };
  }
  if (entry.resolved === "local") {
    return {
      kind: "skip",
      reason: `${name} was installed from a working copy — set ${REGISTRY_ENV} to backfill it`,
    };
  }
  const [owner, repo, ...rest] = entry.source.split("/");
  if (!owner || !repo || rest.length > 0) {
    return {
      kind: "skip",
      reason: `${name}'s lock source "${entry.source}" isn't an owner/repo coordinate`,
    };
  }
  return { kind: "remote", owner, repo, sha: entry.resolved };
}

/** Opens a source for an origin; `planBackfill` takes one so a test can stay offline. */
export type SourceOpener = (
  origin: Exclude<ModuleOrigin, { kind: "skip" }>
) => RegistrySource;

const openSource: SourceOpener = (origin) =>
  origin.kind === "local"
    ? new LocalRegistrySource(origin.dir)
    : new RemoteRegistrySource(origin.owner, origin.repo, origin.sha);

export interface BackfillArgs {
  root: string;
  config: LoadedConfig;
  manifest: Manifest;
  lock: Lockfile;
  /** Installed modules to leave out: the ones this run just applied in the current mode. */
  exclude?: ReadonlySet<string>;
  /** Defaults to the project's own mode. */
  testingMode?: TestingMode;
  /**
   * Write only these project-relative paths: a file target, or a patch's file. `update`
   * passes the targets it showed and backed up before the confirmation, so the backfill
   * it runs after its own apply writes nothing the approval and the backup did not cover.
   */
  within?: ReadonlySet<string>;
  env?: NodeJS.ProcessEnv;
  open?: SourceOpener;
}

/** An installed module the backfill could not read, and why. */
export interface BackfillSkip {
  module: string;
  reason: string;
}

export interface BackfillPlan {
  /** The plan to execute; `install` names only modules with an entry to write. */
  plan: Plan;
  skipped: BackfillSkip[];
  /** Drops the temp dirs a remote source fetched into. Call it once the plan has run. */
  cleanup: () => Promise<void>;
}

/** Every project-relative path a backfill plan would write: file targets and patched files. */
export function backfillTargets(plan: Plan): string[] {
  return [
    ...new Set([
      ...plan.files.map((f) => f.target),
      ...plan.patches.map((p) => p.file),
    ]),
  ].toSorted();
}

/** True when a backfill plan has nothing to write. */
export function isEmptyBackfill(plan: Plan): boolean {
  return plan.files.length === 0 && plan.patches.length === 0;
}

/**
 * Plan a backfill over every installed module. Pure with respect to the project: it
 * reads the descriptors and the disk and writes nothing, so `update --dry-run` can list
 * what a real run would write.
 */
export async function planBackfill(args: BackfillArgs): Promise<BackfillPlan> {
  const { root, config, manifest, lock } = args;
  const open = args.open ?? openSource;
  const sources = new Map<string, RegistrySource>();
  const cleanup = async (): Promise<void> => {
    await Promise.all(
      [...sources.values()].map(async (source) => {
        await source.cleanup?.();
      })
    );
  };

  const modules = new Map<string, LoadedModule>();
  const skipped: BackfillSkip[] = [];
  for (const name of config.installed) {
    if (args.exclude?.has(name)) {
      continue;
    }
    const origin = originFor(name, lock.modules[name], args.env);
    if (origin.kind === "skip") {
      skipped.push({ module: name, reason: origin.reason });
      continue;
    }
    // One source per origin, so every module pinned to one SHA shares one resolution.
    const key =
      origin.kind === "local"
        ? origin.dir
        : `${origin.owner}/${origin.repo}@${origin.sha}`;
    let source = sources.get(key);
    if (!source) {
      source = open(origin);
      sources.set(key, source);
    }
    try {
      modules.set(name, await source.readModule(name));
    } catch (error) {
      // One unreadable module must not cost the others their backfill; the next run
      // tries it again.
      skipped.push({
        module: name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const install = [...modules.keys()];
  const plan = await buildPlan({
    alreadyInstalled: [],
    config,
    install,
    manifest,
    modules,
    root,
    select: {
      // Only gated entries: an unconditional one either landed with its module or was
      // left for `update` to restore. And only an untracked target: a tracked one is
      // already managed, whatever its `when` says now (#242 Q1).
      file: (_module, ref) =>
        ref.when !== undefined &&
        manifest.managed[ref.target] === undefined &&
        (args.within?.has(ref.target) ?? true),
      patch: (module, op) =>
        op.when !== undefined &&
        !isPatchTracked(
          manifest,
          module,
          op,
          modules.get(module)?.item.patches
        ) &&
        (args.within?.has(op.file) ?? true),
    },
    ...(args.testingMode === undefined
      ? {}
      : { testingMode: args.testingMode }),
  });
  // Only the modules with work, so `executePlan` rewrites no other module's warnings.
  const working = new Set([
    ...plan.files.map((f) => f.module),
    ...plan.patches.map((p) => p.module),
  ]);
  plan.install = install.filter((name) => working.has(name));
  return { cleanup, plan, skipped };
}

export interface BackfillOutcome {
  plan: Plan;
  /** Absent when the plan was empty and nothing ran. */
  result?: ApplyResult;
  skipped: BackfillSkip[];
}

/**
 * Plan and run a backfill, then write the ledger. The ledger is written even when the
 * apply throws, so it describes what landed, and a re-run finishes the job (ADR 0031).
 * The lock is written as it was loaded: a backfill reads at the locked SHA, it moves
 * nothing.
 */
export async function runBackfill(
  args: BackfillArgs
): Promise<BackfillOutcome> {
  const { root, config, manifest, lock } = args;
  const planned = await planBackfill(args);
  try {
    if (isEmptyBackfill(planned.plan)) {
      return { plan: planned.plan, skipped: planned.skipped };
    }
    // The apply error wins over a save error, as in `add`: it is what stopped the run.
    let result: ApplyResult | undefined;
    let applyFailed = false;
    let applyError: unknown;
    try {
      result = await executePlan(planned.plan, root, config, manifest);
    } catch (error) {
      applyFailed = true;
      applyError = error;
    }
    const failures = await persistLedger({ config, lock, manifest, root });
    if (applyFailed) {
      throw applyError;
    }
    const failed = failures[0];
    if (failed) {
      throw failed.error;
    }
    return { plan: planned.plan, result, skipped: planned.skipped };
  } finally {
    await planned.cleanup();
  }
}
