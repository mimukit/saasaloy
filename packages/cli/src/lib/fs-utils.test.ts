import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertNoSymlinkPath,
  joinModulePath,
  readDirNames,
  resolveWithinRoot,
} from "./fs-utils.js";

// The path guards here are the last line between a corrupt state file and a write outside
// the project, so the tests pin the refusals, not just the happy resolution. The other
// helpers in this module are exercised through the applier and doctor suites.

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-fs-utils-"));
  await mkdir(join(dir, "root", "sub"), { recursive: true });
  await writeFile(join(dir, "root", "sub", "file.ts"), "export {};\n", "utf-8");
  await symlink(join(dir, "root", "sub"), join(dir, "root", "link"), "dir");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveWithinRoot — what it accepts and what it refuses", () => {
  it("resolves a nested relative path under the root", () => {
    expect(resolveWithinRoot(join(dir, "root"), "sub/file.ts")).toBe(
      join(dir, "root", "sub", "file.ts")
    );
  });

  it("refuses a backslash separator", () => {
    expect(() => resolveWithinRoot(dir, String.raw`sub\file.ts`)).toThrow(
      /paths must use '\/' separators/
    );
  });

  it("refuses an absolute path", () => {
    expect(() => resolveWithinRoot(dir, "/etc/passwd")).toThrow(
      /must be project-relative/
    );
  });

  it("refuses a drive-letter path", () => {
    expect(() => resolveWithinRoot(dir, "C:foo")).toThrow(
      /must be project-relative/
    );
  });

  it.each(["../out", "a/../b", "./a", "a//b"])("refuses %j", (bad) => {
    expect(() => resolveWithinRoot(dir, bad)).toThrow(
      /empty, '\.' or '\.\.' segments/
    );
  });

  it("appends the caller's hint to the refusal", () => {
    expect(() => resolveWithinRoot(dir, "../x", "Custom hint.")).toThrow(
      /Custom hint\./
    );
  });
});

describe("assertNoSymlinkPath — the link walk", () => {
  it("accepts the root itself", async () => {
    await expect(assertNoSymlinkPath(dir, dir)).resolves.toBeUndefined();
  });

  it("accepts a plain path with no links", async () => {
    await expect(
      assertNoSymlinkPath(
        join(dir, "root"),
        join(dir, "root", "sub", "file.ts")
      )
    ).resolves.toBeUndefined();
  });

  it("accepts a path that does not exist yet", async () => {
    await expect(
      assertNoSymlinkPath(
        join(dir, "root"),
        join(dir, "root", "new", "file.ts")
      )
    ).resolves.toBeUndefined();
  });

  it("refuses a path that passes through a symlink and names the link", async () => {
    await expect(
      assertNoSymlinkPath(
        join(dir, "root"),
        join(dir, "root", "link", "file.ts")
      )
    ).rejects.toThrow(/"link" is a symlink/);
  });
});

describe("readDirNames — directories only, and what counts as absent", () => {
  it("lists subdirectory names and skips files", async () => {
    await expect(readDirNames(join(dir, "root"))).resolves.toStrictEqual(
      expect.arrayContaining(["sub"])
    );
    await expect(readDirNames(join(dir, "root", "sub"))).resolves.toStrictEqual(
      []
    );
  });

  it("returns [] for a path that does not exist", async () => {
    await expect(readDirNames(join(dir, "absent"))).resolves.toStrictEqual([]);
  });

  it("returns [] when a path component is a file, not a directory", async () => {
    await expect(
      readDirNames(join(dir, "root", "sub", "file.ts", "deeper"))
    ).resolves.toStrictEqual([]);
  });

  // Root ignores file modes, so the permission error never fires there.
  it.runIf(process.getuid?.() !== 0)(
    "rethrows a permission error instead of reporting an empty registry",
    async () => {
      const locked = join(dir, "locked");
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        await expect(readDirNames(locked)).rejects.toThrow(/EACCES/);
      } finally {
        await chmod(locked, 0o755);
      }
    }
  );
});

describe("joinModulePath — the read-side guard", () => {
  it("resolves a descriptor path under the module folder", () => {
    expect(joinModulePath(join(dir, "root"), "sub/file.ts")).toBe(
      join(dir, "root", "sub", "file.ts")
    );
  });

  it("refuses an escape and blames the descriptor", () => {
    expect(() => joinModulePath(join(dir, "root"), "../../etc/passwd")).toThrow(
      /malformed or hostile/
    );
  });
});
