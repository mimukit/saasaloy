import { RefusalError } from "./exit.js";
import { UnknownModuleError } from "./registry.js";
import type { LoadedModule, RegistrySource } from "./registry.js";

// Recursive `dependsOn` resolution, topologically sorted so prerequisites are applied
// before the modules that need them (build spec §2.7). A depth-first post-order walk
// yields that order and catches dependency cycles along the way. Dependencies resolve
// intra-repo: a bare `dependsOn` name is a sibling in the same registry source (ADR 0012;
// cross-repo `owner/repo#module` is a follow-up, #26).

export interface Graph {
  /** Topological order: every module appears after the modules it dependsOn; requested is last. */
  order: string[];
  /** Every descriptor touched during resolution, keyed by name. */
  modules: Map<string, LoadedModule>;
}

export async function resolveGraph(
  source: RegistrySource,
  requested: string
): Promise<Graph> {
  const { modules, order } = await resolveGraphs(source, [requested]);
  return { modules, order };
}

/** A graph resolved from several named roots (#233). */
export interface RootedGraph extends Graph {
  /**
   * Each module in the graph mapped to the named root that pulled it in: the first root
   * in argv order whose walk reached it. A root maps to itself, unless an earlier root
   * already pulled it in as a prerequisite.
   */
  rootOf: Map<string, string>;
}

/**
 * Resolve several named roots into one graph, in one walk.
 *
 * The walk is the same depth-first post-order `resolveGraph` runs, with the visited set
 * shared across roots: every prerequisite lands ahead of the module that needs it, and
 * between independent roots argv order decides, so the same command always plans the
 * same order. A name that repeats, or that an earlier root already pulled in, is visited
 * once and adds nothing.
 *
 * Every named root is read before this returns, so a run that names two modules the
 * registry lacks hears about both at once. One unknown name keeps the registry's own
 * message; two or more refuse with one message naming each. An unknown *prerequisite*
 * is not collected: its message says which module required it, and it throws as before.
 */
export async function resolveGraphs(
  source: RegistrySource,
  roots: readonly string[]
): Promise<RootedGraph> {
  const modules = new Map<string, LoadedModule>();
  const order: string[] = [];
  const rootOf = new Map<string, string>();
  const done = new Set<string>();
  const onPath = new Set<string>(); // names currently on the DFS stack — a revisit is a cycle
  const stack: string[] = [];

  async function visit(
    name: string,
    root: string,
    requiredBy?: string
  ): Promise<void> {
    if (done.has(name)) {
      return;
    }
    if (onPath.has(name)) {
      const cycle = [...stack.slice(stack.indexOf(name)), name].join(" → ");
      throw new Error(`Dependency cycle detected: ${cycle}.`);
    }
    // Read before the name joins the path, so an unknown root leaves the walk clean for
    // the next one.
    const mod = await source.readModule(name, requiredBy);
    onPath.add(name);
    stack.push(name);
    modules.set(name, mod);
    // A name is visited once, so the root on the stack is the first one to reach it.
    rootOf.set(name, root);
    for (const dep of mod.item.dependsOn ?? []) {
      await visit(dep, root, name);
    }
    onPath.delete(name);
    stack.pop();
    done.add(name);
    order.push(name); // post-order: prerequisites land before this module
  }

  const unknown: UnknownModuleError[] = [];
  for (const root of roots) {
    try {
      await visit(root, root);
    } catch (error) {
      if (error instanceof UnknownModuleError && error.module === root) {
        unknown.push(error);
        continue;
      }
      throw error;
    }
  }
  const [first] = unknown;
  if (first && unknown.length === 1) {
    throw first;
  }
  if (unknown.length > 1) {
    const names = unknown.map((error) => `"${error.module}"`).join(", ");
    throw new RefusalError(
      `Unknown modules ${names} — the registry has no descriptor for any of them. Nothing was written.`
    );
  }
  return { modules, order, rootOf };
}

/**
 * Fold a second resolution into the first, returning a new graph and mutating neither.
 *
 * `add` needs this when a `requiresOneOf` prompt picks a driver after the requested
 * module's graph is already resolved: the picked module is resolved on its own and merged
 * here, rather than re-resolving everything, because a remote source re-downloads every
 * descriptor it reads (`registry.ts`'s `readModule` extracts to a temp dir per call).
 *
 * The base wins on a name both graphs carry — it is the descriptor the run already
 * planned against. `extra.order` is a post-order walk, so appending the names the base
 * lacks, in that order, keeps every prerequisite ahead of the module that needs it.
 */
export function mergeGraph(base: Graph, extra: Graph): Graph {
  const modules = new Map(base.modules);
  const order = [...base.order];
  const seen = new Set(order);
  for (const name of extra.order) {
    if (seen.has(name)) {
      continue;
    }
    const mod = extra.modules.get(name);
    if (!mod) {
      continue;
    }
    seen.add(name);
    modules.set(name, mod);
    order.push(name);
  }
  return { modules, order };
}
