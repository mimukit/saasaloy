import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, fixture, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// #242 Phase 2, through the built binary: a gated test file follows the project's testing
// mode, a module that says `enablesTesting` turns an `off` project on, and `remove` takes
// another module's file that only shipped because the removed module was there.
//
// The registry is a three-module fixture rather than the repo's `modules/`. The real
// `auth` pulls in `api`, `database` and a driver choice, and the real `e2e` does not
// declare `enablesTesting` yet (#245). The fixture keeps the run offline and fast while
// every command takes the same code path a real module would.

const REGISTRY = fixture("registry-testing");
const AUTH_TEST = join("apps", "api", "src", "routes", "auth.test.ts");
const AUTH_SPEC = join("apps", "e2e", "specs", "auth-sign-in.spec.ts");

let workspace: string;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function mode(project: string): Promise<string | undefined> {
  const config = JSON.parse(
    await readFile(join(project, "saasaloy.json"), "utf-8")
  ) as { testing?: { mode: string } };
  return config.testing?.mode;
}

function cli(project: string, argv: string[]): Promise<CliRun> {
  return runCli(argv, {
    cwd: project,
    env: { SAASALOY_REGISTRY_DIR: REGISTRY },
  });
}

async function scaffold(name: string): Promise<string> {
  const run = await runCli(
    ["init", name, "--no-install", "--no-git", "--testing=off"],
    { cwd: workspace }
  );
  if (run.code !== 0) {
    throw new Error(`init ${name} exited ${run.code}:\n${run.output}`);
  }
  return join(workspace, name);
}

/** A setup step that has to succeed; a failure names the command and its output. */
async function must(project: string, argv: string[]): Promise<void> {
  const run = await cli(project, argv);
  if (run.code !== 0) {
    throw new Error(`${argv.join(" ")} exited ${run.code}:\n${run.output}`);
  }
}

beforeAll(async () => {
  await assertCliBuilt();
  // Outside the pnpm workspace, as in apply.test.ts.
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-testing-"));
}, 120_000);

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("e2e — a gated test follows the testing mode (#242)", () => {
  let project: string;

  beforeAll(async () => {
    project = await scaffold("modes-app");
  }, 120_000);

  it("add auth with testing off writes no auth.test.ts", async () => {
    const run = await cli(project, ["add", "auth", "--yes"]);

    expect(run.code).toBe(0);
    await expect(
      exists(join(project, "apps", "api", "src", "routes", "auth.ts"))
    ).resolves.toBeTruthy();
    await expect(exists(join(project, AUTH_TEST))).resolves.toBeFalsy();
  });

  it("testing tests-after backfills auth.test.ts", async () => {
    const run = await cli(project, ["testing", "tests-after"]);

    expect(run.code).toBe(0);
    await expect(mode(project)).resolves.toBe("tests-after");
    await expect(exists(join(project, AUTH_TEST))).resolves.toBeTruthy();
  });

  it("testing off, then update, still holds auth.test.ts", async () => {
    expect((await cli(project, ["testing", "off"])).code).toBe(0);

    const run = await cli(project, ["update", "--yes", "--force"]);

    expect(run.code).toBe(0);
    await expect(mode(project)).resolves.toBe("off");
    await expect(exists(join(project, AUTH_TEST))).resolves.toBeTruthy();
  });
});

describe("e2e — enablesTesting and remove (#242)", () => {
  let project: string;

  beforeAll(async () => {
    project = await scaffold("enable-app");
    await must(project, ["add", "auth", "--yes"]);
  }, 120_000);

  it("adding an enablesTesting module to an off project sets tests-after and writes auth.test.ts", async () => {
    const run = await cli(project, ["add", "e2e", "--yes"]);

    expect(run.code).toBe(0);
    await expect(mode(project)).resolves.toBe("tests-after");
    await expect(exists(join(project, AUTH_TEST))).resolves.toBeTruthy();
    // The other gate: auth's journey spec names e2e, which just arrived.
    await expect(exists(join(project, AUTH_SPEC))).resolves.toBeTruthy();
  });

  it("removing the module a when.installed names deletes the gated file and keeps the mode", async () => {
    const run = await cli(project, ["remove", "e2e", "--yes"]);

    expect(run.code).toBe(0);
    await expect(exists(join(project, AUTH_SPEC))).resolves.toBeFalsy();
    await expect(exists(join(project, AUTH_TEST))).resolves.toBeTruthy();
    await expect(mode(project)).resolves.toBe("tests-after");
  });
});
