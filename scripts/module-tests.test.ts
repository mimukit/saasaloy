// Guards the unit-test rule across every module (issue #243, plan 0080 Phase 4). A module
// that scaffolds a workspace ships a test beside each logic file in that workspace's `src/`,
// so a project that turns testing on gets a test for every rule it installs. A file that
// has no test says why, in an `"untested": "<reason>"` key on its descriptor entry, and this
// guard prints the reason rather than failing the file.
//
// A logic file is a scaffold entry whose target is `src/**/*.ts`. Four names are structure,
// not logic, and are left out: `index.ts` (the barrel and registry), `provider.ts` (the
// provider contract), `env.ts` and `env-preset.ts` (checked by `./env-presets.test.ts`). A
// test beside it is an entry in the same scaffold that targets `<dir>/<name>.test.ts`.
//
// Like `./test-file-gates.test.ts`, it reads every `modules/*/registry-item.json` as JSON.
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");

const STRUCTURE = new Set([
  "env-preset.ts",
  "env.ts",
  "index.ts",
  "provider.ts",
]);
const NOT_LOGIC = /\.(?:d|gen|spec|test|vitest)\.ts$/;

export interface Entry {
  path: string;
  target: string;
  untested?: string;
}

export interface Descriptor {
  scaffolds?: { workspace: string; files?: Entry[] }[];
}

export interface Finding {
  /** The project path of the logic file, `<workspace>/<target>`. */
  file: string;
  /** The `untested` reason, or undefined when the file has neither a test nor a reason. */
  reason: string | undefined;
}

/** Every logic file a descriptor scaffolds with no test beside it. */
export function untestedLogicFiles(descriptor: Descriptor): Finding[] {
  return (descriptor.scaffolds ?? []).flatMap((scaffold) => {
    const files = scaffold.files ?? [];
    const targets = new Set(files.map((entry) => entry.target));
    return files
      .filter(
        (entry) =>
          entry.target.startsWith("src/") &&
          entry.target.endsWith(".ts") &&
          !NOT_LOGIC.test(entry.target) &&
          !STRUCTURE.has(basename(entry.target)) &&
          !targets.has(entry.target.replace(/\.ts$/, ".test.ts"))
      )
      .map((entry) => ({
        file: `${scaffold.workspace}/${entry.target}`,
        reason: entry.untested,
      }));
  });
}

const modules = readdirSync(MODULES)
  .filter((module) => existsSync(join(MODULES, module, "registry-item.json")))
  .map((module) => ({
    module,
    descriptor: JSON.parse(
      readFileSync(join(MODULES, module, "registry-item.json"), "utf-8")
    ) as Descriptor,
  }));

describe("untestedLogicFiles", () => {
  const descriptor: Descriptor = {
    scaffolds: [
      {
        workspace: "packages/kv",
        files: [
          { path: "files/src/index.ts", target: "src/index.ts" },
          { path: "files/src/keys.ts", target: "src/keys.ts" },
          { path: "files/src/keys.vitest.ts", target: "src/keys.test.ts" },
          { path: "files/src/cached.ts", target: "src/cached.ts" },
          { path: "files/src/cached.vitest.ts", target: "src/cached.test.ts" },
        ],
      },
    ],
  };

  it("passes a scaffold whose logic files each have a test", () => {
    assert.deepEqual(untestedLogicFiles(descriptor), []);
  });

  it("fails a scaffold that drops one test entry", () => {
    const dropped = structuredClone(descriptor);
    dropped.scaffolds?.[0]?.files?.splice(4, 1);
    assert.deepEqual(untestedLogicFiles(dropped), [
      { file: "packages/kv/src/cached.ts", reason: undefined },
    ]);
  });

  it("reports the reason of a file marked untested", () => {
    const marked = structuredClone(descriptor);
    marked.scaffolds?.[0]?.files?.splice(4, 1);
    const cached = marked.scaffolds?.[0]?.files?.[3];
    assert.ok(cached);
    cached.untested = "wiring only";
    assert.deepEqual(untestedLogicFiles(marked), [
      { file: "packages/kv/src/cached.ts", reason: "wiring only" },
    ]);
  });
});

describe("module logic files have a test or a reason", () => {
  // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
  for (const { module, descriptor } of modules) {
    it(module, (t) => {
      const findings = untestedLogicFiles(descriptor);
      for (const { file, reason } of findings) {
        if (reason !== undefined) {
          t.diagnostic(`untested ${file}: ${reason}`);
        }
      }
      assert.deepEqual(
        findings
          .filter((finding) => finding.reason === undefined)
          .map((f) => f.file),
        [],
        `${module} ships logic files with no test beside them and no "untested" reason`
      );
    });
  }
});
