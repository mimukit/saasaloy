import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { describeBuild, readBuildInfo } from "./docs-build-info.ts";
import type { GitFacts } from "./docs-build-info.ts";

const FACTS: GitFacts = {
  exactTag: undefined,
  latestTag: "v0.8.0",
  count: 12,
  shallow: false,
};

describe("describeBuild", () => {
  it("shows no banner at a v* tag", () => {
    assert.deepEqual(describeBuild("0.9.0", { ...FACTS, exactTag: "v0.9.0" }), {
      version: "0.9.0",
      banner: undefined,
    });
  });

  it("counts the commits after the latest tag", () => {
    assert.deepEqual(describeBuild("0.9.0", FACTS).banner, {
      tag: "v0.8.0",
      count: 12,
    });
  });

  it("keeps a count of zero", () => {
    assert.equal(
      describeBuild("0.9.0", { ...FACTS, count: 0 }).banner?.count,
      0
    );
  });

  it("drops the count in a shallow clone", () => {
    assert.deepEqual(
      describeBuild("0.9.0", { ...FACTS, shallow: true }).banner,
      {
        tag: "v0.8.0",
        count: undefined,
      }
    );
  });

  it("falls back to the package version when no tag is reachable", () => {
    assert.deepEqual(
      describeBuild("0.9.0", {
        exactTag: undefined,
        latestTag: undefined,
        count: undefined,
        shallow: true,
      }).banner,
      { tag: "v0.9.0", count: undefined }
    );
  });
});

describe("readBuildInfo", () => {
  it("counts commits in a real repository and clears the banner at a tag", () => {
    const dir = mkdtempSync(join(tmpdir(), "saasaloy-build-info-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: dir, stdio: "pipe" });
      git("init", "--quiet", "--initial-branch=main");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      git("config", "commit.gpgsign", "false");
      git("config", "tag.gpgsign", "false");
      const commit = (name: string) => {
        writeFileSync(join(dir, name), name);
        git("add", "-A");
        git("commit", "--quiet", "-m", name);
      };
      commit("a");
      git("tag", "v1.0.0");
      assert.equal(readBuildInfo(dir, "1.0.0").banner, undefined);
      commit("b");
      commit("c");
      assert.deepEqual(readBuildInfo(dir, "1.0.0").banner, {
        tag: "v1.0.0",
        count: 2,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
