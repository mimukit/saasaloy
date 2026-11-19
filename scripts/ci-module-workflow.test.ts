// The `ci` module's workflow, `modules/ci/files/workflows/ci.yml`, parsed as YAML. It
// guards the rules a project's deploy gate depends on (plan 0112, phase 4): a run on main
// is never cancelled, main gets its run from a push and every other branch from its pull
// request, the build runs after the tests, and every action is pinned to a commit SHA.
//
// Run it with `node --test scripts/ci-module-workflow.test.ts` or `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

const FILE = join(
  import.meta.dirname,
  "..",
  "modules/ci/files/workflows/ci.yml"
);
const TEXT = readFileSync(FILE, "utf-8");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${what} is not a mapping`);
  return value;
}

const workflow = record(parse(TEXT), "the workflow");
const jobs = record(workflow.jobs, "jobs");
const steps = Object.values(jobs).flatMap((job) => {
  const list = record(job, "a job").steps;
  assert.ok(Array.isArray(list), "a job has no steps list");
  return (list as unknown[]).map((step) => record(step, "a step"));
});

describe("modules/ci/files/workflows/ci.yml", () => {
  it("never cancels a run on main", () => {
    const concurrency = record(workflow.concurrency, "concurrency");
    // oxlint-disable-next-line no-template-curly-in-string -- a GitHub expression, not a template
    const expression = "${{ github.ref != 'refs/heads/main' }}";
    assert.equal(concurrency["cancel-in-progress"], expression);
  });

  it("gives each commit on main its own concurrency group", () => {
    // A shared group would let GitHub cancel a pending main run, whatever
    // `cancel-in-progress` says.
    const concurrency = record(workflow.concurrency, "concurrency");
    const group =
      // oxlint-disable-next-line no-template-curly-in-string -- a GitHub expression, not a template
      "ci-${{ github.ref == 'refs/heads/main' && github.sha || github.event.pull_request.number || github.ref }}";
    assert.equal(concurrency.group, group);
  });

  it("runs on a push to main only, and on every pull request", () => {
    const on = record(workflow.on, "on");
    assert.deepEqual(Object.keys(on).toSorted(), ["pull_request", "push"]);
    assert.deepEqual(record(on.push, "on.push").branches, ["main"]);
    assert.ok(on.pull_request === null || isRecord(on.pull_request));
    if (isRecord(on.pull_request)) {
      assert.equal(on.pull_request.branches, undefined);
    }
  });

  it("runs pnpm build after pnpm test", () => {
    const runs = steps.map((step) => step.run);
    const test = runs.indexOf("pnpm test");
    const build = runs.indexOf("pnpm build");
    assert.ok(test !== -1, "no `pnpm test` step");
    assert.ok(build > test, "`pnpm build` does not run after `pnpm test`");
  });

  it("pins every action to a 40-character commit SHA with a # vX.Y.Z comment", () => {
    const uses = steps.flatMap((step) =>
      typeof step.uses === "string" ? [step.uses] : []
    );
    assert.ok(uses.length > 0, "no `uses:` step");
    for (const action of uses) {
      assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, action);
    }
    // The comment is not part of the parsed value, so read it from the text.
    const lines = TEXT.split("\n").filter((line) =>
      /^\s*-?\s*uses:/.test(line)
    );
    assert.equal(lines.length, uses.length);
    for (const line of lines) {
      assert.match(line, /@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line);
    }
  });

  it("restores the Turborepo cache keyed by ref and SHA", () => {
    const cache = steps.find(
      (step) =>
        typeof step.uses === "string" && step.uses.startsWith("actions/cache@")
    );
    assert.ok(cache, "no actions/cache step");
    const options = record(cache.with, "the cache step's `with`");
    assert.equal(options.path, ".turbo/cache");
    assert.equal(typeof options.key, "string");
    const key = String(options.key);
    assert.match(key, /github\.head_ref \|\| github\.ref_name/);
    assert.match(key, /github\.sha/);
    const usesIndex = steps.indexOf(cache);
    const buildIndex = steps.findIndex((step) => step.run === "pnpm build");
    assert.ok(usesIndex < buildIndex, "the cache restore runs after the build");
  });
});
