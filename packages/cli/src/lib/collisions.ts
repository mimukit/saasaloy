import type { LoadedModule } from "./registry.js";

// Cross-module file collisions for `saasaloy add` — the deterministic core, kept beside
// conflicts.ts and out of applier.ts's planning loop so it can be unit-tested.
//
// Two modules in one run may legitimately write the same target: `database` scaffolds
// `packages/db/tsconfig.json` and its driver `database-d1` scaffolds a more specific one
// over it, which is why buildPlan plans one entry per target and lets the last planner win
// (#98). Two unrelated modules picking the same target is the opposite case: nothing says
// which copy the user wanted, and the silent overwrite is a data-loss bug (#91).
//
// The rule that separates them is `dependsOn`. An overlap is legal when one of the two
// modules reaches the other through `dependsOn`, because that edge is the author saying
// "I am built on top of that module and I know what it ships". Everything else is refused.
// No new descriptor field: `dependsOn` is the declaration (plan decision Q4).
//
// A collision is reported, never resolved. `buildPlan` raises one RefusalError naming
// every contested path, before it plans a single write.

export interface FileCollision {
  /** Project-relative POSIX path both modules plan to write. */
  target: string;
  /** The module that claimed the target first — earlier in the run's install order. */
  module: string;
  /** The later module claiming the same target. */
  other: string;
}

/**
 * One file already on disk that a module in this run wants to write, and the installed
 * module `.saasaloy/manifest.json` says owns it. `classify` reports the pair; the rule
 * below decides whether the claimant may take it (#91 phase 2).
 */
export interface OwnedCollision {
  /** Project-relative POSIX path of the contested file. */
  target: string;
  /** The installed module that applied the file, per `manifest.managed[target].module`. */
  owner: string;
  /** The module this run would have overwrite it. */
  claimant: string;
}

/** One module's planned targets, as `listModuleFiles` enumerates them. */
export interface ModuleTargets {
  module: string;
  /** Project-relative POSIX targets — `files[]`, `scaffolds[].files[]` and skills alike. */
  targets: readonly string[];
}

export interface DetectCollisionsArgs {
  /** Every module in this run with its planned targets, in install (topological) order. */
  planned: readonly ModuleTargets[];
  /**
   * Every descriptor this run resolved, keyed by name — the map `buildPlan` already
   * receives. Reachability is read off `dependsOn` here rather than off a `Graph`,
   * because `BuildPlanArgs` carries no graph.
   */
  modules: ReadonlyMap<string, LoadedModule>;
}

