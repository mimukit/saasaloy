import { describe, expect, it } from "vitest";
import {
  describeStaleOwner,
  detectCollisions,
  detectOwnedCollisions,
  formatCollisions,
  formatOwnedCollisions,
  mayShareTarget,
} from "./collisions.js";
import type {
  FileCollision,
  ModuleTargets,
  OwnedCollision,
} from "./collisions.js";
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

// Phase 2: the same rule, read against `.saasaloy/manifest.json` instead of the run.
// `classify` reports the owner of a file already on disk; these decide whether the
// module installing now may take it (#91).

/** One claim `classify` reported: this run's module wants a file another module owns. */
function claim(
  target: string,
  owner: string,
  claimant: string
): OwnedCollision {
  return { target, owner, claimant };
}

describe("detectOwnedCollisions — a legal claim", () => {
  it("allows a module to write over a file owned by a module it dependsOn", () => {
    const found = detectOwnedCollisions(
      [claim("packages/db/tsconfig.json", "database", "database-d1")],
      modules(mod("database"), mod("database-d1", ["database"]))
    );
    expect(found).toStrictEqual([]);
  });

  it("allows a capability to rewrite a file its own driver took over", () => {
    // `add database --force` on a d1 project: the driver reaches the capability, so the
    // pair is related and last-planner-wins still governs the bytes.
    const found = detectOwnedCollisions(
      [claim("packages/db/tsconfig.json", "database-d1", "database")],
      modules(mod("database"), mod("database-d1", ["database"]))
    );
    expect(found).toStrictEqual([]);
  });

  it("allows a claim across a transitive dependsOn chain", () => {
    const found = detectOwnedCollisions(
      [claim("apps/api/tsconfig.json", "api", "waitlist")],
      modules(
        mod("api"),
        mod("database", ["api"]),
        mod("waitlist", ["database"])
      )
    );
    expect(found).toStrictEqual([]);
  });

  it("reports nothing for an empty claim list", () => {
    expect(detectOwnedCollisions([], modules(mod("blog")))).toStrictEqual([]);
  });
});

describe("detectOwnedCollisions — an illegal claim", () => {
  it("refuses a sibling driver taking the installed driver's file", () => {
    const found = detectOwnedCollisions(
      [claim("packages/db/src/client.ts", "database-d1", "database-postgres")],
      modules(
        mod("database"),
        mod("database-d1", ["database"]),
        mod("database-postgres", ["database"])
      )
    );
    expect(found).toStrictEqual([
      claim("packages/db/src/client.ts", "database-d1", "database-postgres"),
    ] satisfies OwnedCollision[]);
  });

  it("refuses two unrelated modules and keeps every contested path", () => {
    const found = detectOwnedCollisions(
      [
        claim("packages/db/src/schema.ts", "waitlist", "blog"),
        claim("apps/api/src/env.ts", "waitlist", "blog"),
      ],
      modules(mod("waitlist"), mod("blog"))
    );
    expect(found).toHaveLength(2);
    expect(found.map((c) => c.target)).toStrictEqual([
      "packages/db/src/schema.ts",
      "apps/api/src/env.ts",
    ]);
  });

  it("refuses a claim on a module missing from the resolved map", () => {
    // The owner is installed but not in this run's graph, so no edge can be read and
    // the stricter answer is the safe one.
    const found = detectOwnedCollisions(
      [claim("packages/db/src/client.ts", "database-d1", "blog")],
      modules(mod("blog"))
    );
    expect(found).toHaveLength(1);
  });
});

describe("formatOwnedCollisions — the refusal text", () => {
  const owned = claim(
    "packages/db/src/client.ts",
    "database-d1",
    "database-postgres"
  );

  it("names the owner, the path, and the remove that clears it", () => {
    const message = formatOwnedCollisions([owned], "database-postgres");
    expect(message).toContain("database-d1");
    expect(message).toContain("packages/db/src/client.ts");
    expect(message).toContain("saasaloy remove database-d1");
  });

  it("says --force does not cross module ownership", () => {
    expect(formatOwnedCollisions([owned], "database-postgres")).toContain(
      "--force"
    );
  });

  it("heads the refusal with what the user asked for", () => {
    expect(
      formatOwnedCollisions([owned], "database-postgres").split("\n")[0]
    ).toBe("Cannot add database-postgres — file owned by another module:");
  });

  it("pluralises the heading and lists one line per path", () => {
    const message = formatOwnedCollisions(
      [owned, { ...owned, target: "packages/db/drizzle.config.ts" }],
      "database-postgres"
    );
    const lines = message.split("\n");
    expect(lines[0]).toBe(
      "Cannot add database-postgres — files owned by another module:"
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("packages/db/drizzle.config.ts");
  });

  it("falls back to a generic subject when no module was requested", () => {
    expect(formatOwnedCollisions([owned]).split("\n")[0]).toBe(
      "Cannot add these modules — file owned by another module:"
    );
  });
});

// #107. The missing-file half of the same fact. Nothing is refused, so the sentence has
// to read as an instruction rather than a rejection.
describe(describeStaleOwner, () => {
  const stale: OwnedCollision = {
    target: "packages/db/src/client.ts",
    owner: "database-d1",
    claimant: "database-postgres",
  };

  it("names the stale owner, the path, the claimant, and the remove that clears it", () => {
    const message = describeStaleOwner(stale);

    expect(message).toContain("database-d1");
    expect(message).toContain("packages/db/src/client.ts");
    expect(message).toContain("database-postgres");
    expect(message).toContain("saasaloy remove database-d1");
  });

  it("does not read as a refusal", () => {
    const message = describeStaleOwner(stale);

    expect(message).not.toContain("Cannot add");
    expect(message).not.toContain("--force");
  });
});
