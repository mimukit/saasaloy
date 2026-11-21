import {
  lstat,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, fixture, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// The whole CLI, spawned as a subprocess against a temp project outside the workspace:
// `init` scaffolds, `add` applies, and every assertion reads an artifact off disk rather
// than a line of log output. Log text is what a refactor changes; the files are the
// contract.

const REGISTRY = fixture("registry-clean");
const PROJECT = "e2e-app";

let workspace: string;
let project: string;
let scaffold: CliRun;

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function add(args: string[]): Promise<CliRun> {
  return runCli(["add", ...args], {
    cwd: project,
    env: { SAASALOY_REGISTRY_DIR: REGISTRY },
  });
}

beforeAll(async () => {
  await assertCliBuilt();
  // Outside the pnpm workspace on purpose: a temp dir under the repo would inherit the
  // workspace's own node_modules and pnpm-workspace.yaml.
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-"));
  project = join(workspace, PROJECT);

  scaffold = await runCli(["init", PROJECT, "--no-install", "--no-git"], {
    cwd: workspace,
  });
}, 120_000);

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("e2e — init scaffolds a project the binary can then add into", () => {
  it("exits 0", () => {
    expect(scaffold.code).toBe(0);
  });

  it("writes the project marker", async () => {
    await expect(exists(join(project, "saasaloy.json"))).resolves.toBeTruthy();
  });

  it("ships the workspaces the base template declares", async () => {
    await expect(
      exists(join(project, "apps", "web", "package.json"))
    ).resolves.toBeTruthy();
    await expect(
      exists(join(project, "packages", "ui", "package.json"))
    ).resolves.toBeTruthy();
  });

  it("names the project in the root package.json", async () => {
    const pkg = await json<{ name: string }>(join(project, "package.json"));

    expect(pkg.name).toBe(PROJECT);
  });
});

describe("e2e — a preview writes nothing", () => {
  // `init` already wrote the manifest and the lock, so a preview must leave their bytes.
  async function state(): Promise<string> {
    return [
      await readFile(join(project, ".saasaloy", "manifest.json"), "utf-8"),
      await readFile(join(project, "saasaloy-lock.json"), "utf-8"),
    ].join("\n");
  }

  it("--dry-run leaves the project exactly as it was", async () => {
    const before = await state();
    const run = await add(["beta", "--dry-run"]);

    expect(run.code).toBe(0);
    await expect(state()).resolves.toBe(before);
    await expect(exists(join(project, "apps", "api"))).resolves.toBeFalsy();
  });

  it("--diff leaves the project exactly as it was", async () => {
    const before = await state();
    const run = await add(["beta", "--diff"]);

    expect(run.code).toBe(0);
    await expect(state()).resolves.toBe(before);
    await expect(exists(join(project, "apps", "api"))).resolves.toBeFalsy();
  });

  it("still shows the plan it would have applied", async () => {
    const run = await add(["beta", "--dry-run"]);

    // alpha's scaffold file and beta's own file, so the prerequisite is in the plan.
    expect(run.output).toContain("apps/api/src/index.ts");
    expect(run.output).toContain("apps/api/src/beta.ts");
  });
});

describe("e2e — add writes the artifacts a project is made of", () => {
  let applied: CliRun;

  beforeAll(async () => {
    applied = await add(["beta", "--yes"]);
  }, 120_000);

  it("exits 0", () => {
    expect(applied.code).toBe(0);
  });

  it("installs the prerequisite and records only the module asked for", async () => {
    const lock = await json<{
      modules: Record<string, unknown>;
      requested: string[];
    }>(join(project, "saasaloy-lock.json"));

    expect(applied.output).toContain("Applied alpha, beta");
    expect(Object.keys(lock.modules).toSorted()).toStrictEqual([
      "alpha",
      "beta",
    ]);
    expect(lock.requested).toStrictEqual(["beta"]);
  });

  it("copies a scaffold's files to its workspace root", async () => {
    await expect(
      readFile(join(project, "apps", "api", "src", "index.ts"), "utf-8")
    ).resolves.toContain("alpha");
  });

  it("copies a file to the alias its scaffold registered", async () => {
    await expect(
      readFile(join(project, "apps", "api", "src", "beta.ts"), "utf-8")
    ).resolves.toContain("beta");
  });

  it("registers the scaffold's alias in saasaloy.json", async () => {
    const config = await json<{
      aliases: Record<string, string>;
      installed: string[];
    }>(join(project, "saasaloy.json"));

    expect(config.aliases["@api"]).toBe("apps/api/src");
    expect(config.installed.toSorted()).toStrictEqual(["alpha", "beta"]);
  });

  it("records every written file in the manifest, with a content hash", async () => {
    const manifest = await json<{
      version: number;
      files: Record<string, { module: string; hash: string; class: string }>;
    }>(join(project, ".saasaloy", "manifest.json"));

    const entry = manifest.files["apps/api/src/beta.ts"];
    expect(manifest.version).toBe(2);
    expect(entry?.module).toBe("beta");
    expect(entry?.class).toBe("merged");
    expect(entry?.hash).toMatch(/^[\da-f]{64}$/);
  });

  it("records the provenance of every module in the lockfile", async () => {
    const lock = await json<{
      lockfileVersion: number;
      modules: Record<string, { source: string; resolved: string }>;
    }>(join(project, "saasaloy-lock.json"));

    expect(lock.lockfileVersion).toBe(1);
    // A SAASALOY_REGISTRY_DIR install has no commit identity to pin to.
    expect(lock.modules.beta).toMatchObject({
      resolved: "local",
      source: "local",
    });
  });

  it("copies the module's skill folder and links it for Claude Code (ADR 0015)", async () => {
    const real = join(
      project,
      ".agents",
      "skills",
      "saasaloy-beta",
      "SKILL.md"
    );
    const link = join(project, ".claude", "skills", "saasaloy-beta");

    await expect(readFile(real, "utf-8")).resolves.toContain("saasaloy-beta");
    await expect(readlink(link)).resolves.toContain("saasaloy-beta");
  });

  it("merges the module's npm deps into the root package.json", async () => {
    const pkg = await json<{ dependencies?: Record<string, string> }>(
      join(project, "package.json")
    );

    expect(pkg.dependencies?.zod).toBe("4.4.3");
  });

  it("writes the env vars the module declared into the key list", async () => {
    // One tracked key list for every service (ADR 0039).
    const example = await readFile(
      join(project, "packages", "env", ".env.example"),
      "utf-8"
    );

    expect(example).toContain("BETA_URL");
  });
});

describe("e2e — re-running is idempotent", () => {
  it("says there is nothing to do and changes no file", async () => {
    const before = await readFile(
      join(project, "apps", "api", "src", "beta.ts"),
      "utf-8"
    );
    const manifestBefore = await readFile(
      join(project, ".saasaloy", "manifest.json"),
      "utf-8"
    );

    const run = await add(["beta", "--yes"]);

    expect(run.code).toBe(0);
    expect(run.output).toContain("Nothing to do");
    await expect(
      readFile(join(project, "apps", "api", "src", "beta.ts"), "utf-8")
    ).resolves.toBe(before);
    await expect(
      readFile(join(project, ".saasaloy", "manifest.json"), "utf-8")
    ).resolves.toBe(manifestBefore);
  });

  it("re-applies the same bytes under --force", async () => {
    const before = await readFile(
      join(project, "apps", "api", "src", "beta.ts"),
      "utf-8"
    );

    const run = await add(["beta", "--force", "--yes"]);

    expect(run.code).toBe(0);
    await expect(
      readFile(join(project, "apps", "api", "src", "beta.ts"), "utf-8")
    ).resolves.toBe(before);
  });
});

describe("e2e — a hand-edited file is kept, not clobbered", () => {
  const edited = "export const beta = 999; // mine\n";

  it("keeps the edit under --force, because the release did not change the file", async () => {
    const target = join(project, "apps", "api", "src", "beta.ts");
    await writeFile(target, edited, "utf-8");

    const run = await add(["beta", "--force", "--yes"]);

    expect(run.code).toBe(0);
    expect(run.output).toContain("No file changes");
    await expect(readFile(target, "utf-8")).resolves.toBe(edited);
  });
});

describe("e2e — the binary's own surface", () => {
  it("reports an unknown command rather than doing something else", async () => {
    const run = await runCli(["nope"], { cwd: project });

    expect(run.code).toBe(2);
    expect(run.output).toContain("nope");
  });

  it("prints help with a zero exit", async () => {
    const run = await runCli(["--help"], { cwd: project });

    expect(run.code).toBe(0);
    expect(run.output).toContain("saasaloy");
    expect(run.output).toContain("doctor");
  });

  it("prints its version", async () => {
    const run = await runCli(["--version"], { cwd: project });

    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("finds the schemas it ships, from a project directory", async () => {
    // `doctor` compiles registry-item.schema.json out of the packaged `schemas/` dir. A
    // release that dropped it from `files` fails here rather than on a user's machine.
    const run = await runCli(["doctor", REGISTRY], { cwd: project });

    expect(run.code).toBe(0);
    expect(run.output).toContain("No problems found.");
  });

  it("refuses a broken registry with the refusal code", async () => {
    const run = await runCli(["doctor", fixture("registry-broken")], {
      cwd: project,
    });

    expect(run.code).toBe(2);
  });

  it("finds the project root from a subdirectory, like git", async () => {
    const run = await runCli(["list"], {
      cwd: join(project, "apps", "api"),
      env: { SAASALOY_REGISTRY_DIR: REGISTRY },
    });

    expect(run.code).toBe(0);
    expect(run.output).toContain("installed");
  });
});
