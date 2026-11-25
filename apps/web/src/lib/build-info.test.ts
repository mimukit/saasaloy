import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { readBuildInfo } from "./build-info.ts";

const scratch: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "saasaloy-build-info-"));
  scratch.push(dir);
  return dir;
}

after(() => {
  for (const dir of scratch) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readBuildInfo", () => {
  it("reads the full HEAD commit and its date beside the version", () => {
    const dir = tempDir();
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
    git("init", "--quiet");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "a.txt"), "a");
    git("add", "-A");
    git("commit", "--quiet", "-m", "start");
    assert.deepEqual(readBuildInfo(dir, "0.9.0"), {
      version: "0.9.0",
      commit: git("rev-parse", "HEAD"),
      date: git("log", "-1", "--format=%cs", "HEAD"),
    });
  });

  it("leaves the commit out where git has no repository", () => {
    assert.deepEqual(readBuildInfo(tempDir(), "0.9.0"), {
      version: "0.9.0",
      commit: undefined,
      date: undefined,
    });
  });
});
