// Tests for the write path of `scripts/update-deps.ts` (issue #93). The defect this
// guards against is a whole-document reserialize: `JSON.stringify(json, null, 2)` keeps
// key order but explodes every compact one-line array a hand-authored module descriptor
// holds, so a one-character version bump landed as a ~60-line diff.
//
// Two things shape this file:
//
// - Fixtures are inline template literals, never files on disk. `discoverManifests`
//   matches ANY path under `modules/` ending `registry-item.json`, so a fixture file
//   would join the sweep below and assert against itself.
// - The bump fold is re-stated here rather than imported. `writeUpdates` owns the real
//   fold (`update-deps.ts:1374-1391`) and can't be called without the CLI, so `applyBumps`
//   mirrors it: one `modify` + `applyEdits` per bump over a running string, re-parsing
//   each time. Keep the two in step.
//
// It runs on `node:test` under Node's type stripping, like the module payload tests.
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdits, modify } from "jsonc-parser";
import {
  depPath,
  depValue,
  discoverManifests,
  inferFormatting,
  readManifestDeps,
} from "./update-deps.ts";
import type { Dep, Manifest, ManifestKind } from "./update-deps.ts";

// --- Helpers -----------------------------------------------------------------

/** One chosen bump, the shape `writeUpdates` folds over a file. */
interface Bump {
  dep: Dep;
  target: string;
}

/**
 * Apply bumps to a manifest's own bytes. This mirrors the fold in `writeUpdates`; see
 * the file header for why it is a copy rather than a call.
 */
function applyBumps(manifest: Manifest, bumps: Bump[]): string {
  const formattingOptions = inferFormatting(manifest.raw);
  let source = manifest.raw;
  for (const { dep, target } of bumps) {
    const path = depPath(manifest, dep);
    if (path !== undefined) {
      const edits = modify(source, path, depValue(manifest, dep, target), {
        formattingOptions,
      });
      source = applyEdits(source, edits);
    }
  }
  return source;
}

/** Build an in-memory manifest from an inline fixture. `deps` are named per test. */
function fixture(kind: ManifestKind, raw: string, deps: Dep[] = []): Manifest {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("fixture must be a JSON object");
  }
  return {
    deps,
    file: `/fixtures/${kind}.json`,
    json: parsed as Record<string, unknown>,
    kind,
    raw,
  };
}

/**
 * How many lines differ between two documents, compared position by position rather
 * than by shelling out to `diff`. A trailing length difference counts as a differing
 * line each, so a reflow can never read as zero.
 */
function changedLineCount(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  let changed = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      changed++;
    }
  }
  return changed;
}

/** The line a bump landed on, for asserting what changed and not only how much. */
function changedLines(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  return b.filter((line, i) => line !== a[i]);
}

// --- The sweep: every manifest this repo actually ships -----------------------

describe("update-deps over every discovered manifest", () => {
  it("returns the file's own bytes when every dep is written back unchanged", async () => {
    const files = await discoverManifests();
    assert.ok(files.length > 0, "discoverManifests found no manifests");

    let deps = 0;
    for (const file of files) {
      const manifest = await readManifestDeps(file);
      // A bare entry (`"hono"`, no version) has no version text to write back, so a
      // no-op is undefined for it. None ship today; skipping keeps the sweep honest
      // if one appears.
      const bumps = manifest.deps
        .filter((dep) => dep.spec !== "")
        .map((dep) => ({ dep, target: dep.spec }));
      deps += bumps.length;
      assert.equal(
        applyBumps(manifest, bumps),
        manifest.raw,
        `${manifest.file} did not survive a no-op edit byte-for-byte`
      );
    }
    assert.ok(deps > 0, "the sweep exercised no dependencies");
  });
});

// --- Descriptor fixtures ------------------------------------------------------

// A descriptor as they are hand-authored: compact one-line arrays, a nested `patches`
// entry, and a trailing newline. `JSON.stringify(parse(src), null, 2)` reflows every
// bracket in it, which is the bug.
const DESCRIPTOR = `{
  "name": "waitlist",
  "type": "registry:block",
  "dependsOn": ["api", "database"],
  "dependencies": ["hono@4.13.5", "@scope/pkg@1.0.0"],
  "files": [{ "path": "files/src/index.ts", "target": "src/index.ts" }],
  "patches": [
    {
      "kind": "package-json-dependency",
      "target": "apps/web/package.json",
      "section": "dependencies",
      "name": "hono",
      "range": "4.13.5"
    }
  ],
  "agent": { "skills": ["waitlist"] }
}
`;

const patchDep: Dep = {
  bucket: "dependencies",
  kind: "exact",
  name: "hono",
  patchIndex: 0,
  spec: "4.13.5",
};

const arrayDep: Dep = {
  bucket: "dependencies",
  kind: "exact",
  name: "hono",
  spec: "4.13.5",
};

