import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";

import { hasModule, readConfig, ROOT } from "./lib/project.ts";

// Everything that has to be true BEFORE Playwright starts a single process: the browser is
// downloaded, and the project has a migrated development database.
//
// This runs from the `e2e` script (`node prepare-db.ts && playwright test`) rather than
// from a `globalSetup` hook, and the reason is ordering. Playwright starts `webServer`
// around the global hooks, and the api Worker reads `apps/api/.dev.vars` when it boots — a
// `DATABASE_URL` written after that is a value the Worker never sees. Running here makes
// the order a fact rather than an assumption.
//
// Seeding the fixture user is the other half and lives in `auth.setup.ts`, because that one
// needs the api answering and so has to run after `webServer`, not before it.

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
 * The database name the project's own scripts settled on, read back out of
 * `apps/api/.dev.vars`.
 *
 * This is the guard. `db:setup` already refuses a `DATABASE_URL` whose state block does not
 * vouch for it, which is what stops the suite reaching a database somebody else owns. Read
 * the result and check it still looks like one this project manages, so a future change to
 * that script cannot quietly hand the suite a production URL.
 */
function resolvedDatabase(): string | undefined {
  const file = path.resolve(ROOT, "apps/api/.dev.vars");
  if (!existsSync(file)) {
    return undefined;
  }
  const line = readFileSync(file, "utf-8")
    .split("\n")
    .findLast((candidate) => candidate.startsWith("DATABASE_URL="));
  if (!line) {
    return undefined;
  }
  const url = line
    .slice("DATABASE_URL=".length)
    .trim()
    .replaceAll(/^["']|["']$/g, "");
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return undefined;
  }
}

/** The name `db:setup` would give this checkout: the project name, lowercased and safe. */
function expectedPrefix(): string {
  const pkg = JSON.parse(
    readFileSync(path.resolve(ROOT, "package.json"), "utf-8")
  ) as { name?: string };
  return (pkg.name ?? "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "");
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

function setUpDatabase(): void {
  const args = ["db:setup", ...extraSetupArgs()];
  say(`Setting up the development database (pnpm ${args.join(" ")}).`);
  const result = spawnSync("pnpm", args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    refuse("pnpm db:setup failed. Fix the cause, then run pnpm e2e again.");
  }

  // D1 keeps its database in `.wrangler/state` and names nothing, so there is no URL to
  // check. Only a URL-backed driver reaches the assertion below.
  const database = resolvedDatabase();
  if (!database) {
    return;
  }
  const prefix = expectedPrefix();
  if (prefix.length > 0 && !database.startsWith(prefix)) {
    refuse(
      `Refusing to run against "${database}". The e2e suite drops rows and expects a database this project manages (one starting with "${prefix}"). Run pnpm db:setup and check apps/api/.dev.vars.`
    );
  }
  say(`Database ${database} is ready.`);
}

/**
 * The api Worker's env file has to exist before the Worker boots.
 *
 * `saasaloy add` writes `.dev.vars.example` and stops, because the real file is gitignored
 * and holds secrets. Without it the `auth` module throws while the Worker initializes, and
 * Playwright reports only that `webServer` would not start. Say what is missing here
 * instead, where the fix is one command.
 */
function assertDevVars(): void {
  const file = path.resolve(ROOT, "apps/api/.dev.vars");
  if (existsSync(file)) {
    return;
  }
  refuse(
    "apps/api/.dev.vars does not exist, so the api Worker cannot start.\nRun: cp apps/api/.dev.vars.example apps/api/.dev.vars\nThe dev defaults in it are enough for this suite; BETTER_AUTH_URL naming a loopback host is what lets auth run without a secret."
  );
}

const config = readConfig();
assertChromium();
assertDevVars();
if (hasModule(config, "database")) {
  setUpDatabase();
} else {
  say("No database module installed, so there is nothing to migrate.");
}
