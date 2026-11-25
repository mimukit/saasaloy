import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Command } from "./deploy-release.ts";
import {
  buildFailure,
  cleanupCommand,
  contentTag,
  runDeploy,
  siteDeployPlan,
  summary,
} from "./deploy-site.ts";

const SHA = "a3a4891c0123456789abcdef0123456789abcdef";
const TREE = "/tmp/saasaloy-site-x/site";

describe("contentTag", () => {
  it("maps the npm version to its tag", () => {
    assert.equal(contentTag("0.12.0"), "v0.12.0");
    assert.equal(contentTag("0.12.0\n"), "v0.12.0");
  });

  it("throws on an empty version", () => {
    assert.throws(() => contentTag(""), /stable release/);
  });

  it("throws on a prerelease version", () => {
    assert.throws(() => contentTag("0.13.0-beta.1"), /stable release/);
  });
});

describe("siteDeployPlan", () => {
  it("builds the site commit with the content of the tag, then deploys it", () => {
    assert.deepEqual(siteDeployPlan(SHA, "v0.12.0", TREE, false), [
      {
        name: "worktree",
        command: ["git", "worktree", "add", "--detach", TREE, SHA],
      },
      {
        name: "content",
        command: [
          "git",
          "-C",
          TREE,
          "checkout",
          "--no-overlay",
          "v0.12.0",
          "--",
          "docs/wiki",
          "modules",
          "packages/cli/package.json",
          "llms.txt",
        ],
      },
      {
        name: "install",
        command: [
          "pnpm",
          "-C",
          TREE,
          "install",
          "--frozen-lockfile",
          "--filter",
          "@saasaloy/web...",
        ],
      },
      {
        name: "build",
        command: [
          "pnpm",
          "-C",
          TREE,
          "--filter",
          "@saasaloy/web",
          "run",
          "build",
        ],
      },
      {
        name: "deploy",
        command: [
          "pnpm",
          "-C",
          TREE,
          "--filter",
          "@saasaloy/web",
          "exec",
          "wrangler",
          "deploy",
          "--tag",
          "site-a3a4891",
          "--message",
          "site a3a4891 with content v0.12.0",
        ],
      },
    ]);
  });

  it("passes --dry-run to wrangler only", () => {
    const plan = siteDeployPlan(SHA, "v0.12.0", TREE, true);
    const deploy = plan.at(-1)?.command ?? [];
    assert.equal(deploy.at(-1), "--dry-run");
    assert.equal(
      plan.filter((step) => step.command.includes("--dry-run")).length,
      1
    );
  });
});

describe("runDeploy", () => {
  const cleanup = cleanupCommand(TREE);

  function recorder(failOn?: string) {
    const ran: Command[] = [];
    const run = (command: Command): number => {
      ran.push(command);
      return command.includes(failOn ?? "\0") ? 1 : 0;
    };
    return { ran, run };
  }

  it("removes the worktree after a deploy", () => {
    assert.deepEqual(cleanup, ["git", "worktree", "remove", "--force", TREE]);
    const { ran, run } = recorder();
    const result = runDeploy(
      siteDeployPlan(SHA, "v0.12.0", TREE, true),
      cleanup,
      run
    );
    assert.equal(result.code, 0);
    assert.equal(result.failed, undefined);
    assert.equal(ran.length, 6);
    assert.deepEqual(ran.at(-1), cleanup);
  });

  it("stops at a failed build, names it, and still removes the worktree", () => {
    const { ran, run } = recorder("build");
    const result = runDeploy(
      siteDeployPlan(SHA, "v0.12.0", TREE, true),
      cleanup,
      run
    );
    assert.equal(result.code, 1);
    assert.equal(result.failed?.name, "build");
    assert.ok(!ran.some((command) => command.includes("wrangler")));
    assert.deepEqual(ran.at(-1), cleanup);
  });

  it("removes the worktree when a step throws", () => {
    const ran: Command[] = [];
    const run = (command: Command): number => {
      ran.push(command);
      if (command.includes("install")) {
        throw new Error("spawn failed");
      }
      return 0;
    };
    assert.throws(
      () => runDeploy(siteDeployPlan(SHA, "v0.12.0", TREE, true), cleanup, run),
      /spawn failed/
    );
    assert.deepEqual(ran.at(-1), cleanup);
  });
});

describe("messages", () => {
  it("prints the site commit, the content tag and the token state", () => {
    const lines = summary(SHA, "v0.12.0", false).join("\n");
    assert.match(lines, new RegExp(SHA));
    assert.match(lines, /content tag v0\.12\.0/);
    assert.match(lines, /PUBLIC_CF_ANALYTICS_TOKEN is not set/);
    assert.match(summary(SHA, "v0.12.0", true).join("\n"), /TOKEN is set/);
  });

  it("says a failed build waits for the next release", () => {
    const lines = buildFailure(SHA, "v0.12.0").join("\n");
    assert.match(lines, new RegExp(SHA));
    assert.match(lines, /v0\.12\.0/);
    assert.match(lines, /this change waits for the next release/);
  });
});