/** True when `from` reaches `to` by following `dependsOn`, at any depth. */
function reaches(
  from: string,
  to: string,
  modules: ReadonlyMap<string, LoadedModule>
): boolean {
  const seen = new Set<string>([from]);
  const stack: string[] = [from];
  while (stack.length > 0) {
    const name = stack.pop() ?? "";
    for (const dep of modules.get(name)?.item.dependsOn ?? []) {
      if (dep === to) {
        return true;
      }
      // A name with no descriptor in this map ends the walk there rather than throwing:
      // resolveGraph visits every `dependsOn` recursively, so a gap means a caller built
      // a partial map, and a missing edge can only make the check stricter.
      if (!seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  return false;
}

/**
 * True when these two modules may share a target: one of them declares the other in
 * `dependsOn`, directly or transitively. The relation is checked both ways — the driver
 * usually depends on the capability, but either side may be the one that declares it.
 */
export function mayShareTarget(
  a: string,
  b: string,
  modules: ReadonlyMap<string, LoadedModule>
): boolean {
  return a === b || reaches(a, b, modules) || reaches(b, a, modules);
}

/**
 * Every illegal same-run overlap, in install order and then target order, so the refusal
 * reads the same on every run. Each claimant of a target reports one pair per earlier
 * claimant, so three unrelated modules on one target report three pairs, because each
 * pair is its own decision to fix.
 */
export function detectCollisions(args: DetectCollisionsArgs): FileCollision[] {
  const { planned, modules } = args;
  const claimants = new Map<string, string[]>();
  const collisions: FileCollision[] = [];

  for (const { module, targets } of planned) {
    for (const target of targets) {
      const prior = claimants.get(target);
      if (!prior) {
        claimants.set(target, [module]);
        continue;
      }
      for (const other of prior) {
        if (!mayShareTarget(module, other, modules)) {
          collisions.push({ target, module: other, other: module });
        }
      }
      prior.push(module);
    }
  }

  return collisions;
}

// One collision as a sentence: both module names, the contested path, and the two ways
// out. `conflictsWith` is named because a deliberate either-or pair is the case this
// refusal must not stand in the way of.
function describe(collision: FileCollision): string {
  const { target, module, other } = collision;
  return (
    `${module} and ${other} both write ${target}, and neither declares the other in \`dependsOn\`. ` +
    `Give one of them a different target, or declare \`conflictsWith\` between them if they are deliberately exclusive.`
  );
}

/** The refusal `add` prints. One line per contested path, under a heading. */
export function formatCollisions(
  collisions: FileCollision[],
  /** What the user asked for; a caller planning a set with no single request omits it. */
  requested = "these modules"
): string {
  const heading = `Cannot add ${requested} — file collision${collisions.length > 1 ? "s" : ""}:`;
  return [heading, ...collisions.map((c) => `  ${describe(c)}`)].join("\n");
}

/**
 * Every claim on an installed file that crosses module ownership illegally, in the order
 * `buildPlan` classified them. The rule is `mayShareTarget`, the same one the same-run
 * check uses: a module may take a file owned by a module it reaches through `dependsOn`,
 * and nothing else (plan decision Q4).
 *
 * The relation stays symmetric here, as it is in the same-run case. `add database --force`
 * on a project where `database-d1` took over `packages/db/tsconfig.json` is the capability
 * rewriting its own driver's file, and refusing it would tell the user to remove a driver
 * that depends on the very module being installed.
 *
 * An owner with no descriptor in `modules` reads as unrelated, which refuses the claim.
 * That is the safe answer: the run resolved every module it could reach, so an owner it
 * never saw is one nothing in this run depends on.
 */
export function detectOwnedCollisions(
  claims: readonly OwnedCollision[],
  modules: ReadonlyMap<string, LoadedModule>
): OwnedCollision[] {
  return claims.filter(
    (claim) => !mayShareTarget(claim.claimant, claim.owner, modules)
  );
}

// One owned-file claim as a sentence. `--force` is named because it is the flag a user
// reaches for next, and it deliberately does not cross ownership — `remove` does, because
// it is the one path that leaves the manifest consistent (plan decision Q3).
function describeOwned(collision: OwnedCollision): string {
  const { target, owner, claimant } = collision;
  return (
    `${owner} owns ${target}, and ${claimant} does not declare it in \`dependsOn\`. ` +
    `\`--force\` does not cross module file ownership: run \`saasaloy remove ${owner}\` first.`
  );
}

/**
 * One stale-ownership note as a sentence. The file is gone, so nothing is refused: the
 * claim is legal and the run continues. What is left behind is an installed module that
 * no longer owns the file it applied, and only `remove` clears that (#107).
 */
export function describeStaleOwner(collision: OwnedCollision): string {
  const { target, owner, claimant } = collision;
  return (
    `${owner} still owns ${target} in the manifest, but the file is gone — ${claimant} now writes it. ` +
    `Run \`saasaloy remove ${owner}\` to drop the stale module.`
  );
}

/** The refusal `add` prints for files another installed module owns. */
export function formatOwnedCollisions(
  collisions: OwnedCollision[],
  /** What the user asked for; a caller planning a set with no single request omits it. */
  requested = "these modules"
): string {
  const noun = collisions.length > 1 ? "files" : "file";
  const heading = `Cannot add ${requested} — ${noun} owned by another module:`;
  return [heading, ...collisions.map((c) => `  ${describeOwned(c)}`)].join(
    "\n"
  );
}