const scopedArrayDep: Dep = {
  bucket: "dependencies",
  kind: "exact",
  name: "@scope/pkg",
  spec: "1.0.0",
};

describe("a descriptor patch range", () => {
  it("moves as a one-line diff and leaves the compact arrays compact", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    const after = applyBumps(manifest, [{ dep: patchDep, target: "4.14.0" }]);

    assert.equal(changedLineCount(DESCRIPTOR, after), 1);
    assert.deepEqual(changedLines(DESCRIPTOR, after), [
      '      "range": "4.14.0"',
    ]);
    assert.ok(after.includes('"dependsOn": ["api", "database"]'));
    assert.ok(after.includes('"agent": { "skills": ["waitlist"] }'));
    assert.ok(after.endsWith("}\n"));
  });
});

describe("a descriptor dependencies[] entry", () => {
  it("moves as a one-line diff carrying the whole name@version", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    const after = applyBumps(manifest, [{ dep: arrayDep, target: "4.14.0" }]);

    assert.equal(changedLineCount(DESCRIPTOR, after), 1);
    assert.deepEqual(changedLines(DESCRIPTOR, after), [
      '  "dependencies": ["hono@4.14.0", "@scope/pkg@1.0.0"],',
    ]);
  });

  it("resolves a scoped name by the last @, not the leading one", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    const after = applyBumps(manifest, [
      { dep: scopedArrayDep, target: "1.1.0" },
    ]);

    assert.equal(changedLineCount(DESCRIPTOR, after), 1);
    assert.ok(after.includes('"@scope/pkg@1.1.0"'));
    assert.ok(after.includes('"hono@4.13.5"'));
  });
});

describe("two bumps in one document", () => {
  it("lands both, which is what the per-edit re-parse is for", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    const after = applyBumps(manifest, [
      { dep: arrayDep, target: "4.14.0" },
      { dep: patchDep, target: "4.14.0" },
    ]);

    assert.ok(after.includes('"hono@4.14.0"'));
    assert.ok(after.includes('"range": "4.14.0"'));
    assert.ok(!after.includes("4.13.5"));
    assert.equal(changedLineCount(DESCRIPTOR, after), 2);
  });
});

// --- depPath: the three shapes it addresses -----------------------------------

describe("depPath", () => {
  it("addresses a patch range by its index", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    assert.deepEqual(depPath(manifest, patchDep), ["patches", 0, "range"]);
  });

  it("addresses a package.json bucket by the dep name", () => {
    const manifest = fixture(
      "package-json",
      '{\n  "dependencies": { "hono": "4.13.5" }\n}\n'
    );
    assert.deepEqual(depPath(manifest, arrayDep), ["dependencies", "hono"]);
  });

  it("addresses a descriptor array entry by its index", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    assert.deepEqual(depPath(manifest, arrayDep), ["dependencies", 0]);
    assert.deepEqual(depPath(manifest, scopedArrayDep), ["dependencies", 1]);
  });

  it("returns undefined when no array entry matches, the long-standing skip", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    const missing: Dep = { ...arrayDep, name: "absent" };
    assert.equal(depPath(manifest, missing), undefined);
  });

  it("throws with the manifest path when a patch entry is not an object", () => {
    const manifest = fixture("registry-item", '{\n  "patches": ["nope"]\n}\n');
    assert.throws(() => depPath(manifest, patchDep), {
      message: "/fixtures/registry-item.json: patches[0] is not an object",
    });
  });

  it("throws with the manifest path when a package.json bucket is not an object", () => {
    const manifest = fixture("package-json", '{\n  "dependencies": []\n}\n');
    assert.throws(() => depPath(manifest, arrayDep), {
      message: '/fixtures/package-json.json: "dependencies" is not an object',
    });
  });

  it("throws with the manifest path when a descriptor bucket is not an array", () => {
    const manifest = fixture("registry-item", '{\n  "dependencies": {}\n}\n');
    assert.throws(() => depPath(manifest, arrayDep), {
      message: '/fixtures/registry-item.json: "dependencies" is not an array',
    });
  });
});

describe("depValue", () => {
  it("writes the whole name@version into a descriptor array", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    assert.equal(depValue(manifest, arrayDep, "4.14.0"), "hono@4.14.0");
  });

  it("writes a bare version into a patch range", () => {
    const manifest = fixture("registry-item", DESCRIPTOR);
    assert.equal(depValue(manifest, patchDep, "4.14.0"), "4.14.0");
  });

  it("writes a bare version into a package.json bucket", () => {
    const manifest = fixture(
      "package-json",
      '{\n  "dependencies": { "hono": "4.13.5" }\n}\n'
    );
    assert.equal(depValue(manifest, arrayDep, "4.14.0"), "4.14.0");
  });
});
