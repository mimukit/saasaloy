import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, repoModulesDir, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// The clean-tree rule of the render engine on the built binary (plan 0116, Phase 4,
// `SAASALOY_ENGINE=next`): `add` writes over a tree with an uncommitted new file, because
// a new file is not a file the run merges, and it refuses with exit 2 when the run must
// merge a file that has uncommitted changes.

const PROJECT = "next-app";
const ENV = {
  SAASALOY_ENGINE: "next",
  SAASALOY_REGISTRY_DIR: repoModulesDir(),
};

let workspace: string;
let project: string;

function cli(argv: string[]): Promise<CliRun> {
  return runCli(argv, { cwd: project, env: ENV });
}

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: project,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "e2e@example.com",
      GIT_AUTHOR_NAME: "e2e",
      GIT_COMMITTER_EMAIL: "e2e@example.com",
      GIT_COMMITTER_NAME: "e2e",
    },
  });
}

function assertCode(run: CliRun, code: number): void {
  if (run.code !== code) {
    throw new Error(
      `expected exit ${String(code)}, got ${String(run.code)}\n${run.output}`
    );
  }
}

beforeAll(async () => {
  await assertCliBuilt();
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-next-"));
  project = join(workspace, PROJECT);
  const init = await runCli(["init", PROJECT, "--no-install", "--no-git"], {
    cwd: workspace,
    env: ENV,
  });
  assertCode(init, 0);
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
}, 120_000);

afterAll(async () => {
  await rm(workspace, { force: true, recursive: true });
});

describe("e2e — add on the render engine and the clean-tree rule", () => {
  it("init writes a version 2 manifest", async () => {
    const manifest = JSON.parse(
      await readFile(join(project, ".saasaloy/manifest.json"), "utf-8")
    ) as { version: number };
    expect(manifest.version).toBe(2);
  });

  it("adds over a tree with an uncommitted new file", async () => {
    await writeFile(join(project, "scratch.md"), "my notes\n", "utf-8");
    const run = await cli([
      "add",
      "waitlist",
      "--with",
      "database-postgres",
      "--yes",
    ]);
    assertCode(run, 0);
    await expect(readFile(join(project, "scratch.md"), "utf-8")).resolves.toBe(
      "my notes\n"
    );
    const lock = JSON.parse(
      await readFile(join(project, "saasaloy-lock.json"), "utf-8")
    ) as { requested: string[] };
    expect(lock.requested).toStrictEqual(["database-postgres", "waitlist"]);
    git("add", "-A");
    git("commit", "-q", "-m", "add waitlist");
  });

  it("refuses with exit 2 when the run must merge a file with uncommitted changes", async () => {
    const index = join(project, "apps/api/src/index.ts");
    await appendFile(index, "\n// mine, not committed\n", "utf-8");
    const before = await readFile(index, "utf-8");
    const run = await cli(["add", "feature-flags", "--yes"]);
    assertCode(run, 2);
    expect(run.output).toContain("apps/api/src/index.ts");
    await expect(readFile(index, "utf-8")).resolves.toBe(before);
    expect(git("status", "--porcelain")).not.toContain(
      "packages/feature-flags"
    );
  });
});
