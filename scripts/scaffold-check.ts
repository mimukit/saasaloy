// The `scaffold` job in ci.yml, as a script, so it runs the same on a laptop (issue #347).
//
// The repo's own gate lints and tests the template's files one by one, but a file only
// meets its neighbours inside a project: the type-aware lint pass, the imports between
// workspaces, a module's route tests. Research 0011 found a fresh scaffold from `main`
// failing `pnpm check` with 44 type-aware lint errors that every repo check had passed.
// This script builds that project on every push and runs its `pnpm check`.
//
// It follows the steps an agent's build takes (the `saasaloy-build` skill), with the
// locally built CLI and the repo's own `modules/` as the registry:
//
//   1. build the CLI;
//   2. `saasaloy init` with testing on, which installs, writes the env files and makes
//      the git repository;
//   3. `saasaloy add` the Validate and MVP modules on `database-postgres`, in one call;
//   4. install, generate the migrations, set up the database, write the env files,
//      filling each key with no default the way the build skill does;
//   5. `pnpm check`: typecheck, lint, test and build.
//
// The database is Postgres. With `SCAFFOLD_DATABASE_SERVER` set to a connection string
// with CREATEDB rights, `db:setup --server` creates the project's database on that server;
// CI sets it to its `postgres:18` service container. Unset or empty, `db:setup` starts the
// project's own `compose.yaml` container, so a laptop needs a Docker daemon, and a green
// run stops that container and deletes its volume.
//
// The installs need the npm registry; the CLI steps run offline. The scaffold lands in
// `.dev/scaffold-check/`, and a green run deletes it unless `--keep` is passed. A red run
// keeps it, so the failure can be read in place.
//
// Imports nothing but node: builtins, the smoke script's env helpers and the e2e script's
// `DATABASE_URL` writer. Node 24 strips the
// types, so there is no build step; `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { localEnvValue, missingEnvKeys } from "./release-smoke.ts";
import { withDatabaseUrl } from "./verify-e2e.ts";

const root = resolve(import.meta.dirname, "..");
const scratch = join(root, ".dev/scaffold-check");
const projectName = "mvp";
const projectDir = join(scratch, projectName);
const registryDir = join(root, "modules");
const cliBin = join(root, "packages/cli/dist/index.js");

/**
 * The modules an agent's build adds before its first feature: the Validate stage's set and
 * the MVP stage's, as the `saasaloy-build` skill names them, on the Postgres driver and
 * the local providers. `api-keys` and `api-keys-user` are `scale` modules that the build adds with
 * `agent` (plan 0110). `scaffold-check.test.ts` holds this list to the skill. Exported
 * for that test.
 */
export const MVP_MODULES = [
  "database",
  "database-postgres",
  "api",
  "logger",
  "logger-console",
  "validators",
  "shell",
  "auth",
  "app",
  "admin",
  "email",
  "email-console",
  "agent",
  "api-keys",
  "api-keys-user",
] as const;

/** The testing mode the build sets, so the module route tests ship and run. */
const TESTING_FLAG = "--testing=tests-after";

/** `add` changes the lockfile, and a runner's `CI=true` makes a plain install frozen. */
const INSTALL = ["install", "--no-frozen-lockfile"] as const;

export interface CheckOptions {
  /** Leave `.dev/scaffold-check/` in place after a green run. */
  keep: boolean;
  /** Flags and positionals this script does not accept. */
  unknown: string[];
}

/**
 * The `db:setup` arguments for a `SCAFFOLD_DATABASE_SERVER` value: `--server` when it names
 * a server, and none when it is unset or empty, so `db:setup` starts the Docker backend.
 * Exported for its own test.
 */
export function dbSetupArgs(server?: string): string[] {
  return server === undefined || server === "" ? [] : ["--server"];
}

/**
 * Point `DATABASE_URL` in `apps/api/.env` at the server, the file `db:setup --server` reads
 * it from. `db:setup` then creates the project's database there and writes its URL over
 * this line, and `pnpm env:setup` keeps it, because the key is checkout-owned.
 */
async function pointAtServer(server: string): Promise<void> {
  const file = join(projectDir, "apps/api/.env");
  const source = existsSync(file) ? await readFile(file, "utf-8") : "";
  await writeFile(file, withDatabaseUrl(source, server));
}

