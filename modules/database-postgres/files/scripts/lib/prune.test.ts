// Tests for ./prune.ts. Repo-only, like ./branch-name.test.ts: the descriptor does not
// ship it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  branchDatabaseName,
  testDatabaseName,
  workerDatabaseName,
} from "./branch-name.ts";
import { looksForeign, planPrune, readRefs } from "./prune.ts";
import type { DatabaseInfo, PruneInput, SkipReason } from "./prune.ts";

const PREFIX = "app_dev";
const CLONE = "aaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbb";

function db(
  branch: string | undefined,
  options: {
    clone?: string;
    sessions?: number;
    test?: boolean;
    prefix?: string;
  } = {}
): DatabaseInfo {
  const dev = branch ? branchDatabaseName(PREFIX, branch) : PREFIX;
  const name = options.test ? testDatabaseName(dev) : dev;
  return {
    name,
    sessions: options.sessions ?? 0,
    ...(branch
      ? {
          mapping: {
            prefix: options.prefix ?? PREFIX,
            branch,
            worktree: `/w/${branch}`,
            clone: options.clone ?? CLONE,
          },
        }
      : {}),
  };
}

function input(over: Partial<PruneInput>): PruneInput {
  return {
    prefix: PREFIX,
    clone: CLONE,
    databases: [],
    localBranches: ["main"],
    remoteBranches: ["main"],
    mergedPr: () => "not merged",
    includeUnmapped: false,
    ...over,
  };
}

function reasons(
  plan: ReturnType<typeof planPrune>
): Record<string, SkipReason> {
  return Object.fromEntries(
    plan.skipped.map((skip) => [skip.database.name, skip.reason])
  );
}

describe("planPrune", () => {
  it("drops this clone's databases for a closed branch, test database included", () => {
    const plan = planPrune(
      input({ databases: [db("feat-b"), db("feat-b", { test: true })] })
    );
    assert.deepEqual(
      plan.candidates.map((d) => d.name),
      [
        branchDatabaseName(PREFIX, "feat-b"),
        testDatabaseName(branchDatabaseName(PREFIX, "feat-b")),
      ]
    );
    assert.deepEqual(plan.skipped, []);
  });

  it("never drops the default database or its test database: default", () => {
    const main = { name: PREFIX, sessions: 0 };
    const mainTest = { name: testDatabaseName(PREFIX), sessions: 0 };
    const plan = planPrune(input({ databases: [main, mainTest] }));
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(reasons(plan), {
      [PREFIX]: "default",
      [mainTest.name]: "default",
    });
  });

  it("keeps a branch that is still local or on a remote: branch open", () => {
    const plan = planPrune(
      input({
        databases: [db("feat-a"), db("feat-r")],
        localBranches: ["main", "feat-a"],
        remoteBranches: ["main", "feat-r"],
      })
    );
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(Object.values(reasons(plan)), [
      "branch open",
      "branch open",
    ]);
  });

  it("keeps another clone's database with no merged PR: foreign, no merged PR", () => {
    const asked: string[] = [];
    const plan = planPrune(
      input({
        databases: [db("feat-x", { clone: OTHER })],
        mergedPr: (branch) => {
          asked.push(branch);
          return "not merged";
        },
      })
    );
    assert.deepEqual(asked, ["feat-x"]);
    assert.deepEqual(Object.values(reasons(plan)), ["foreign, no merged PR"]);
  });

  it("keeps another clone's database when gh is missing: foreign, gh missing", () => {
    const plan = planPrune(
      input({
        databases: [db("feat-x", { clone: OTHER })],
        mergedPr: () => "gh missing",
      })
    );
    assert.deepEqual(Object.values(reasons(plan)), ["foreign, gh missing"]);
  });

  it("drops another clone's database once its PR merged", () => {
    const plan = planPrune(
      input({
        databases: [db("feat-x", { clone: OTHER })],
        mergedPr: () => "merged",
      })
    );
    assert.equal(plan.candidates.length, 1);
  });

  it("never asks gh about this clone's databases", () => {
    planPrune(
      input({
        databases: [db("feat-b")],
        mergedPr: () => assert.fail("gh asked about a database of this clone"),
      })
    );
  });

  it("keeps a database with no mapping: unmapped", () => {
    const plan = planPrune(
      input({
        databases: [{ name: branchDatabaseName(PREFIX, "old"), sessions: 0 }],
      })
    );
    assert.deepEqual(Object.values(reasons(plan)), ["unmapped"]);
  });

  it("judges an unmapped database by the refs with --include-unmapped", () => {
    const open = { name: branchDatabaseName(PREFIX, "feat-a"), sessions: 0 };
    const openTest = { name: testDatabaseName(open.name), sessions: 0 };
    const closed = { name: branchDatabaseName(PREFIX, "old"), sessions: 0 };
    const plan = planPrune(
      input({
        databases: [open, openTest, closed],
        localBranches: ["main", "feat-a"],
        includeUnmapped: true,
      })
    );
    assert.deepEqual(
      plan.candidates.map((d) => d.name),
      [closed.name]
    );
    assert.deepEqual(reasons(plan), {
      [open.name]: "branch open",
      [openTest.name]: "branch open",
    });
  });

  // `app_dev` also matches the names of a project whose prefix is `app_dev_tools_dev`.
  it("keeps a database another project mapped: other project", () => {
    const other = {
      name: "app_dev_tools_dev_feat_b",
      sessions: 0,
      mapping: {
        prefix: "app_dev_tools_dev",
        branch: "feat-b",
        worktree: "/w/tools",
        clone: CLONE,
      },
    };
    const plan = planPrune(
      input({ databases: [other], mergedPr: () => "merged" })
    );
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(Object.values(reasons(plan)), ["other project"]);
  });

  it("keeps an unmapped name of another project with --include-unmapped: other project", () => {
    const names = [
      "app_dev_tools_dev",
      "app_dev_tools_dev_test",
      "app_dev_tools_dev_feat_b",
    ];
    const plan = planPrune(
      input({
        databases: names.map((name) => ({ name, sessions: 0 })),
        includeUnmapped: true,
      })
    );
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(Object.values(reasons(plan)), [
      "other project",
      "other project",
      "other project",
    ]);
  });

  it("keeps a candidate with an open session: in use", () => {
    const plan = planPrune(
      input({ databases: [db("feat-b", { sessions: 1 })] })
    );
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(Object.values(reasons(plan)), ["in use"]);
  });
});

