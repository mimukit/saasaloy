import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, repoModulesDir, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// #233: several modules in one `add` run, on the built binary, against this repo's own
// `modules/`. The order of the cases matters: the refusals run on an empty project, and
// the second apply reads the state the first one left.

const PROJECT = "multi-app";

let workspace: string;
let project: string;

function cli(argv: string[]): Promise<CliRun> {
  return runCli(argv, {
    cwd: project,
    env: { SAASALOY_REGISTRY_DIR: repoModulesDir() },
  });
}

/** Fail with the run's whole output, which a bare exit-code assertion would hide. */
function assertOk(run: CliRun): void {
  if (run.code !== 0) {
    throw new Error(`exit ${run.code}\n${run.output}`);
  }
}

function gitStatus(): string {
  return execFileSync("git", ["status", "--short"], {
    cwd: project,
    encoding: "utf-8",
  });
}

beforeAll(async () => {
  await assertCliBuilt();
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-multi-"));
  project = join(workspace, PROJECT);
  const init = await runCli(["init", PROJECT, "--no-install", "--no-git"], {
    cwd: workspace,
  });
  assertOk(init);
  execFileSync("git", ["init", "--quiet"], { cwd: project });
}, 120_000);

afterAll(async () => {
  await rm(workspace, { force: true, recursive: true });
});

describe("e2e — several modules in one add run (#233)", () => {
  it("refuses two conflicting drivers before the first write", async () => {
    const before = gitStatus();

    const run = await cli(["add", "database-d1", "database-postgres", "--yes"]);

    expect(run.code).toBe(2);
    expect(run.output).toContain(
      "Cannot add database-d1 and database-postgres — module conflict"
    );
    expect(gitStatus()).toBe(before);
  });

  it("lists every named module in argv order in the --dry-run --json plan", async () => {
    const run = await cli([
      "add",
      "waitlist",
      "teams",
      "--with",
      "database-d1",
      "--dry-run",
      "--json",
    ]);

    assertOk(run);
    const doc = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(doc).toMatchObject({
      requested: ["waitlist", "teams"],
      schemaVersion: 2,
    });
    expect(doc.install).toStrictEqual(
      expect.arrayContaining(["waitlist", "teams", "database-d1"])
    );
  });

  it("adds two modules and their prerequisites in one run", async () => {
    const run = await cli([
      "add",
      "admin",
      "teams",
      "--with",
      "database-d1",
      "--yes",
    ]);

    assertOk(run);
    const applied = /Applied (.+) \(/.exec(run.output)?.[1] ?? "";
    expect(applied).toContain("admin");
    expect(applied).toContain("teams");

    const listed = JSON.parse(
      (await cli(["list", "--installed", "--json"])).stdout
    ) as { modules: { name: string }[] };
    const names = listed.modules.map((module) => module.name);
    expect(names).toStrictEqual(
      expect.arrayContaining(["admin", "teams", "auth", "database-d1"])
    );
  });

  it("says there is nothing to do when the same set runs again", async () => {
    const run = await cli(["add", "admin", "teams", "--yes"]);

    assertOk(run);
    expect(run.output).toContain("Nothing to do");
  });
});
