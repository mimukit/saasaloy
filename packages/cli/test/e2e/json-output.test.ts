import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH_KINDS } from "../../src/lib/patch/index.js";
import { assertCliBuilt, repoModulesDir, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// #223: `--json` on the built binary, against this repo's own `modules/`. Each run's
// stdout has to parse as one document, which is the proof that the TUI went to stderr:
// one stray clack line on stdout fails `JSON.parse`.

const PROJECT = "json-app";

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

function parsed(run: CliRun): Record<string, unknown> {
  return JSON.parse(run.stdout) as Record<string, unknown>;
}

/**
 * The human plan with the note borders and every space and line break removed. A long
 * target wraps inside its box, so the plain text cannot be searched line by line; with
 * the layout gone, `create` + target is one unbroken string whatever the width was.
 */
function collapse(text: string): string {
  return text.replaceAll(/[│┌┐└┘├┤─◇◆■●○◒◐◓◑▲]/g, "").replaceAll(/\s+/g, "");
}

interface PlanFile {
  action: string;
  target: string;
}

interface PlanPatch {
  action: string;
  file: string;
  kind: string;
}

beforeAll(async () => {
  await assertCliBuilt();
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-json-"));
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

describe("e2e — --json (#223)", () => {
  it("lists every module with its descriptor fields, none installed yet", async () => {
    const run = await cli(["list", "--json"]);

    assertOk(run);
    const doc = parsed(run);
    expect(doc.schemaVersion).toBe(1);
    const modules = doc.modules as Record<string, unknown>[];
    expect(modules.length).toBeGreaterThan(40);
    for (const module of modules) {
      expect(Object.keys(module).toSorted()).toStrictEqual([
        "conflictsWith",
        "dependsOn",
        "description",
        "envVars",
        "installed",
        "name",
        "needs",
        "requiresOneOf",
        "skill",
        "stage",
        "tier",
      ]);
      expect(module.installed).toBeFalsy();
    }
    expect(run.stderr).toContain("saasaloy list");
  });

  it("puts every file and patch of the human plan into the --dry-run --json plan", async () => {
    const argv = ["add", "waitlist", "--with", "database-d1", "--dry-run"];
    const human = await cli(argv);
    const json = await cli([...argv, "--json"]);

    assertOk(human);
    assertOk(json);
    const doc = parsed(json);
    expect(doc).toMatchObject({ requested: "waitlist", schemaVersion: 1 });
    expect(doc.install).toContain("database-d1");

    const files = doc.files as PlanFile[];
    const patches = doc.patches as PlanPatch[];
    const text = collapse(human.stdout);

    // Every file line the human plan prints, by action and target, and the count it
    // closes with: so nothing in the plan is missing from the document, either way.
    const counts = /(\d+)file\(s\)toapply,(\d+)needingmerge/.exec(text);
    expect(counts).not.toBeNull();
    expect(files).toHaveLength(Number(counts?.[1]) + Number(counts?.[2]));
    const missingFiles = files.filter(
      (file) => !text.includes(collapse(`${file.action}  ${file.target}`))
    );
    expect(missingFiles).toStrictEqual([]);

    // The human "Config patches" box lists each applied patch as `file — kind`.
    const applied = patches.filter((patch) => patch.action === "apply");
    expect(applied.length).toBeGreaterThan(0);
    const missingPatches = applied.filter(
      (patch) => !text.includes(collapse(`${patch.file} — ${patch.kind}`))
    );
    expect(missingPatches).toStrictEqual([]);
    const kinds = new RegExp(`— (${PATCH_KINDS.join("|")})\\b`, "g");
    expect(human.stdout.match(kinds) ?? []).toHaveLength(applied.length);

    // A dry run writes nothing, so the project still has no module installed.
    const listed = parsed(await cli(["list", "--installed", "--json"]));
    expect(listed.modules).toStrictEqual([]);
  });

  it("lists only the installed modules under --installed --json", async () => {
    const add = await cli(["add", "database-d1", "--yes"]);
    assertOk(add);

    const run = await cli(["list", "--installed", "--json"]);

    assertOk(run);
    const modules = parsed(run).modules as {
      name: string;
      installed: boolean;
    }[];
    expect(modules.map((m) => m.name).toSorted()).toStrictEqual([
      "api",
      "database",
      "database-d1",
      "logger",
      "logger-console",
    ]);
    expect(modules.every((m) => m.installed)).toBeTruthy();
  });

  it("plans `add waitlist --dry-run --json` once the driver is installed", async () => {
    const run = await cli(["add", "waitlist", "--dry-run", "--json"]);

    assertOk(run);
    const doc = parsed(run);
    expect(doc.install).toContain("waitlist");
    // The installed driver answers `database`'s choice, so no `--with` is needed and
    // the driver is not planned again.
    expect(doc.alreadyInstalled).toContain("database");
    expect(doc.install).not.toContain("database-d1");
    expect((doc.files as PlanFile[]).length).toBeGreaterThan(0);
  });

  it("refuses `add --json` without --dry-run, with an error document and exit 2", async () => {
    const run = await cli(["add", "waitlist", "--json", "--yes"]);

    expect(run.code).toBe(2);
    expect(parsed(run)).toMatchObject({
      error: {
        exitCode: 2,
        message: expect.stringContaining("--dry-run --json"),
      },
      schemaVersion: 1,
    });
  });

  it("prints doctor, outdated and env --check as documents", async () => {
    const doctor = await cli(["doctor", "--json"]);
    const outdated = await cli(["outdated", "--json"]);
    const env = await cli(["env", "--check", "--json"]);

    expect(parsed(doctor)).toMatchObject({ mode: "project", schemaVersion: 1 });
    expect(doctor.code).toBe(parsed(doctor).problems === 0 ? 0 : 2);
    assertOk(outdated);
    expect(parsed(outdated)).toMatchObject({ drift: 0, schemaVersion: 1 });
    const envDoc = parsed(env);
    expect(envDoc.schemaVersion).toBe(1);
    expect(env.code).toBe((envDoc.missing as string[]).length > 0 ? 2 : 0);
  });

  it("refuses `env --json` without --check", async () => {
    const run = await cli(["env", "--json"]);

    expect(run.code).toBe(2);
    expect(parsed(run)).toHaveProperty("error");
  });
});
