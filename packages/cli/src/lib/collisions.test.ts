import { describe, expect, it } from "vitest";
import {
  detectCollisions,
  formatCollisions,
  mayShareTarget,
} from "./collisions.js";
import type { FileCollision, ModuleTargets } from "./collisions.js";
import type { LoadedModule } from "./registry.js";

// The rule under test: two modules in one run may share a file target only when one of
// them reaches the other through `dependsOn`. Core-plus-driver stays legal, an unrelated
// pair is refused (#91).

function mod(name: string, dependsOn: string[] = []): LoadedModule {
  return {
    dir: `/tmp/${name}`,
    item: {
      name,
      type: "saasaloy:feature",
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    },
  };
}

function modules(...loaded: LoadedModule[]): Map<string, LoadedModule> {
  return new Map(loaded.map((m) => [m.item.name, m]));
}

/** One module's planned targets, in the order `listModuleFiles` yields them. */
function targets(module: string, ...paths: string[]): ModuleTargets {
  return { module, targets: paths };
}

describe("detectCollisions — a legal overlap", () => {
  it("allows a driver to share a target with the capability it dependsOn", () => {
    const found = detectCollisions({
      planned: [
        targets("database", "packages/db/tsconfig.json"),
        targets("database-d1", "packages/db/tsconfig.json"),
      ],
      modules: modules(mod("database"), mod("database-d1", ["database"])),
    });
    expect(found).toStrictEqual([]);
  });

  it("allows the overlap whichever side declares the dependency", () => {
    const found = detectCollisions({
      planned: [
        targets("database", "packages/db/tsconfig.json"),
        targets("database-d1", "packages/db/tsconfig.json"),
      ],
      // Reversed: the capability names the driver instead.
      modules: modules(mod("database", ["database-d1"]), mod("database-d1")),
    });
    expect(found).toStrictEqual([]);
  });

  it("allows an overlap across a transitive dependsOn chain", () => {
    const found = detectCollisions({
      planned: [
        targets("api", "apps/api/tsconfig.json"),
        targets("waitlist", "apps/api/tsconfig.json"),
      ],
      modules: modules(
        mod("api"),
        mod("database", ["api"]),
        mod("waitlist", ["database"])
      ),
    });
    expect(found).toStrictEqual([]);
  });

  it("reports nothing when no two modules pick the same target", () => {
    const found = detectCollisions({
      planned: [
        targets("waitlist", "apps/api/src/waitlist.ts"),
        targets("blog", "apps/api/src/blog.ts"),
      ],
      modules: modules(mod("waitlist"), mod("blog")),
    });
    expect(found).toStrictEqual([]);
  });

  it("terminates on a dependsOn cycle instead of walking it forever", () => {
    const found = detectCollisions({
      planned: [
        targets("a", "shared.ts"),
        targets("b", "shared.ts"),
        targets("c", "other.ts"),
      ],
      // a → b → a is a cycle resolveGraph would reject; the walk must not hang on it.
      modules: modules(mod("a", ["b"]), mod("b", ["a"]), mod("c")),
    });
    expect(found).toStrictEqual([]);
  });
});

describe("detectCollisions — an illegal overlap", () => {
  it("refuses two unrelated modules that write the same target", () => {
    const found = detectCollisions({
      planned: [
        targets("waitlist", "packages/db/src/schema.ts"),
        targets("blog", "packages/db/src/schema.ts"),
      ],
      modules: modules(mod("waitlist"), mod("blog")),
    });
    expect(found).toStrictEqual([
      {
        target: "packages/db/src/schema.ts",
        module: "waitlist",
        other: "blog",
      },
    ] satisfies FileCollision[]);
  });

  it("refuses a sibling pair under one capability, which depends on neither way", () => {
    const found = detectCollisions({
      planned: [
        targets("database", "packages/db/tsconfig.json"),
        targets("database-d1", "packages/db/src/client.ts"),
        targets("database-postgres", "packages/db/src/client.ts"),
      ],
      modules: modules(
        mod("database"),
        mod("database-d1", ["database"]),
        mod("database-postgres", ["database"])
      ),
    });
    expect(found).toStrictEqual([
      {
        target: "packages/db/src/client.ts",
        module: "database-d1",
        other: "database-postgres",
      },
    ] satisfies FileCollision[]);
  });

  it("reports every contested path, in install then target order", () => {
    const found = detectCollisions({
      planned: [
        targets("waitlist", "packages/db/src/schema.ts", "apps/api/src/env.ts"),
        targets("blog", "packages/db/src/schema.ts", "apps/api/src/env.ts"),
      ],
      modules: modules(mod("waitlist"), mod("blog")),
    });
    expect(found.map((c) => c.target)).toStrictEqual([
      "packages/db/src/schema.ts",
      "apps/api/src/env.ts",
    ]);
  });

  it("reports one pair per claimant when three modules claim one target", () => {
    const found = detectCollisions({
      planned: [
        targets("a", "shared.ts"),
        targets("b", "shared.ts"),
        targets("c", "shared.ts"),
      ],
      modules: modules(mod("a"), mod("b"), mod("c")),
    });
    expect(found).toStrictEqual([
      { target: "shared.ts", module: "a", other: "b" },
      { target: "shared.ts", module: "a", other: "c" },
      { target: "shared.ts", module: "b", other: "c" },
    ] satisfies FileCollision[]);
  });

  it("refuses a pair whose dependsOn names a module outside this run", () => {
    const found = detectCollisions({
      planned: [targets("a", "shared.ts"), targets("b", "shared.ts")],
      // Both hang off `api`, which is not the same as one hanging off the other.
      modules: modules(mod("a", ["api"]), mod("b", ["api"])),
    });
    expect(found).toHaveLength(1);
  });
});

describe("mayShareTarget — the rule on its own", () => {
  it("is true for a module and itself", () => {
    expect(mayShareTarget("api", "api", modules(mod("api")))).toBeTruthy();
  });

  it("is false for two modules with no dependsOn edge either way", () => {
    expect(
      mayShareTarget("waitlist", "blog", modules(mod("waitlist"), mod("blog")))
    ).toBeFalsy();
  });

  it("is false when a name has no descriptor to walk", () => {
    expect(mayShareTarget("waitlist", "blog", new Map())).toBeFalsy();
  });
});

describe("formatCollisions — the refusal text", () => {
  const collision: FileCollision = {
    target: "packages/db/src/schema.ts",
    module: "waitlist",
    other: "blog",
  };

  it("names both modules, the contested path, and conflictsWith", () => {
    const message = formatCollisions([collision], "blog");
    expect(message).toContain("waitlist");
    expect(message).toContain("blog");
    expect(message).toContain("packages/db/src/schema.ts");
    expect(message).toContain("conflictsWith");
    expect(message).toContain("dependsOn");
  });

  it("heads the refusal with what the user asked for", () => {
    expect(formatCollisions([collision], "blog").split("\n")[0]).toBe(
      "Cannot add blog — file collision:"
    );
  });

  it("pluralises the heading and lists one line per path", () => {
    const message = formatCollisions(
      [collision, { ...collision, target: "apps/api/src/env.ts" }],
      "blog"
    );
    const lines = message.split("\n");
    expect(lines[0]).toBe("Cannot add blog — file collisions:");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("apps/api/src/env.ts");
  });

  it("falls back to a generic subject when no module was requested", () => {
    expect(formatCollisions([collision]).split("\n")[0]).toBe(
      "Cannot add these modules — file collision:"
    );
  });
});