describe("planPrune: worker clones", () => {
  /** An unmapped worker clone of `base`, as `CREATE DATABASE ... TEMPLATE` leaves it. */
  function clone(
    base: DatabaseInfo,
    worker: number,
    sessions = 0
  ): DatabaseInfo {
    return { name: workerDatabaseName(base.name, worker), sessions };
  }

  it("keeps a clone while its test database is kept: base kept", () => {
    const test = db("feat-a", { test: true });
    const plan = planPrune(
      input({
        databases: [test, clone(test, 1), clone(test, 2)],
        localBranches: ["main", "feat-a"],
      })
    );
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(reasons(plan), {
      [test.name]: "branch open",
      [clone(test, 1).name]: "base kept",
      [clone(test, 2).name]: "base kept",
    });
  });

  it("keeps the clones of the default test database: base kept", () => {
    const mainTest = { name: testDatabaseName(PREFIX), sessions: 0 };
    const plan = planPrune(
      input({ databases: [mainTest, clone(mainTest, 1)] })
    );
    assert.deepEqual(plan.candidates, []);
    assert.equal(reasons(plan)[clone(mainTest, 1).name], "base kept");
  });

  it("drops a clone with its test database once the branch closes", () => {
    const test = db("feat-b", { test: true });
    const plan = planPrune(input({ databases: [clone(test, 1), test] }));
    assert.deepEqual(
      plan.candidates.map((d) => d.name),
      [test.name, clone(test, 1).name]
    );
  });

  it("drops a clone whose test database is gone, without --include-unmapped", () => {
    const test = db("feat-b", { test: true });
    const plan = planPrune(input({ databases: [clone(test, 3)] }));
    assert.deepEqual(
      plan.candidates.map((d) => d.name),
      [clone(test, 3).name]
    );
  });

  it("keeps a clone of a long test database while its base is kept", () => {
    const test = db(`feature-${"x".repeat(80)}`, { test: true });
    const plan = planPrune(
      input({
        databases: [test, clone(test, 2)],
        localBranches: ["main", `feature-${"x".repeat(80)}`],
      })
    );
    assert.equal(reasons(plan)[clone(test, 2).name], "base kept");
  });

  it("keeps a clone with an open session even when its base goes: in use", () => {
    const test = db("feat-b", { test: true });
    const plan = planPrune(input({ databases: [test, clone(test, 1, 1)] }));
    assert.deepEqual(
      plan.candidates.map((d) => d.name),
      [test.name]
    );
    assert.equal(reasons(plan)[clone(test, 1).name], "in use");
  });

  it("judges a mapped branch database whose name ends in _w<N> as a branch", () => {
    const branch = db("feat-w2");
    const plan = planPrune(
      input({ databases: [branch], localBranches: ["main", "feat-w2"] })
    );
    assert.deepEqual(reasons(plan), { [branch.name]: "branch open" });
  });
});

describe("looksForeign", () => {
  it("flags a dev segment after the prefix and nothing else", () => {
    assert.equal(looksForeign("app_dev", "app_dev_tools_dev"), true);
    assert.equal(
      looksForeign("app_dev", "app_dev_tools_dev_feat_a_test"),
      true
    );
    assert.equal(looksForeign("app_dev", "app_dev_feat_a"), false);
    assert.equal(looksForeign("app_dev", "app_dev_devices"), false);
    assert.equal(looksForeign("app_dev", "app_dev_issue_7_abcdef_test"), false);
    assert.equal(looksForeign("app_dev", "app_dev"), false);
  });
});

describe("readRefs", () => {
  it("splits local and remote names and drops the remote HEAD", () => {
    assert.deepEqual(
      readRefs([
        "refs/heads/main",
        "refs/heads/feat/a",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
        "refs/remotes/upstream/feat/b",
      ]),
      { local: ["main", "feat/a"], remote: ["main", "feat/b"] }
    );
  });
});
