// Tests for the migration count `db:setup` reads in ./migrations.ts. Repo-only: the
// descriptor does not ship this file. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { migrationFiles } from "./migrations.ts";

const root = mkdtempSync(path.join(tmpdir(), "d1-migrations-"));

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("migrationFiles", () => {
  it("finds none when the migrations folder does not exist", () => {
    assert.deepEqual(migrationFiles(path.join(root, "missing")), []);
  });

  it("finds none in a folder that holds only drizzle-kit's meta folder", () => {
    const dir = path.join(root, "meta-only");
    mkdirSync(path.join(dir, "meta"), { recursive: true });
    writeFileSync(path.join(dir, "meta", "_journal.json"), "{}");
    assert.deepEqual(migrationFiles(dir), []);
  });

  it("lists every .sql file in name order", () => {
    const dir = path.join(root, "two");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "0001_second.sql"), "");
    writeFileSync(path.join(dir, "0000_first.sql"), "");
    writeFileSync(path.join(dir, "notes.md"), "");
    assert.deepEqual(migrationFiles(dir), [
      "0000_first.sql",
      "0001_second.sql",
    ]);
  });
});
