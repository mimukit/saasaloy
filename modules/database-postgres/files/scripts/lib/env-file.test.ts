// Tests for ./env-file.ts. Repo-only, like ./state.test.ts: the descriptor does not ship
// it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readEnvFile, removeKey, setKey, writeEnvFile } from "./env-file.ts";

const root = mkdtempSync(join(tmpdir(), "saasaloy-env-file-"));

after(() => {
  rmSync(root, { force: true, recursive: true });
});

function write(name: string, content: string): string {
  const path = join(root, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("readEnvFile", () => {
  it("reads a file that is not there as an empty one", () => {
    const file = readEnvFile(join(root, "absent"));
    assert.equal(file.exists, false);
    assert.deepEqual(file.lines, []);
    assert.equal(file.values.size, 0);
  });

  it("reads the values and keeps every line", () => {
    const file = readEnvFile(
      write("values", "# a\n\nDATABASE_URL=postgres://x/y\nOTHER=1\n")
    );
    assert.deepEqual(file.lines, [
      "# a",
      "",
      "DATABASE_URL=postgres://x/y",
      "OTHER=1",
    ]);
    assert.equal(file.values.get("DATABASE_URL"), "postgres://x/y");
    assert.equal(file.values.get("OTHER"), "1");
  });
});

describe("setKey / removeKey", () => {
  it("replaces a key in place", () => {
    assert.deepEqual(setKey(["A=1", "B=2"], "B", "3"), ["A=1", "B=3"]);
  });

  it("appends a key that is not there", () => {
    assert.deepEqual(setKey(["A=1"], "B", "2"), ["A=1", "B=2"]);
  });

  it("removes a key and leaves the rest alone", () => {
    assert.deepEqual(removeKey(["A=1", "B=2", "# note"], "A"), [
      "B=2",
      "# note",
    ]);
  });
});

describe("writeEnvFile", () => {
  it("writes the lines with one final newline", () => {
    const path = join(root, "written");
    writeEnvFile(path, ["# one", "KEY=value", "", ""]);
    assert.equal(readFileSync(path, "utf-8"), "# one\nKEY=value\n");
  });

  // A read-then-write must not grow one blank line per run.
  it("round-trips a file without adding blank lines", () => {
    const path = write("round-trip", "# one\n\nKEY=value\nOTHER=2\n");
    for (let pass = 0; pass < 3; pass += 1) {
      writeEnvFile(path, readEnvFile(path).lines);
    }
    assert.equal(readFileSync(path, "utf-8"), "# one\n\nKEY=value\nOTHER=2\n");
  });

  it("keeps a value it does not understand byte for byte", () => {
    const path = write("odd", '# b\n\nODD="a b # c"\nKEY=1\n');
    const file = readEnvFile(path);
    writeEnvFile(path, setKey(file.lines, "KEY", "2"));
    assert.equal(readFileSync(path, "utf-8"), '# b\n\nODD="a b # c"\nKEY=2\n');
  });
});
