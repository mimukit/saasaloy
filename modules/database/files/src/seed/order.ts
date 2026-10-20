// The order the slices are written in. A row that points at another row through a foreign
// key needs that row to exist first, so a table is written after every table it
// references. The edges come from the schema's foreign keys, plus any `after` a slice
// declares for an order the keys do not show.
//
// Pure, so the repo can test it without a database.

export interface OrderNode {
  /** The table's SQL name. */
  name: string;
  /** SQL names of the tables it must follow. A name outside the node set is ignored. */
  after: readonly string[];
}

export class SeedCycleError extends Error {
  readonly tables: readonly string[];

  constructor(tables: readonly string[]) {
    super(
      `The seed cannot order these tables, because their foreign keys or \`after\` entries form a cycle: ${tables.join(", ")}. Break the cycle with a nullable column the seed leaves empty, or remove an \`after\` entry.`
    );
    this.name = "SeedCycleError";
    this.tables = tables;
  }
}

/**
 * The node names, each one after everything it follows. Among the nodes that are ready at
 * the same time the order is alphabetical, so the seed writes in the same order on every
 * run. A table that references itself is not a cycle; its rows go in slug order.
 *
 * Throws `SeedCycleError` naming every table left in a cycle.
 */
export function orderTables(nodes: readonly OrderNode[]): string[] {
  const names = new Set(nodes.map((node) => node.name));
  const waitingOn = new Map<string, Set<string>>();
  for (const node of nodes) {
    const deps = waitingOn.get(node.name) ?? new Set<string>();
    for (const dep of node.after) {
      if (dep !== node.name && names.has(dep)) {
        deps.add(dep);
      }
    }
    waitingOn.set(node.name, deps);
  }

  const ordered: string[] = [];
  while (waitingOn.size > 0) {
    const ready = [...waitingOn]
      .filter(([, deps]) => deps.size === 0)
      .map(([name]) => name)
      .toSorted();
    if (ready.length === 0) {
      throw new SeedCycleError([...waitingOn.keys()].toSorted());
    }
    for (const name of ready) {
      ordered.push(name);
      waitingOn.delete(name);
    }
    for (const deps of waitingOn.values()) {
      for (const name of ready) {
        deps.delete(name);
      }
    }
  }
  return ordered;
}
