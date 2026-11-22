// Tests for `scripts/scaffold-check.ts` (issue #347), the `scaffold` job in ci.yml. The
// script itself builds the CLI, scaffolds a project and runs its `pnpm check`, which is
// minutes of work and not a unit test. What is worth pinning here is the module set it
// adds: the widest common build, a product with an entity and the agent set.
//
// Since plan 0123 the build has no fixed module set: it installs the modules the owner
// approves. So this set no longer mirrors a sentence in the `saasaloy-build` skill. It
// stays a CI choice that this test checks against the descriptors.
//
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MVP_MODULES, dbSetupArgs, parseArgs } from "./scaffold-check.ts";

/** The two `scale` modules the build adds for `agent`'s key sign-in (plan 0110). */
const AGENT_KEY_MODULES = ["api-keys", "api-keys-user"] as const;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
function descriptor(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT, "modules", name, "registry-item.json"), "utf-8")
  ) as Record<string, unknown>;
}

describe("MVP_MODULES", () => {
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

  it("picks the Postgres driver", () => {
    const names = new Set<string>(MVP_MODULES);
    assert.ok(names.has("database-postgres"));
  });
});

describe("dbSetupArgs", () => {
  it("starts the Docker backend when SCAFFOLD_DATABASE_SERVER is unset or empty", () => {
    assert.deepEqual(dbSetupArgs(), []);
    assert.deepEqual(dbSetupArgs(""), []);
  });

  it("passes --server when SCAFFOLD_DATABASE_SERVER names a server", () => {
    assert.deepEqual(
      dbSetupArgs("postgres://postgres:postgres@127.0.0.1:5432/postgres"),
      ["--server"]
    );
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
