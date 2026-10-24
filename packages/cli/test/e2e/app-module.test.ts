import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, repoModulesDir, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// #227: the customer `app` module installs on a project that has no `admin`. `app`
// depends on `api`, `auth` and `shell`, never on `admin`, so the shell frame, the auth
// blocks and the app all arrive without the backoffice. The project is built from this
// repo's own `modules/`, with flags only, so no prompt can stop it.

const PROJECT = "app-only";

let workspace: string;
let project: string;
const steps: { argv: string[]; run: CliRun }[] = [];

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function read(path: string): Promise<string> {
  return readFile(join(project, path), "utf-8");
}

beforeAll(async () => {
  await assertCliBuilt();
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-e2e-app-"));
  project = join(workspace, PROJECT);

  const init = await runCli(["init", PROJECT, "--no-install", "--no-git"], {
    cwd: workspace,
  });
  steps.push({ argv: ["init", PROJECT], run: init });
  if (init.code !== 0) {
    return;
  }

  for (const argv of [
    ["add", "auth", "--with", "database-d1", "--yes"],
    ["add", "app", "--yes"],
  ]) {
    const run = await runCli(argv, {
      cwd: project,
      env: { SAASALOY_REGISTRY_DIR: repoModulesDir() },
    });
    steps.push({ argv, run });
    if (run.code !== 0) {
      return;
    }
  }
}, 300_000);

afterAll(async () => {
  await rm(workspace, { force: true, recursive: true });
});

describe("e2e — add app on a project with no admin (#227)", () => {
  it("exits 0 at every step", () => {
    const failed = steps
      .filter((s) => s.run.code !== 0)
      .map((s) => `${s.argv.join(" ")} → ${s.run.code}\n${s.run.output}`);
    expect(failed).toStrictEqual([]);
    expect(steps).toHaveLength(3);
  });

  it("installs app and shell, and not admin", async () => {
    const config = JSON.parse(await read("saasaloy.json")) as {
      installed: string[];
    };
    expect(config.installed).toContain("app");
    expect(config.installed).toContain("shell");
    expect(config.installed).not.toContain("admin");
  });

  it("scaffolds apps/app on port 3002 with the SPA fallback", async () => {
    await expect(read("apps/app/vite.config.ts")).resolves.toContain(
      "port: 3002, strictPort: true"
    );
    await expect(read("apps/app/wrangler.jsonc")).resolves.toContain(
      '"not_found_handling": "single-page-application"'
    );
    await expect(read("apps/app/package.json")).resolves.toContain(
      '"deploy": "env-deploy app"'
    );
  });

  it("writes the stylesheet and the auth blocks the routes import", async () => {
    await expect(
      exists(join(project, "packages/ui/src/styles/app.css"))
    ).resolves.toBeTruthy();
    await expect(
      exists(join(project, "packages/ui/src/blocks/auth/sign-in.tsx"))
    ).resolves.toBeTruthy();
    await expect(
      exists(join(project, "packages/ui/src/blocks/auth/sign-up.tsx"))
    ).resolves.toBeTruthy();
  });

  it("registers the app for env:setup and the deploy", async () => {
    await expect(read("packages/env/src/services.ts")).resolves.toContain(
      'name: "app"'
    );
    await expect(read("packages/tooling/src/targets.ts")).resolves.toContain(
      'service: "app"'
    );
    await expect(read("packages/env/.env.example")).resolves.toMatch(
      /# @services [a-z ]*\bapp\b/
    );
  });

  it("lets the app origin through CORS and auth in dev", async () => {
    await expect(read("apps/api/src/index.ts")).resolves.toContain(
      "http://localhost:3002"
    );
    await expect(read("packages/auth/src/auth.ts")).resolves.toContain(
      "http://localhost:3002"
    );
  });
});
