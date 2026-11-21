import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, repoModulesDir, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// Plan 0119: `add` settles a `requiresOneOf` list with one option itself. `database`
// names one driver, so `add database` needs no `--with` and no question, also with no
// terminal. A list of two or more (`api-keys`) still refuses with no terminal. `runCli`
// closes stdin, so no prompt in this file can be answered.

const PROJECT = "single-option-app";

let workspace: string;
let project: string;
let initRun: CliRun;

function cli(argv: string[]): Promise<CliRun> {
  return runCli(argv, {
    cwd: project,
    env: { SAASALOY_REGISTRY_DIR: repoModulesDir() },
  });
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(project, name), "utf-8")) as T;
}

beforeAll(async () => {
  await assertCliBuilt();
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-single-"));
  project = join(workspace, PROJECT);
  initRun = await runCli(["init", PROJECT, "--no-install", "--no-git"], {
    cwd: workspace,
  });
}, 300_000);

afterAll(async () => {
  await rm(workspace, { force: true, recursive: true });
});

describe("e2e — add settles a one-option requirement (plan 0119)", () => {
  it("plans the driver in --dry-run --json with stdout one document", async () => {
    expect(initRun.code).toBe(0);
    const run = await cli(["add", "database", "--dry-run", "--json"]);
    expect(run.code).toBe(0);
    const plan = JSON.parse(run.stdout) as { prerequisites: string[] };
    expect(plan.prerequisites).toContain("database-postgres");
  });

  it("refuses a two-option list with no terminal", async () => {
    const run = await cli(["add", "api-keys", "--yes"]);
    expect(run.code).toBe(2);
    expect(run.output).toContain(
      "needs one of: api-keys-organization, api-keys-user"
    );
  });

  it("adds database and its one driver with --yes and no terminal", async () => {
    const run = await cli(["add", "database", "--yes"]);
    expect(run.output).toContain(
      "database needs database-postgres; adding it."
    );
    expect(run.code).toBe(0);

    const config = await readJson<{ installed: string[] }>("saasaloy.json");
    expect(config.installed).toContain("database");
    expect(config.installed).toContain("database-postgres");
    const lock = await readJson<{ requested: string[] }>("saasaloy-lock.json");
    expect(lock.requested).toStrictEqual(
      expect.arrayContaining(["database", "database-postgres"])
    );
  });
});
