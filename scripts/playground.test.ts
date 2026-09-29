// Tests for `scripts/playground.ts` (issue #178), the git baseline behind `play:snap` and
// `play:restore`. The git, pnpm and server steps run against a real playground and are
// checked by hand (docs/qa); the decisions they rest on are pure and tested here.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  databaseDriver,
  listenerPids,
  parseArgs,
  readDevVar,
} from "./playground.ts";

describe("parseArgs", () => {
  it("reads snap", () => {
    assert.deepEqual(parseArgs(["snap"]), { command: "snap", db: false });
  });

  it("reads restore with and without --db", () => {
    assert.deepEqual(parseArgs(["restore"]), { command: "restore", db: false });
    assert.deepEqual(parseArgs(["restore", "--db"]), {
      command: "restore",
      db: true,
    });
  });

  it("refuses --db on snap", () => {
    assert.throws(() => parseArgs(["snap", "--db"]), /--db/);
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
