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
import { findWorkspaceDeps, parseArgs } from "./release-smoke.ts";

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