/** Split this script's argv. Exported for its own test. */
export function parseArgs(argv: string[]): CheckOptions {
  return {
    keep: argv.includes("--keep"),
    unknown: argv.filter((arg) => arg !== "--keep"),
  };
}

function step(message: string): void {
  console.log(`scaffold-check: ${message}`);
}

function fail(message: string, ...detail: string[]): never {
  console.error(`scaffold-check: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  if (existsSync(projectDir)) {
    console.error(
      `scaffold-check: the project is kept in ${relative(root, projectDir)}.`
    );
  }
  process.exit(1);
}

/** Run a command with its output shown, and stop the script when it fails. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  step(`${command === "node" ? "saasaloy" : command} ${args.join(" ")}`);
  const result = spawnSync(
    command,
    command === "node" ? [cliBin, ...args] : args,
    { cwd, env, stdio: "inherit" }
  );
  if (result.error) {
    fail(`${command} could not start`, String(result.error));
  }
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed`,
      `exit code ${String(result.status)}`
    );
  }
}

/**
 * Write every service's `.env`. `email-console` leaves `EMAIL_PROVIDER` and `EMAIL_FROM`
 * with no default, so the first run names them; each named key gets the local value the
 * build skill's "Fill a key with no default" rule gives, through `saasaloy env --set`.
 */
async function setupEnv(env: NodeJS.ProcessEnv): Promise<void> {
  step("pnpm env:setup");
  const first = spawnSync("pnpm", ["env:setup"], {
    cwd: projectDir,
    encoding: "utf-8",
  });
  const output = `${first.stdout}\n${first.stderr}`;
  if (first.status === 0) {
    return;
  }
  const keys = missingEnvKeys(output);
  if (keys.length === 0) {
    fail("pnpm env:setup failed", ...output.trim().split("\n").slice(-30));
  }
  const registry = (await readdir(registryDir, { withFileTypes: true }))
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
  const sets: string[] = [];
  for (const key of keys) {
    const value = localEnvValue(key, registry);
    if (value === undefined) {
      fail(`pnpm env:setup names ${key}, which has no local value`);
    }
    sets.push("--set", `${key}=${value}`);
  }
  run("node", ["env", ...sets], projectDir, env);
  run("pnpm", ["env:setup"], projectDir);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.unknown.length > 0) {
    fail(
      `unknown argument(s): ${options.unknown.join(", ")}`,
      "usage: pnpm scaffold:check [--keep]"
    );
  }
  const started = Date.now();
  const registryEnv = { ...process.env, SAASALOY_REGISTRY_DIR: registryDir };

  run("pnpm", ["--filter", "saasaloy", "build"], root);

  await rm(scratch, { force: true, recursive: true });
  await mkdir(scratch, { recursive: true });
  run(
    "node",
    ["init", projectName, "--yes", TESTING_FLAG],
    scratch,
    registryEnv
  );
  run("node", ["add", ...MVP_MODULES, "--yes"], projectDir, registryEnv);
  run("pnpm", INSTALL, projectDir);
  run("pnpm", ["--filter", "@repo/db", "db:generate"], projectDir);
  const server = process.env.SCAFFOLD_DATABASE_SERVER;
  const setupArgs = dbSetupArgs(server);
  if (server !== undefined && setupArgs.length > 0) {
    step("pointing DATABASE_URL in apps/api/.env at SCAFFOLD_DATABASE_SERVER");
    await pointAtServer(server);
  }
  run("pnpm", ["db:setup", ...setupArgs], projectDir);
  await setupEnv(registryEnv);
  run("pnpm", ["check"], projectDir);

  if (!options.keep) {
    if (setupArgs.length === 0) {
      run("docker", ["compose", "down", "-v"], projectDir);
    }
    await rm(scratch, { force: true, recursive: true });
  } else if (setupArgs.length === 0) {
    step(
      `the Postgres container keeps running; \`docker compose down -v\` in ${relative(root, projectDir)} stops it.`
    );
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  step(
    `a fresh scaffold with ${String(MVP_MODULES.length)} modules on database-postgres passes \`pnpm check\` (${String(seconds)}s).`
  );
}

// Only when run directly, so the test can import `MVP_MODULES`, `dbSetupArgs` and `parseArgs`.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  await main();
}
