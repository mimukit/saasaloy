import type { LoadedModule } from "./registry.js";
import { readModule } from "./registry.js";

// Recursive `dependsOn` resolution, topologically sorted so prerequisites are applied
// before the modules that need them (build spec §2.7). A depth-first post-order walk
// yields that order and catches dependency cycles along the way.

export interface Graph {
  /** Topological order: every module appears after the modules it dependsOn; requested is last. */
  order: string[];
  /** Every descriptor touched during resolution, keyed by name. */
  modules: Map<string, LoadedModule>;
}

export async function resolveGraph(registryDir: string, requested: string): Promise<Graph> {
  const modules = new Map<string, LoadedModule>();
  const order: string[] = [];
  const done = new Set<string>();
  const onPath = new Set<string>(); // names currently on the DFS stack — a revisit is a cycle
  const stack: string[] = [];

  async function visit(name: string, requiredBy?: string): Promise<void> {
    if (done.has(name)) return;
    if (onPath.has(name)) {
      const cycle = [...stack.slice(stack.indexOf(name)), name].join(" → ");
      throw new Error(`Dependency cycle detected: ${cycle}.`);
    }
    onPath.add(name);
    stack.push(name);
    const mod = await readModule(registryDir, name, requiredBy);
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
  return { order, modules };
}
