// Tests for `scripts/release-smoke.ts` (issue #46). The smoke script itself packs, installs
// and drives the CLI, which is minutes of work and not a unit test. What is worth pinning
// here are the two pure decisions it makes before any of that: how it reads its own argv,
// and how it judges the packed manifest.
//
// The `workspace:` assertion is the one with teeth. `npm publish` does not rewrite a
// `workspace:*` range, so one such dependency ships a package that no stranger can install,
// and the failure appears only on someone else's machine. A test that pins the detector is
// cheaper than finding out from a bug report.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findRenderErrors,
  findWorkspaceDeps,
  fullScaffolds,
  parseArgs,
} from "./release-smoke.ts";

describe("parseArgs", () => {
  it("defaults to wiping the scratch directory", () => {
    assert.deepEqual(parseArgs([]), { keep: false, unknown: [] });
  });

  it("accepts --keep", () => {
    assert.deepEqual(parseArgs(["--keep"]), { keep: true, unknown: [] });
  });

  // A typo'd flag that silently does nothing is the failure mode worth rejecting: the
  // maintainer thinks the scratch tree survived for inspection, and it did not.
  it("reports an unknown flag", () => {
    assert.deepEqual(parseArgs(["--kep"]), { keep: false, unknown: ["--kep"] });
  });

  it("reports a stray positional", () => {
    assert.deepEqual(parseArgs(["smoke"]), {
      keep: false,
      unknown: ["smoke"],
    });
  });
});

describe("findWorkspaceDeps", () => {
  it("passes a manifest with only registry ranges", () => {
    assert.deepEqual(
      findWorkspaceDeps({
        dependencies: { ajv: "8.17.1" },
        devDependencies: { tsup: "8.5.1" },
      }),
      []
    );
  });

  it("catches a workspace: range in dependencies", () => {
    assert.deepEqual(
      findWorkspaceDeps({ dependencies: { "@repo/ui": "workspace:*" } }),
      ["dependencies.@repo/ui"]
    );
  });

  // devDependencies are stripped from an installed package, but a `workspace:` range there
  // still means the manifest was published straight out of the monorepo without a rewrite,
  // which is the condition this check exists to catch.
  it("catches a workspace: range in devDependencies", () => {
    assert.deepEqual(
      findWorkspaceDeps({
        devDependencies: { "@repo/tsconfig": "workspace:^" },
      }),
      ["devDependencies.@repo/tsconfig"]
    );
  });

  it("catches a workspace: range in peerDependencies and optionalDependencies", () => {
    assert.deepEqual(
      findWorkspaceDeps({
        optionalDependencies: { "@repo/native": "workspace:*" },
        peerDependencies: { "@repo/core": "workspace:*" },
      }),
      ["peerDependencies.@repo/core", "optionalDependencies.@repo/native"]
    );
  });

  it("reports every offender, not just the first", () => {
    assert.deepEqual(
      findWorkspaceDeps({
        dependencies: { "@repo/a": "workspace:*", "@repo/b": "workspace:^" },
      }),
      ["dependencies.@repo/a", "dependencies.@repo/b"]
    );
  });

  it("ignores a package merely named like the protocol", () => {
    assert.deepEqual(
      findWorkspaceDeps({ dependencies: { "workspace-tools": "1.0.0" } }),
      []
    );
  });

  it("tolerates a manifest with no dependency blocks", () => {
    assert.deepEqual(findWorkspaceDeps({ name: "saasaloy" }), []);
  });
});

// Issue #186. The web dev server answered 200 while every React block on the page threw,
// because React reports the fault in the log and Astro still serves the HTML around it. So
// the dev check reads the log as well as the status code, and this pins what it looks for.
describe("findRenderErrors", () => {
  it("passes a clean log", () => {
    assert.deepEqual(
      findRenderErrors(
        [
          " astro  v7.3.5 ready in 8392 ms",
          '{"message":"[200] / 270ms","label":null,"level":"info"}',
        ].join("\n")
      ),
      []
    );
  });

  it("catches React's invalid hook call warning", () => {
    assert.deepEqual(
      findRenderErrors(
        '{"message":"Invalid hook call. Hooks can only be called inside of the body of a function component.","label":"vite","level":"error"}'
      ),
      [
        '{"message":"Invalid hook call. Hooks can only be called inside of the body of a function component.","label":"vite","level":"error"}',
      ]
    );
  });

  // The two-copies fault surfaces as a null dispatcher, whichever hook runs first.
  it("catches a hook read off a null dispatcher", () => {
    assert.deepEqual(
      findRenderErrors(
        [
          "watching for file changes...",
          "TypeError: Cannot read properties of null (reading 'useContext')",
          "TypeError: Cannot read properties of null (reading 'useState')",
        ].join("\n")
      ),
      [
        "TypeError: Cannot read properties of null (reading 'useContext')",
        "TypeError: Cannot read properties of null (reading 'useState')",
      ]
    );
  });

  it("ignores a null read that is not a hook", () => {
    assert.deepEqual(
      findRenderErrors(
        "TypeError: Cannot read properties of null (reading 'length')"
      ),
      []
    );
  });
});

