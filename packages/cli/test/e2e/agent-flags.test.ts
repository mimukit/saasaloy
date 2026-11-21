import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, repoModulesDir, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// #223: an agent drives every command with flags and no terminal. `runCli` closes stdin
// and pipes both output streams, so no prompt in this file can be answered: each step
// either has a flag that answers it or the test fails on the exit code. The project is
// built from this repo's own `modules/`, so the step list is the one the issue names.

const PROJECT = "agent-app";
const WAITLIST_ROUTE = "apps/api/src/routes/waitlist.ts";

let workspace: string;
let project: string;
const steps: { argv: string[]; run: CliRun }[] = [];

function cli(argv: string[]): Promise<CliRun> {
  return runCli(argv, {
    cwd: project,
    env: { SAASALOY_REGISTRY_DIR: repoModulesDir() },
  });
}

async function step(argv: string[]): Promise<CliRun> {
  const run = await cli(argv);
  steps.push({ argv, run });
  return run;
}

beforeAll(async () => {
  await assertCliBuilt();
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-agent-"));
  project = join(workspace, PROJECT);

  const init = await runCli(["init", PROJECT, "--no-install", "--no-git"], {
    cwd: workspace,
  });
  steps.push({
    argv: ["init", PROJECT, "--no-install", "--no-git"],
    run: init,
  });
  if (init.code !== 0) {
    return;
  }
  // `env` writes only into a file git ignores, so the project needs a repository.
  execFileSync("git", ["init", "--quiet"], { cwd: project });

  // `waitlist` first: on an empty project it is the module whose `database` needs a
  // driver, and `--with` is the flag that picks it. `auth` then finds the driver
  // installed, so it needs no `--with` of its own.
  for (const argv of [
    ["add", "waitlist", "--with", "database-postgres", "--yes"],
    ["add", "auth", "--yes"],
    ["add", "admin", "--yes"],
    ["add", "email", "--yes"],
    ["add", "email-console", "--yes"],
  ]) {
    const run = await step(argv);
    if (run.code !== 0) {
      return;
    }
  }
}, 300_000);

afterAll(async () => {
  await rm(workspace, { force: true, recursive: true });
});

describe("e2e — an agent builds a project with flags only (#223)", () => {
  it("exits 0 at every step", () => {
    const failed = steps
      .filter((s) => s.run.code !== 0)
      .map((s) => `${s.argv.join(" ")} → ${s.run.code}\n${s.run.output}`);
    expect(failed).toStrictEqual([]);
    expect(steps).toHaveLength(6);
  });

  it("lists every module in saasaloy.json", async () => {
    const config = JSON.parse(
      await readFile(join(project, "saasaloy.json"), "utf-8")
    ) as { installed: string[] };
    for (const name of [
      "admin",
      "api",
      "auth",
      "database",
      "database-postgres",
      "email",
      "email-console",
      "waitlist",
    ]) {
      expect(config.installed).toContain(name);
    }
  });

  it("refuses a --with module that answers no requirement", async () => {
    const run = await cli(["add", "validators", "--with", "email", "--yes"]);
    expect(run.code).toBe(2);
    expect(run.output).toContain("--with email answers no unmet requirement");
  });
});

describe("e2e — env --from-file and --set (#223)", () => {
  it("writes packages/env/.env from a file and a flag, with no prompt", async () => {
    await writeFile(
      join(workspace, "values.env"),
      "# from the vault\nBETTER_AUTH_SECRET=from-file\nEMAIL_FROM=hello@example.com\n",
      "utf-8"
    );

    const run = await cli([
      "env",
      "--from-file",
      join(workspace, "values.env"),
      "--set",
      "BETTER_AUTH_SECRET=from-flag",
    ]);

    expect(run.code).toBe(0);
    const env = await readFile(join(project, "packages/env/.env"), "utf-8");
    expect(env).toContain("BETTER_AUTH_SECRET=from-flag");
    expect(env).toContain("EMAIL_FROM=hello@example.com");
    expect(env).not.toContain("from-file");
  });

  it("refuses a key no installed module declares and writes nothing", async () => {
    const before = await readFile(join(project, "packages/env/.env"), "utf-8");

    const run = await cli(["env", "--set", "NOT_A_DECLARED_KEY=x"]);

    expect(run.code).toBe(2);
    expect(run.output).toContain("NOT_A_DECLARED_KEY");
    await expect(
      readFile(join(project, "packages/env/.env"), "utf-8")
    ).resolves.toBe(before);
  });
});

describe("e2e — update with flags only (#223, #365)", () => {
  it("keeps an edited file the release did not change, and exits 0", async () => {
    const route = join(project, ...WAITLIST_ROUTE.split("/"));
    const edited = `${await readFile(route, "utf-8")}\n// edited by hand\n`;
    await writeFile(route, edited, "utf-8");

    // `--force`: the project's files are all uncommitted, which `update` refuses.
    const run = await cli(["update", "--yes", "--force"]);
    expect(run.code).toBe(0);
    await expect(readFile(route, "utf-8")).resolves.toBe(edited);
  });

  it("refuses a module name, because one update moves every module", async () => {
    const run = await cli(["update", "waitlist", "--yes", "--force"]);
    expect(run.code).toBe(2);
    expect(run.output).toContain("update takes no module name");
  });

  it("refuses the flags of the old engine", async () => {
    const run = await cli([
      "update",
      "--resolved",
      WAITLIST_ROUTE,
      "--yes",
      "--force",
    ]);
    expect(run.code).toBe(2);
  });
});
