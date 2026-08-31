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
  const modules = new Map<string, LoadedModule>();
  const order: string[] = [];
  const done = new Set<string>();
  const onPath = new Set<string>(); // names currently on the DFS stack — a revisit is a cycle
  const stack: string[] = [];

  async function visit(name: string, requiredBy?: string): Promise<void> {
    if (done.has(name)) {
      return;
    }
    if (onPath.has(name)) {
      const cycle = [...stack.slice(stack.indexOf(name)), name].join(" → ");
      throw new Error(`Dependency cycle detected: ${cycle}.`);
    }
    onPath.add(name);
    stack.push(name);
    const mod = await source.readModule(name, requiredBy);
    modules.set(name, mod);
    for (const dep of mod.item.dependsOn ?? []) {
      await visit(dep, name);
    }
    onPath.delete(name);
    stack.pop();
    done.add(name);
    order.push(name); // post-order: prerequisites land before this module
  }

  await visit(requested);
  return { modules, order };
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