// Issue #152. The lint step must put every module through a real project, and two
// conflicting modules can never share one. Getting this wrong skips a module silently,
// which is the failure the step exists to catch.
describe("fullScaffolds", () => {
  const free = (name: string) => ({ conflictsWith: [], name });

  it("builds one project per conflicting module, each with every free module", () => {
    const scaffolds = fullScaffolds([
      free("auth"),
      { conflictsWith: ["database-postgres"], name: "database-d1" },
      free("api"),
      { conflictsWith: ["database-d1"], name: "database-postgres" },
    ]);
    assert.deepEqual(scaffolds, [
      { modules: ["database-d1", "api", "auth"], name: "full-database-d1" },
      {
        modules: ["database-postgres", "api", "auth"],
        name: "full-database-postgres",
      },
    ]);
  });

  it("puts every module in at least one project", () => {
    const modules = [
      free("api"),
      { conflictsWith: ["b"], name: "a" },
      { conflictsWith: ["a"], name: "b" },
      free("kv"),
    ];
    const covered = new Set(fullScaffolds(modules).flatMap((s) => s.modules));
    for (const entry of modules) {
      assert.ok(covered.has(entry.name), `${entry.name} is in no project`);
    }
  });

  it("builds one project when nothing conflicts", () => {
    assert.deepEqual(fullScaffolds([free("kv"), free("api")]), [
      { modules: ["api", "kv"], name: "full" },
    ]);
  });

  it("crosses independent choices and adds the database driver before API key ownership", () => {
    const modules = [
      free("api"),
      {
        ...free("database"),
        dependsOn: ["api"],
        requiresOneOf: ["database-d1", "database-postgres"],
      },
      {
        conflictsWith: ["database-postgres"],
        dependsOn: ["database"],
        name: "database-d1",
      },
      {
        conflictsWith: ["database-d1"],
        dependsOn: ["database"],
        name: "database-postgres",
      },
      { ...free("auth"), dependsOn: ["database"] },
      {
        ...free("api-keys"),
        dependsOn: ["auth"],
        requiresOneOf: ["api-keys-organization", "api-keys-user"],
      },
      {
        conflictsWith: ["api-keys-user"],
        dependsOn: ["api-keys"],
        name: "api-keys-organization",
      },
      {
        conflictsWith: ["api-keys-organization"],
        dependsOn: ["api-keys"],
        name: "api-keys-user",
      },
    ];
    const scaffolds = fullScaffolds(modules);
    assert.equal(scaffolds.length, 4);
    const combinations = new Set<string>();
    for (const scaffold of scaffolds) {
      const drivers = scaffold.modules.filter((name) =>
        name.startsWith("database-")
      );
      const owners = scaffold.modules.filter((name) =>
        name.startsWith("api-keys-")
      );
      assert.equal(drivers.length, 1);
      assert.equal(owners.length, 1);
      assert.equal(scaffold.modules[0], drivers[0]);
      assert.equal(scaffold.modules[1], owners[0]);
      combinations.add(`${drivers[0]}/${owners[0]}`);
    }
    assert.equal(combinations.size, 4);
  });

  it("honours one-sided conflicts without dropping compatible modules", () => {
    assert.deepEqual(
      fullScaffolds([
        { conflictsWith: ["b"], name: "a" },
        free("b"),
        { conflictsWith: ["b"], name: "c" },
      ]),
      [
        { modules: ["a", "c"], name: "full-a-c" },
        { modules: ["b"], name: "full-b" },
      ]
    );
  });
});
