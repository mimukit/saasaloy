// Tests for `scripts/scaffold-check.ts` (issue #347), the `scaffold` job in ci.yml. The
// script itself builds the CLI, scaffolds a project and runs its `pnpm check`, which is
// minutes of work and not a unit test. What is worth pinning here is the module set it
// adds: it must stay the set an agent's build adds, or the job checks a project nobody
// builds.
//
// The set has no data source of its own. The `saasaloy-build` skill picks it from
// `saasaloy list --json` by stage and then by rules written in prose, and names the result
// in one sentence. This test reads that sentence and the descriptors, so a change to
// either one fails here until `MVP_MODULES` follows it.
//
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MVP_MODULES, parseArgs } from "./scaffold-check.ts";

/** The two `scale` modules the build adds for `agent`'s key sign-in (plan 0110). */
const AGENT_KEY_MODULES = ["api-keys", "api-keys-user"] as const;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_SKILL = join(
  ROOT,
  "packages/cli/templates/base/_agents/skills/saasaloy-build/SKILL.md"
);

/** The module names in backticks in the build skill's "this gives" sentence. */
function modulesTheSkillNames(): string[] {
  const skill = readFileSync(BUILD_SKILL, "utf-8");
  const sentence = /^For the MVP stage this gives .*$/m.exec(skill)?.[0];
  assert.ok(
    sentence,
    "saasaloy-build no longer has its 'For the MVP stage this gives ...' sentence. Point this test and MVP_MODULES at the new source of the MVP module set."
  );
  return [...sentence.matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1]!);
}

function descriptor(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT, "modules", name, "registry-item.json"), "utf-8")
  ) as Record<string, unknown>;
}

describe("MVP_MODULES", () => {
  it("is the Validate and MVP set the saasaloy-build skill names", () => {
    assert.deepEqual(
      [...MVP_MODULES].toSorted(),
      modulesTheSkillNames().toSorted()
    );
  });

  it("adds agent with its key modules, which stay scale modules (plan 0110)", () => {
    const names = new Set<string>(MVP_MODULES);
    for (const name of ["agent", ...AGENT_KEY_MODULES]) {
      assert.ok(names.has(name), `${name} is not in MVP_MODULES`);
    }
    for (const name of AGENT_KEY_MODULES) {
      assert.equal(descriptor(name).stage, "scale", `${name} is not scale`);
    }
  });

  it("holds only Validate and MVP stage modules that need no account, and the key modules", () => {
    for (const name of MVP_MODULES) {
      const item = descriptor(name);
      assert.ok(
        item.stage === "validate" ||
          item.stage === "mvp" ||
          (AGENT_KEY_MODULES as readonly string[]).includes(name),
        `${name} is a ${String(item.stage)} module`
      );
      assert.deepEqual(item.needs ?? [], [], `${name} needs an account`);
    }
  });

  it("picks the D1 driver", () => {
    const names = new Set<string>(MVP_MODULES);
    assert.ok(names.has("database-d1"));
    assert.ok(!names.has("database-postgres"));
  });
});

describe("parseArgs", () => {
  it("defaults to deleting the scaffold after a green run", () => {
    assert.deepEqual(parseArgs([]), { keep: false, unknown: [] });
  });

  it("accepts --keep", () => {
    assert.deepEqual(parseArgs(["--keep"]), { keep: true, unknown: [] });
  });

  it("reports an unknown flag", () => {
    assert.deepEqual(parseArgs(["--kep"]), { keep: false, unknown: ["--kep"] });
  });
});
