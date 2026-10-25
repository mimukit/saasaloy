// Tests for ./env-file.ts. It ships as `env-file.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readEnvFile, removeKey, setKey, writeEnvFile } from "./env-file";

describe("env-file.ts", () => {
  const root = mkdtempSync(join(tmpdir(), "saasaloy-env-file-"));

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  function write(name: string, content: string): string {
    const path = join(root, name);
    writeFileSync(path, content, "utf-8");
    return path;
  }

  describe(readEnvFile, () => {
    it("reads a file that is not there as an empty one", () => {
      const file = readEnvFile(join(root, "absent"));
      expect(file.exists).toBeFalsy();
      expect(file.lines).toStrictEqual([]);
      expect(file.values.size).toBe(0);
    });

    it("reads the values and keeps every line", () => {
      const file = readEnvFile(
        write("values", "# a\n\nDATABASE_URL=postgres://x/y\nOTHER=1\n")
      );
      expect(file.lines).toStrictEqual([
        "# a",
        "",
        "DATABASE_URL=postgres://x/y",
        "OTHER=1",
      ]);
      expect(file.values.get("DATABASE_URL")).toBe("postgres://x/y");
      expect(file.values.get("OTHER")).toBe("1");
    });
  });

  describe("setKey / removeKey", () => {
    it("replaces a key in place", () => {
      expect(setKey(["A=1", "B=2"], "B", "3")).toStrictEqual(["A=1", "B=3"]);
    });

    it("appends a key that is not there", () => {
      expect(setKey(["A=1"], "B", "2")).toStrictEqual(["A=1", "B=2"]);
    });

    it("removes a key and leaves the rest alone", () => {
      expect(removeKey(["A=1", "B=2", "# note"], "A")).toStrictEqual([
        "B=2",
        "# note",
      ]);
    });
  });

  describe(writeEnvFile, () => {
    it("writes the lines with one final newline", () => {
      const path = join(root, "written");
      writeEnvFile(path, ["# one", "KEY=value", "", ""]);
      expect(readFileSync(path, "utf-8")).toBe("# one\nKEY=value\n");
    });

    // A read-then-write must not grow one blank line per run.
    it("round-trips a file without adding blank lines", () => {
      const path = write("round-trip", "# one\n\nKEY=value\nOTHER=2\n");
      for (let pass = 0; pass < 3; pass += 1) {
        writeEnvFile(path, readEnvFile(path).lines);
      }
      expect(readFileSync(path, "utf-8")).toBe("# one\n\nKEY=value\nOTHER=2\n");
    });

    it("keeps a value it does not understand byte for byte", () => {
      const path = write("odd", '# b\n\nODD="a b # c"\nKEY=1\n');
      const file = readEnvFile(path);
      writeEnvFile(path, setKey(file.lines, "KEY", "2"));
      expect(readFileSync(path, "utf-8")).toBe('# b\n\nODD="a b # c"\nKEY=2\n');
    });
  });
});
