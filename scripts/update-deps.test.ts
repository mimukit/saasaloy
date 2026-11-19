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
// - The bump fold is imported, not copied. `applyBumps` is the same function `writeUpdates`
//   calls per file, so these tests exercise the shipped write path rather than a mirror of
//   it. `writeUpdates` itself stays untested here: it needs the CLI's flags, logger and
//   filesystem.
//
// It runs on `node:test` under Node's type stripping, like the module payload tests.
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyActionPins,
  applyBumps,
  buildCandidates,
  depPath,
  depValue,
  discoverManifests,
  discoverWorkflows,
  evaluateActionPin,
  fetchActionTags,
  MAJOR_GROUP_TITLE,
  parseActionPins,
  readManifestDeps,
  resolveActionPins,
  semverDelta,
} from "./update-deps.ts";
import type {
  ActionTag,
  Dep,
  GithubGet,
  Manifest,
  ManifestKind,
  Row,
} from "./update-deps.ts";

// --- Helpers -----------------------------------------------------------------

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

describe("semverDelta", () => {
  it("reads a 0.y to 0.z change as major, since semver promises nothing below 1.0", () => {
    assert.equal(semverDelta("0.16.0", "0.17.0"), "major");
    assert.equal(semverDelta("0.16.0", "1.0.0"), "major");
  });

  it("reads a 0.y patch as a patch", () => {
    assert.equal(semverDelta("0.16.0", "0.16.3"), "patch");
  });

  it("keeps the usual levels from 1.0 up", () => {
    assert.equal(semverDelta("4.13.5", "5.0.0"), "major");
    assert.equal(semverDelta("4.13.5", "4.14.0"), "minor");
    assert.equal(semverDelta("4.13.5", "4.13.6"), "patch");
    assert.equal(semverDelta("4.13.5", "4.13.5"), "none");
  });
});

describe("buildCandidates", () => {
  it("puts a 0.y to 0.z primary in the major group, so it is never pre-checked", () => {
    const dep: Dep = {
      bucket: "dependencies",
      name: "zero-major",
      spec: "0.16.0",
      kind: "exact",
    };
    const row: Row = {
      manifest: fixture("registry-item", DESCRIPTOR, [dep]),
      dep,
      resolved: {
        target: "0.17.0",
        targetOverall: "0.17.0",
        newerMajor: false,
      },
      status: "outdated",
      candidates: [{ kind: "primary", target: "0.17.0" }],
    };
    const [candidate] = buildCandidates([row]);
    assert.equal(candidate?.kind, "major");
    assert.equal(candidate?.group, MAJOR_GROUP_TITLE);
  });
});

// --- The github-actions group --------------------------------------------------
// No test here reaches the network: every GitHub API call goes through a fake `GithubGet`.

const SHA_OLD = "1".repeat(40);
const SHA_701 = "a".repeat(40);
const SHA_710 = "b".repeat(40);
const SHA_800 = "c".repeat(40);

const TAGS: ActionTag[] = [
  { name: "v8.0.0", sha: SHA_800 },
  { name: "v8", sha: SHA_800 },
  { name: "v7.1.0", sha: SHA_710 },
  { name: "v7.0.1", sha: SHA_701 },
  { name: "v7", sha: SHA_710 },
];

const WORKFLOW = [
  "jobs:",
  "  gate:",
  "    steps:",
  `      - uses: actions/checkout@${SHA_701} # v7.0.1`,
  "      - uses: pnpm/action-setup@v6",
  "      - uses: ./local-action",
  "      - uses: docker://alpine:3",
  "      - run: pnpm test",
  "",
].join("\n");

function fakeGithub(tagsByRepo: Record<string, ActionTag[]>): {
  get: GithubGet;
  calls: string[];
} {
  const calls: string[] = [];
  const get: GithubGet = (path) => {
    calls.push(path);
    const repo = /^\/repos\/([^/]+\/[^/]+)\/tags/.exec(path)?.[1] ?? "";
    const tags = tagsByRepo[repo];
    if (!tags) {
      return Promise.reject(new Error(`GitHub API 404 for ${path}`));
    }
    return Promise.resolve(
      tags.map((tag) => ({ name: tag.name, commit: { sha: tag.sha } }))
    );
  };
  return { get, calls };
}

describe("github-actions: parseActionPins", () => {
  it("reads each repository action and skips local and docker actions", () => {
    const pins = parseActionPins("ci.yml", WORKFLOW);
    assert.deepEqual(
      pins.map((pin) => [pin.line, pin.action, pin.ref, pin.tag]),
      [
        [3, "actions/checkout", SHA_701, "v7.0.1"],
        [4, "pnpm/action-setup", "v6", undefined],
      ]
    );
  });

  it("keeps a subdirectory action's path and takes the tags of its repository", () => {
    const [pin] = parseActionPins(
      "x.yml",
      `      - uses: github/codeql-action/init@${SHA_OLD} # v3.1.0`
    );
    assert.equal(pin?.repo, "github/codeql-action");
    assert.equal(pin?.action, "github/codeql-action/init");
  });

  it("reads a quoted value", () => {
    for (const quote of ['"', "'"]) {
      const [pin] = parseActionPins(
        "x.yml",
        `      - uses: ${quote}actions/checkout@v4${quote}`
      );
      assert.equal(pin?.action, "actions/checkout");
      assert.equal(pin?.ref, "v4");
    }
  });
});

