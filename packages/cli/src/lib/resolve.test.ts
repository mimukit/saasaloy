import { describe, expect, it } from "vitest";
import type { LoadedModule } from "./registry.js";
import { mergeGraph } from "./resolve.js";
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
