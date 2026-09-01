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
 * reads the same on every run. A target three unrelated modules claim reports two pairs,
 * each naming the earlier claimant, because each pair is its own decision to fix.
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