describe("github-actions: evaluateActionPin", () => {
  it("moves a SHA pin to the newest tag within its major and names the newer major", () => {
    const [pin] = parseActionPins("ci.yml", WORKFLOW);
    assert.ok(pin);
    const row = evaluateActionPin(pin, TAGS, false);
    assert.equal(row.status, "update");
    assert.deepEqual(row.target, { name: "v7.1.0", sha: SHA_710 });
    assert.equal(row.newerMajor, "v8.0.0");
  });

  it("crosses the major with --allow-major", () => {
    const [pin] = parseActionPins("ci.yml", WORKFLOW);
    assert.ok(pin);
    assert.deepEqual(evaluateActionPin(pin, TAGS, true).target, {
      name: "v8.0.0",
      sha: SHA_800,
    });
  });

  it("reads a pin whose SHA and comment match the newest tag as up to date", () => {
    const [pin] = parseActionPins(
      "ci.yml",
      `      - uses: actions/checkout@${SHA_800} # v8.0.0`
    );
    assert.ok(pin);
    assert.equal(evaluateActionPin(pin, TAGS, false).status, "up-to-date");
  });

  it("flags a matching SHA whose comment names another tag", () => {
    const [pin] = parseActionPins(
      "ci.yml",
      `      - uses: actions/checkout@${SHA_800} # v8`
    );
    assert.ok(pin);
    assert.equal(evaluateActionPin(pin, TAGS, false).status, "update");
  });

  it("pins a tag ref to the newest full tag of that major", () => {
    const [pin] = parseActionPins(
      "ci.yml",
      "      - uses: actions/checkout@v7"
    );
    assert.ok(pin);
    const row = evaluateActionPin(pin, TAGS, false);
    assert.equal(row.status, "update");
    assert.deepEqual(row.target, { name: "v7.1.0", sha: SHA_710 });
  });

  it("is unresolved when the repository has no vX.Y.Z tag", () => {
    const [pin] = parseActionPins("ci.yml", "      - uses: a/b@v1");
    assert.ok(pin);
    const row = evaluateActionPin(pin, [{ name: "v1", sha: SHA_OLD }], false);
    assert.equal(row.status, "unresolved");
  });
});

describe("github-actions: applyActionPins", () => {
  it("rewrites the SHA and the comment and leaves every other line alone", () => {
    const pins = parseActionPins("ci.yml", WORKFLOW);
    const rows = pins.map((pin) => evaluateActionPin(pin, TAGS, false));
    const after = applyActionPins(WORKFLOW, rows.slice(0, 1));
    assert.deepEqual(changedLines(WORKFLOW, after), [
      `      - uses: actions/checkout@${SHA_710} # v7.1.0`,
    ]);
  });
});

describe("github-actions: fetchActionTags and resolveActionPins", () => {
  it("asks the tags API once per repository", async () => {
    const { get, calls } = fakeGithub({ "actions/checkout": TAGS });
    const tags = await fetchActionTags("actions/checkout", get);
    assert.equal(tags.length, TAGS.length);
    assert.deepEqual(calls, [
      "/repos/actions/checkout/tags?per_page=100&page=1",
    ]);
  });

  it("resolves a repository's tags once for every line that names it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "update-deps-actions-"));
    try {
      const file = join(dir, "two.yml");
      writeFileSync(
        file,
        `${WORKFLOW}      - uses: actions/checkout@v7\n      - uses: actions/checkout@v8\n`
      );
      const { get, calls } = fakeGithub({
        "actions/checkout": TAGS,
        "pnpm/action-setup": [{ name: "v6.1.1", sha: SHA_OLD }],
      });
      const rows = await resolveActionPins(false, get, [file]);
      assert.equal(rows.length, 4);
      assert.equal(calls.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evaluates every line of the shipped ci workflow and reports a failed lookup as unresolved", async () => {
    const ci = (await discoverWorkflows()).find((file) =>
      file.endsWith("modules/ci/files/workflows/ci.yml")
    );
    assert.ok(ci, "discoverWorkflows did not find the ci module workflow");
    const { get, calls } = fakeGithub({ "actions/checkout": TAGS });
    const rows = await resolveActionPins(false, get, [ci]);
    const repos = new Set(rows.map((row) => row.pin.repo));
    assert.equal(calls.length, repos.size, "one tags call per repository");
    assert.ok(repos.has("actions/checkout"));
    assert.ok(
      rows
        .filter((row) => row.pin.repo !== "actions/checkout")
        .every((row) => row.status === "unresolved")
    );
  });

  it("scans shipped workflows only, never the repo's own .github/", async () => {
    const files = await discoverWorkflows();
    assert.ok(files.length > 0);
    assert.ok(files.every((file) => !file.includes("/.github/")));
  });
});
