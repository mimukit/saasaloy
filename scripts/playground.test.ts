// Tests for `scripts/playground.ts` (issue #178), the git baseline behind `play:snap` and
// `play:restore`. The git, pnpm and server steps run against a real playground and are
// checked by hand (docs/qa); the decisions they rest on are pure and tested here.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  addArgs,
  databaseDriver,
  envFile,
  insideDir,
  listenerPids,
  parseArgs,
  readDevVar,
  readPresets,
} from "./playground.ts";
import type { Preset } from "./playground.ts";

describe("parseArgs", () => {
  it("reads snap", () => {
    assert.deepEqual(parseArgs(["snap"]), { command: "snap" });
  });

  it("reads restore with and without --db", () => {
    assert.deepEqual(parseArgs(["restore"]), { command: "restore", db: false });
    assert.deepEqual(parseArgs(["restore", "--db"]), {
      command: "restore",
      db: true,
    });
  });

  it("refuses a flag on snap and down", () => {
    assert.throws(() => parseArgs(["snap", "--db"]), /no flags/);
    assert.throws(() => parseArgs(["down", "--db"]), /no flags/);
  });

  it("reads up with the full preset on d1 by default", () => {
    assert.deepEqual(parseArgs(["up"]), {
      command: "up",
      db: "d1",
      preset: "full",
    });
    assert.deepEqual(
      parseArgs(["up", "--preset", "minimal", "--db", "postgres"]),
      { command: "up", db: "postgres", preset: "minimal" }
    );
  });

  it("refuses an unknown driver, a missing value or an unknown up flag", () => {
    assert.throws(() => parseArgs(["up", "--db", "mysql"]), /d1 or postgres/);
    assert.throws(() => parseArgs(["up", "--preset"]), /needs a value/);
    assert.throws(() => parseArgs(["up", "--preset", "--db"]), /needs a value/);
    assert.throws(() => parseArgs(["up", "--fast"]), /--fast/);
  });

  it("refuses an unknown command or flag", () => {
    assert.throws(() => parseArgs([]), /usage/);
    assert.throws(() => parseArgs(["reset"]), /usage/);
    assert.throws(() => parseArgs(["restore", "--dbs"]), /--dbs/);
  });
});

describe("databaseDriver", () => {
  it("names the installed driver", () => {
    assert.equal(databaseDriver(["api", "database", "database-d1"]), "d1");
    assert.equal(
      databaseDriver(["api", "database", "database-postgres"]),
      "postgres"
    );
  });

  it("reads no driver as no database", () => {
    assert.equal(databaseDriver(["api"]), undefined);
  });
});

describe("listenerPids", () => {
  it("reads the pids from ss output", () => {
    const ss =
      'LISTEN 0 511 *:4000 *:* users:(("node",pid=4121,fd=31),("node",pid=4122,fd=31))\n';
    assert.deepEqual(listenerPids(ss), [4121, 4122]);
  });

  it("reads lsof -t output", () => {
    assert.deepEqual(listenerPids("4121\n4122\n"), [4121, 4122]);
  });

  it("reads nothing as no pids", () => {
    assert.deepEqual(listenerPids(""), []);
  });
});

describe("readDevVar", () => {
  it("reads a plain and a quoted value", () => {
    const vars = 'A=1\nDATABASE_URL="postgres://u:p@h:5432/db"\n';
    assert.equal(readDevVar(vars, "DATABASE_URL"), "postgres://u:p@h:5432/db");
    assert.equal(readDevVar(vars, "A"), "1");
  });

  it("skips a comment and a missing key", () => {
    assert.equal(readDevVar("# DATABASE_URL=x\n", "DATABASE_URL"), undefined);
  });
});

const presetsFile = resolve(import.meta.dirname, "play-presets.json");
const modulesDir = resolve(import.meta.dirname, "../modules");

function descriptor(name: string): { conflictsWith?: string[] } {
  return JSON.parse(
    readFileSync(resolve(modulesDir, name, "registry-item.json"), "utf-8")
  ) as { conflictsWith?: string[] };
}

describe("play-presets.json", () => {
  const presets = readPresets(readFileSync(presetsFile, "utf-8"));

  it("holds minimal and full", () => {
    assert.deepEqual(Object.keys(presets).toSorted(), ["full", "minimal"]);
  });

  it("names only modules in the registry, and no two that conflict", () => {
    for (const [name, preset] of Object.entries(presets)) {
      for (const module of preset.modules) {
        assert.ok(
          existsSync(resolve(modulesDir, module, "registry-item.json")),
          `${name} names ${module}, which is not in modules/`
        );
        for (const other of descriptor(module).conflictsWith ?? []) {
          assert.ok(
            !preset.modules.includes(other),
            `${name} names ${module} and ${other}, which conflict`
          );
        }
      }
    }
  });

  it("leaves the driver to --db", () => {
    for (const preset of Object.values(presets)) {
      assert.ok(!preset.modules.some((m) => m.startsWith("database")));
    }
  });
});

describe("readPresets", () => {
  it("refuses a preset that sets BETTER_AUTH_SECRET", () => {
    const text = JSON.stringify({
      bad: { description: "", env: { BETTER_AUTH_SECRET: "x" }, modules: [] },
    });
    assert.throws(() => readPresets(text), /BETTER_AUTH_SECRET/);
  });

  it("refuses a preset with no module list", () => {
    const text = JSON.stringify({ bad: { description: "", env: {} } });
    assert.throws(() => readPresets(text), /modules list/);
  });

  it("skips a $comment key", () => {
    assert.deepEqual(readPresets('{"$comment":"x"}'), {});
  });
});

describe("addArgs and envFile", () => {
  const preset: Preset = {
    description: "",
    env: { B: "2", A: "1" },
    modules: ["waitlist"],
  };

  it("adds the driver --db picks", () => {
    assert.deepEqual(addArgs(preset, "postgres"), [
      "add",
      "waitlist",
      "--with",
      "database-postgres",
      "--yes",
    ]);
  });

  it("adds nothing for a preset with no modules", () => {
    assert.deepEqual(addArgs({ ...preset, modules: [] }, "d1"), []);
  });

  it("writes one sorted line per key", () => {
    assert.match(envFile(preset), /\nA=1\nB=2\n$/);
  });
});

describe("insideDir", () => {
  it("admits the folder and what is under it, and nothing beside it", () => {
    assert.ok(insideDir("/r/.dev/playground", "/r/.dev/playground"));
    assert.ok(insideDir("/r/.dev/playground/apps/api", "/r/.dev/playground"));
    assert.ok(!insideDir("/r/.dev/playground-2", "/r/.dev/playground"));
    assert.ok(!insideDir(undefined, "/r/.dev/playground"));
  });
});
