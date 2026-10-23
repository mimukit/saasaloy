import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";

import { hasModule, installedApps, readConfig, ROOT } from "./lib/project.ts";

// Everything that has to be true BEFORE Playwright starts a single process: the browser is
// downloaded, every app has its `.env`, and the project has a migrated, seeded development
// database.
//
// This runs from the `e2e` script (`node prepare.ts && playwright test`) rather than from a
// `globalSetup` hook, and the reason is ordering. Playwright starts `webServer` around the
// global hooks, and the api Worker reads `apps/api/.env` when it boots — a `DATABASE_URL`
// written after that is a value the Worker never sees. Running here makes the order a fact
// rather than an assumption.

function say(message: string): void {
  console.log(message);
}

/** Fail with one line a developer can act on. No stack: every refusal here is a message. */
function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The browser this suite drives. Absent until someone runs `pnpm e2e:install`. */
function assertChromium(): void {
  let executable: string;
  try {
    executable = chromium.executablePath();
  } catch {
    refuse("Chromium is not installed. Run: pnpm e2e:install");
  }
  if (!existsSync(executable)) {
    refuse(
      `Chromium is not installed at ${executable}. Run: pnpm e2e:install\n(On a bare CI image the system libraries are missing too; there, run: pnpm --filter @repo/e2e exec playwright install --with-deps chromium)`
    );
  }
}

/**
 * Every app this run starts has to find its `.env` when it boots.
 *
 * `pnpm env:setup` writes those files from `packages/env/.env`, and nothing writes them on
 * `pnpm install`. Without one, the app's `createEnv` gate throws on the first request and
 * Playwright reports only that `webServer` never answered. Say what is missing here instead,
 * where the fix is one command.
 */
function assertEnvFiles(apps: readonly string[]): void {
  const missing = apps
    .map((app) => `apps/${app}/.env`)
    .filter((file) => !existsSync(path.resolve(ROOT, file)));
  if (missing.length === 0) {
    return;
  }
  const values = existsSync(path.resolve(ROOT, "packages/env/.env"))
    ? ""
    : "\npackages/env/.env does not exist either. Run saasaloy env first, or copy packages/env/.env.example to it: the local defaults are enough for this suite.";
  refuse(
    `${missing.join(", ")} ${missing.length === 1 ? "does" : "do"} not exist, so the apps cannot start.\nRun: pnpm env:setup${values}`
  );
}

/**
 * Extra flags for `db:setup`, from `E2E_DB_SETUP_ARGS`.
 *
 * The seam exists for CI. A developer's `db:setup` picks its own backend and remembers it,
 * so nothing is set here locally; a runner with a Postgres service container needs
 * `--server` to create the project's database on that server rather than starting a
 * container of its own.
 */
function extraSetupArgs(): string[] {
  return (process.env.E2E_DB_SETUP_ARGS ?? "").split(" ").filter(Boolean);
}

function pnpm(args: readonly string[]): void {
  say(`\n> pnpm ${args.join(" ")}`);
  const result = spawnSync("pnpm", args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    refuse(
      `pnpm ${args[0] ?? ""} failed. Fix the cause, then run pnpm e2e again.`
    );
  }
}

/**
 * Migrate, then seed. Both commands belong to the installed database driver, so the suite
 * runs the same under `database-d1` and `database-postgres` and carries no second path.
 *
 * Both also carry the guard. `db:setup` refuses a `DATABASE_URL` its state block does not
 * vouch for, and `db:seed` refuses `NODE_ENV=production` and any database that is not this
 * project's own `<prefix>` or `<prefix>_<branch>`, before it opens a connection. The suite
 * adds no check of its own on top: the seed's is the same check, made where the database is
 * written.
 *
 * The seed is what gives the admin specs an account. It upserts every slice row, so the
 * seeded superadmin is back to its known password on every run, and rows a spec wrote
 * before are left alone.
 */
function prepareDatabase(): void {
  pnpm(["db:setup", ...extraSetupArgs()]);
  pnpm(["db:seed"]);
}

const config = readConfig();
assertChromium();
assertEnvFiles(installedApps(config));
if (hasModule(config, "database")) {
  prepareDatabase();
} else {
  say("No database module installed, so there is nothing to migrate or seed.");
}
