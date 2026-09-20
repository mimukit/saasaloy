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
    assert.deepEqual(file.blockLines, []);
    assert.equal(file.values.size, 0);
  });

  it("splits the leading comment block from the body", () => {
    const file = readEnvFile(
      write("with-block", "# a\n# b\n\nDATABASE_URL=postgres://x/y\nOTHER=1\n")
    );
    assert.deepEqual(file.blockLines, ["# a", "# b"]);
    assert.equal(file.values.get("DATABASE_URL"), "postgres://x/y");
    assert.equal(file.values.get("OTHER"), "1");
  });

  it("reads a file with no block at all", () => {
    const file = readEnvFile(write("no-block", "KEY=value\n"));
    assert.deepEqual(file.blockLines, []);
    assert.equal(file.values.get("KEY"), "value");
  });

  // A comment below the first key is body, not block: only the top run is the state block.
  it("leaves a comment after the first key in the body", () => {
    const file = readEnvFile(write("mid-comment", "KEY=1\n# note\nOTHER=2\n"));
    assert.deepEqual(file.blockLines, []);
    assert.ok(file.lines.includes("# note"));
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
  it("writes the block, a blank line, then the body", () => {
    const path = join(root, "written");
    writeEnvFile(path, ["# one", "# two"], ["KEY=value"]);
    assert.equal(readFileSync(path, "utf-8"), "# one\n# two\n\nKEY=value\n");
  });

  it("writes only the body when the block is empty", () => {
    const path = join(root, "no-block-out");
    writeEnvFile(path, [], ["KEY=value"]);
    assert.equal(readFileSync(path, "utf-8"), "KEY=value\n");
  });

  // A read-then-write must not grow one blank line per run.
  it("round-trips a file without adding blank lines", () => {
    const path = write("round-trip", "# one\n\nKEY=value\nOTHER=2\n");
    for (let pass = 0; pass < 3; pass += 1) {
      const file = readEnvFile(path);
      writeEnvFile(path, file.blockLines, file.lines);
    }
    assert.equal(readFileSync(path, "utf-8"), "# one\n\nKEY=value\nOTHER=2\n");
  });

  it("keeps a value it does not understand byte for byte", () => {
    const path = write("odd", '# b\n\nODD="a b # c"\nKEY=1\n');
    const file = readEnvFile(path);
    writeEnvFile(path, file.blockLines, setKey(file.lines, "KEY", "2"));
    assert.equal(readFileSync(path, "utf-8"), '# b\n\nODD="a b # c"\nKEY=2\n');
  });
});
