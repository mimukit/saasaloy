import { describe, expect, it } from "vitest";
import type { LoadedModule, RegistrySource } from "./registry.js";
import { mergeGraph, resolveGraph } from "./resolve.js";
import type { Graph } from "./resolve.js";

function mod(name: string, dependsOn: string[] = []): LoadedModule {
  return {
    dir: `/tmp/${name}`,
    item: { name, type: "saasaloy:feature", dependsOn },
  };
}

function graph(...modules: LoadedModule[]): Graph {
  return {
    order: modules.map((m) => m.item.name),
    modules: new Map(modules.map((m) => [m.item.name, m])),
  };
}

describe("mergeGraph — folding a second resolution in", () => {
  it("appends the modules the base graph doesn't already carry", () => {
    const merged = mergeGraph(
      graph(mod("api"), mod("database", ["api"])),
      graph(
        mod("api"),
        mod("database", ["api"]),
        mod("database-d1", ["database"])
      )
    );
    expect(merged.order).toStrictEqual(["api", "database", "database-d1"]);
    expect([...merged.modules.keys()]).toStrictEqual([
      "api",
      "database",
      "database-d1",
    ]);
  });

  it("keeps the base descriptor when both graphs carry the same module", () => {
    const base = graph(mod("database", ["api"]));
    const merged = mergeGraph(base, graph(mod("database", ["something-else"])));
    expect(merged.modules.get("database")?.item.dependsOn).toStrictEqual([
      "api",
    ]);
  });

  it("leaves the base graph untouched", () => {
    const base = graph(mod("api"));
    mergeGraph(base, graph(mod("logger")));
    expect(base.order).toStrictEqual(["api"]);
    expect(base.modules.has("logger")).toBeFalsy();
  });

  it("keeps prerequisites ahead of the module that needs them", () => {
    // `database-postgres` dependsOn `database`, so its own post-order walk yields
    // [database, database-postgres]. Both graphs already hold `database`, so only the
    // driver is appended — after the prerequisite that is already in place.
    const merged = mergeGraph(
      graph(
        mod("api"),
        mod("database", ["api"]),
        mod("waitlist", ["database"])
      ),
      graph(
        mod("api"),
        mod("database", ["api"]),
        mod("database-postgres", ["database"])
      )
    );
    expect(merged.order.indexOf("database")).toBeLessThan(
      merged.order.indexOf("database-postgres")
    );
  });
});

// A registry source backed by a plain map. `resolveGraph` only calls `readModule`, so the
// rest of the interface is present to satisfy the type and never runs.
function sourceOf(
  edges: Record<string, string[]>
): RegistrySource & { reads: string[] } {
  const reads: string[] = [];
  return {
    label: "fake",
    reads,
    listModules: () => Promise.resolve(Object.keys(edges).toSorted()),
    provenance: () => ({ ref: "local", resolved: "local", source: "local" }),
    resolveSha: () => Promise.resolve("local"),
    commitSubjects: () => Promise.resolve([]),
    readModule(name: string, requiredBy?: string) {
      reads.push(requiredBy ? `${name}<-${requiredBy}` : name);
      const dependsOn = edges[name];
      if (!dependsOn) {
        return Promise.reject(new Error(`Unknown module "${name}"`));
      }
      return Promise.resolve(mod(name, dependsOn));
    },
  };
}

describe("resolveGraph — topological order", () => {
  it("puts a prerequisite ahead of the module that needs it", async () => {
    const resolved = await resolveGraph(
      sourceOf({ api: [], database: ["api"], waitlist: ["database"] }),
      "waitlist"
    );

    expect(resolved.order).toStrictEqual(["api", "database", "waitlist"]);
  });

  it("puts the requested module last", async () => {
    const resolved = await resolveGraph(
      sourceOf({ a: [], b: [], c: ["a", "b"] }),
      "c"
    );

    expect(resolved.order.at(-1)).toBe("c");
  });

  it("reads a shared prerequisite once, not once per dependent", async () => {
    const source = sourceOf({
      api: [],
      database: ["api"],
      logger: ["api"],
      waitlist: ["database", "logger"],
    });

    const resolved = await resolveGraph(source, "waitlist");

    expect(resolved.order).toStrictEqual([
      "api",
      "database",
      "logger",
      "waitlist",
    ]);
    expect(source.reads.filter((n) => n.startsWith("api"))).toHaveLength(1);
  });

  it("returns every descriptor it touched, keyed by name", async () => {
    const resolved = await resolveGraph(
      sourceOf({ api: [], database: ["api"] }),
      "database"
    );

    expect([...resolved.modules.keys()].toSorted()).toStrictEqual([
      "api",
      "database",
    ]);
    expect(resolved.modules.get("api")?.item.name).toBe("api");
  });

  it("resolves a module with no dependencies at all", async () => {
    const resolved = await resolveGraph(sourceOf({ api: [] }), "api");

    expect(resolved.order).toStrictEqual(["api"]);
  });

  it("names the module that required a missing dependency", async () => {
    const source = sourceOf({ waitlist: ["ghost"] });

    await expect(resolveGraph(source, "waitlist")).rejects.toThrow(
      'Unknown module "ghost"'
    );
    expect(source.reads).toContain("ghost<-waitlist");
  });
});

// The cycle guard has been in `resolve.ts` since the applier landed and nothing ever
// drove it, so a regression that silently disabled it would have hung or recursed
// instead of failing. These pin both the refusal and the path it prints.
describe("resolveGraph — cycle detection", () => {
  it("refuses a two-module cycle, naming the path", async () => {
    await expect(
      resolveGraph(sourceOf({ a: ["b"], b: ["a"] }), "a")
    ).rejects.toThrow("Dependency cycle detected: a → b → a.");
  });

  it("refuses a longer cycle, naming every module on the path", async () => {
    await expect(
      resolveGraph(sourceOf({ a: ["b"], b: ["c"], c: ["a"] }), "a")
    ).rejects.toThrow("Dependency cycle detected: a → b → c → a.");
  });

  it("refuses a module that depends on itself", async () => {
    await expect(resolveGraph(sourceOf({ a: ["a"] }), "a")).rejects.toThrow(
      "Dependency cycle detected: a → a."
    );
  });

  it("reports the cycle from where it starts, not from the requested module", async () => {
    await expect(
      resolveGraph(sourceOf({ a: ["b"], b: ["c"], c: ["b"] }), "a")
    ).rejects.toThrow("Dependency cycle detected: b → c → b.");
  });

  it("does not mistake a diamond for a cycle", async () => {
    const resolved = await resolveGraph(
      sourceOf({
        base: [],
        left: ["base"],
        right: ["base"],
        top: ["left", "right"],
      }),
      "top"
    );

    expect(resolved.order).toStrictEqual(["base", "left", "right", "top"]);
  });
});
