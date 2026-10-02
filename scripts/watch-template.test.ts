// Tests for the live module sync in `scripts/watch-template.ts` (issue #178). The watcher
// turns a changed path under `modules/` into one `add <module> --force` run, and turns
// that run's output into a short report. Both halves are pure, so they are tested here
// without a playground; the watching and the spawning are checked by hand (docs/qa).
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  installedModules,
  moduleChange,
  parseAddOutput,
} from "./watch-template.ts";

describe("moduleChange", () => {
  it("maps a file under files/ to its module", () => {
    assert.deepEqual(moduleChange("admin/files/src/components/rail.tsx"), {
      descriptor: false,
      module: "admin",
    });
  });

  it("flags a registry-item.json edit as a descriptor change", () => {
    assert.deepEqual(moduleChange("billing/registry-item.json"), {
      descriptor: true,
      module: "billing",
    });
  });

  it("accepts a Windows separator", () => {
    assert.deepEqual(moduleChange(String.raw`admin\files\src\main.tsx`), {
      descriptor: false,
      module: "admin",
    });
  });

  it("ignores the files/ directory event itself", () => {
    assert.equal(moduleChange("admin/files"), undefined);
  });

  it("ignores a path outside files/ and the descriptor", () => {
    assert.equal(
      moduleChange("admin/skills/saasaloy-admin/SKILL.md"),
      undefined
    );
    assert.equal(moduleChange("admin/README.md"), undefined);
    assert.equal(moduleChange("README.md"), undefined);
  });

  it("reads a registry-item.json below the module root as a plain file", () => {
    assert.deepEqual(moduleChange("admin/files/registry-item.json"), {
      descriptor: false,
      module: "admin",
    });
    assert.equal(moduleChange("admin/other/registry-item.json"), undefined);
  });
});

describe("installedModules", () => {
  it("reads the installed list", () => {
    assert.deepEqual(
      installedModules(
        JSON.stringify({ base: "web", installed: ["api", "auth"] })
      ),
      ["api", "auth"]
    );
  });

  it("reads no list as no modules", () => {
    assert.deepEqual(installedModules(JSON.stringify({ base: "web" })), []);
  });

  it("drops a non-string entry", () => {
    assert.deepEqual(
      installedModules(JSON.stringify({ installed: ["api", 3, null] })),
      ["api"]
    );
  });
});

// Captured from `add admin --force --yes` with stdout piped, so picocolors prints no
// colour: the plan box, then the per-file steps, then the Needs merge box.
const ADD_OUTPUT = `┌   saasaloy add
│
◇  Plan ────────────────────────────────────────╮
│                                               │
│  will install: admin                          │
│                                               │
│  unchanged  apps/admin/package.json           │
│  drift → merge  apps/admin/src/main.tsx       │
│  overwrite  apps/admin/src/components/a.tsx   │
│  create  apps/admin/src/components/b.tsx      │
│  conflict → merge  apps/admin/src/lib/api.ts  │
│                                               │
├───────────────────────────────────────────────╯
│
◇  overwrite  apps/admin/src/components/a.tsx
│
◇  create  apps/admin/src/components/b.tsx
│
◇  unchanged  apps/admin/package.json
│
◇  Needs merge ─────────────────────────────────╮
│                                               │
│  drift → merge  apps/admin/src/main.tsx       │
│  conflict → merge  apps/admin/src/lib/api.ts  │
│                                               │
├───────────────────────────────────────────────╯
│
└  Applied admin (2 files)
`;

describe("parseAddOutput", () => {
  it("lists each written file once", () => {
    assert.deepEqual(parseAddOutput(ADD_OUTPUT).written, [
      "apps/admin/src/components/a.tsx",
      "apps/admin/src/components/b.tsx",
    ]);
  });

  it("lists each held-back file once", () => {
    assert.deepEqual(parseAddOutput(ADD_OUTPUT).heldBack, [
      "apps/admin/src/main.tsx",
      "apps/admin/src/lib/api.ts",
    ]);
  });

  it("ignores unchanged files", () => {
    const { heldBack, written } = parseAddOutput(ADD_OUTPUT);
    assert.ok(![...heldBack, ...written].includes("apps/admin/package.json"));
  });

  it("strips colour codes", () => {
    const coloured =
      "◇  \u001B[36moverwrite\u001B[39m  apps/a.tsx\n│  \u001B[33mdrift → merge\u001B[39m  apps/b.tsx  │\n";
    assert.deepEqual(parseAddOutput(coloured), {
      heldBack: ["apps/b.tsx"],
      written: ["apps/a.tsx"],
    });
  });

  it("drops the variant note after a target", () => {
    const line = "◇  create  apps/api/src/x.ts (files/x-d1.ts)\n";
    assert.deepEqual(parseAddOutput(line).written, ["apps/api/src/x.ts"]);
  });
});
