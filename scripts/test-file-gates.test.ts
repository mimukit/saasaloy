// Guards the testing gate across every module (#242, ADR 0054). A test file a module ships
// lands only while the project's testing mode is on, so every `files[]` and
// `scaffolds[].files[]` entry whose target ends in `.test.ts` must carry
// `when: { testing: true }`. Without it a project with testing `off` receives the test
// anyway, which is the exact behaviour the mode exists to stop.
//
// The CLI's own tests run against a fixture registry, so nothing there would notice a
// real descriptor that forgot the gate. This reads every `modules/*/registry-item.json`
// as JSON. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");

interface Entry {
  target: string;
  when?: { testing?: boolean };
}

interface Descriptor {
  files?: Entry[];
  scaffolds?: { files?: Entry[] }[];
}

/** Every file entry a descriptor ships, from `files[]` and each scaffold's `files[]`. */
function entries(module: string): Entry[] {
  const descriptor = JSON.parse(
    readFileSync(join(MODULES, module, "registry-item.json"), "utf-8")
  ) as Descriptor;
  return [
    ...(descriptor.files ?? []),
    ...(descriptor.scaffolds ?? []).flatMap((scaffold) => scaffold.files ?? []),
  ];
}

const modules = readdirSync(MODULES).filter((module) =>
  existsSync(join(MODULES, module, "registry-item.json"))
);
const tests = modules.flatMap((module) =>
  entries(module)
    .filter((entry) => entry.target.endsWith(".test.ts"))
    .map((entry) => ({ module, entry }))
);

describe("module test files are gated on the testing mode", () => {
  it("finds the module test files", () => {
    // A moved directory or a renamed key would otherwise leave the check below passing on
    // nothing. Six test files shipped when the gate landed (#242).
    assert.ok(tests.length >= 6, `found only ${tests.length} test files`);
  });

  // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
  for (const { module, entry } of tests) {
    it(`${module} gates ${entry.target}`, () => {
      assert.equal(
        entry.when?.testing,
        true,
        `${module} ships ${entry.target} without "when": { "testing": true }`
      );
    });
  }
});
