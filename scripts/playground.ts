// A git baseline for `.dev/playground`, so a playground returns to a known state in
// seconds instead of a destroy and a fresh init (#178).
//
//   node scripts/playground.ts snap          commit the current state as the baseline
//   node scripts/playground.ts restore       reset tracked files, remove untracked ones,
//                                            then `pnpm install`
//   node scripts/playground.ts restore --db  also stop the api, wipe the database,
//                                            migrate, and start the api again
//
// Ignored files survive a restore, so node_modules, the env files and the D1 state stay.
// Every git call pins GIT_DIR to the playground's own `.git`: the playground sits inside
// this repository's work tree, and a git call that fell through to the outer repository
// would reset the maintainer's own work. `saasaloy init` creates that `.git`: the
// playground is ignored here, so init treats it as a project of its own (ADR 0024).
//
// Seeds (#187) are not run yet; `restore --db` leaves an empty, migrated database.
import { spawn, spawnSync } from "node:child_process";
import type { SpawnSyncOptions } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const USAGE = "usage: node scripts/playground.ts snap | restore [--db]";
const API_PORT = 4000;

export interface Args {
  command: "snap" | "restore";
  db: boolean;
}

export function parseArgs(argv: string[]): Args {
  const [command, ...flags] = argv;
  if (command !== "snap" && command !== "restore") {
    throw new Error(USAGE);
  }
  for (const flag of flags) {
    if (flag !== "--db") {
      throw new Error(`unknown flag ${flag}\n${USAGE}`);
    }
    if (command === "snap") {
      throw new Error(`--db applies to restore only\n${USAGE}`);
    }
  }
  return { command, db: flags.includes("--db") };
}

export type Driver = "d1" | "postgres";

export function databaseDriver(modules: string[]): Driver | undefined {
  if (modules.includes("database-d1")) {
    return "d1";
  }
  if (modules.includes("database-postgres")) {
    return "postgres";
  }
  return undefined;
}

/** The pids in `ss -ltnpH` output or in `lsof -t` output, whichever came back. */
export function listenerPids(output: string): number[] {
  const fromSs = [...output.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  if (fromSs.length > 0) {
    return fromSs;
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map(Number);
}

/** One key of a `.dev.vars` file, with its quotes removed. */
export function readDevVar(contents: string, key: string): string | undefined {
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] === key) {
      return (match[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return undefined;
}

const root = resolve(import.meta.dirname, "..");
const playground = resolve(root, ".dev/playground");
const gitDir = resolve(playground, ".git");
const apiLog = resolve(root, ".dev/api-dev.log");

function run(
  cmd: string,
  args: string[],
  options: SpawnSyncOptions = {}
): string {
  const result = spawnSync(cmd, args, {
    cwd: playground,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`);
  }
  return String(result.stdout ?? "");
}

function git(args: string[]): string {
  return run("git", args, {
    env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: playground },
  });
}

function pnpm(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  run("pnpm", args, { env, stdio: "inherit" });
}

function installed(): string[] {
  const config = JSON.parse(
    readFileSync(resolve(playground, "saasaloy.json"), "utf-8")
  ) as { installed?: unknown };
  return Array.isArray(config.installed)
    ? config.installed.filter((n): n is string => typeof n === "string")
    : [];
}

function snap(): void {
  // `saasaloy init` creates the repository (ADR 0024), so there is one code path for it.
  if (!existsSync(gitDir)) {
    throw new Error(
      "the playground is not a git repository; run pnpm play:reset for one that is"
    );
  }
  git(["add", "--all"]);
  // A fixed identity, no signing and no hooks: the template's husky hooks would lint the
  // whole playground and hold the commit to commitlint, and neither is the point here.
  git([
    "-c",
    "user.name=saasaloy playground",
    "-c",
    "user.email=playground@saasaloy.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--no-verify",
    "--allow-empty",
    "--message",
    `baseline ${new Date().toISOString()}`,
  ]);
  console.log(
    `[play] baseline ${git(["rev-parse", "--short", "HEAD"]).trim()}`
  );
}

function descendants(pid: number): number[] {
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf-8" });
  const children = listenerPids(result.stdout ?? "");
  return children.flatMap((child) => [child, ...descendants(child)]);
}

function apiPids(): number[] {
  const ss = spawnSync("ss", ["-ltnpH", `sport = :${API_PORT}`], {
    encoding: "utf-8",
  });
  const lsof = ss.error
    ? spawnSync("lsof", ["-t", `-iTCP:${API_PORT}`, "-sTCP:LISTEN"], {
        encoding: "utf-8",
      })
    : ss;
  return listenerPids(lsof.stdout ?? "");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((done) => {
    setTimeout(done, ms);
  });
}

// Stop the api and every process under it, workerd included, and wait until they are
// gone. Deleting D1 state under a running workerd leaves every later query failing with
// SQLITE_CANTOPEN (see scripts/qa-tenant-scoping-serve.sh).
async function stopApi(): Promise<void> {
  const listeners = apiPids();
  if (listeners.length === 0) {
    console.log(`[play] no api listening on :${API_PORT}`);
    return;
  }
  const pids = [
    ...new Set(listeners.flatMap((pid) => [pid, ...descendants(pid)])),
  ];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  for (let waited = 0; waited < 10_000 && pids.some(alive); waited += 250) {
    await sleep(250);
  }
  for (const pid of pids.filter(alive)) {
    process.kill(pid, "SIGKILL");
  }
  console.log(`[play] stopped the api (${pids.length} process(es))`);
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const devVars = resolve(playground, "apps/api/.dev.vars");
  const url = existsSync(devVars)
    ? readDevVar(readFileSync(devVars, "utf-8"), "DATABASE_URL")
    : undefined;
  if (!url) {
    throw new Error(
      "database-postgres is installed, but DATABASE_URL is set neither in the environment nor in apps/api/.dev.vars"
    );
  }
  return url;
}

// `drizzle` goes too. The migration journal lives there, not in `public`, so dropping
// `public` alone leaves `drizzle-kit migrate` reporting "already applied" against an
// empty database. The `postgres` client comes from the playground's packages/db.
const WIPE_POSTGRES = `
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
await sql.unsafe("drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;");
await sql.end();
`;

function resetDatabase(driver: Driver): void {
  const db = resolve(playground, "packages/db");
  // Migrations generated after the baseline are untracked, so the restore removed them.
  pnpm(["-C", db, "db:generate"]);
  if (driver === "d1") {
    rmSync(resolve(playground, "apps/api/.wrangler"), {
      force: true,
      recursive: true,
    });
    pnpm(["-C", db, "db:migrate:local"]);
  } else {
    const env = { ...process.env, DATABASE_URL: databaseUrl() };
    run("node", ["--input-type=module", "--eval", WIPE_POSTGRES], {
      cwd: db,
      env,
    });
    pnpm(["-C", db, "db:migrate"], env);
  }
  console.log(`[play] wiped and migrated the ${driver} database`);
}

async function startApi(): Promise<void> {
  const log = openSync(apiLog, "w");
  const child = spawn("pnpm", ["dev"], {
    cwd: resolve(playground, "apps/api"),
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  for (let waited = 0; waited < 90_000; waited += 1000) {
    await sleep(1000);
    try {
      const response = await fetch(`http://localhost:${API_PORT}/health`);
      if (response.ok) {
        console.log(
          `[play] api up on :${API_PORT} (pid ${child.pid}, log ${apiLog})`
        );
        return;
      }
    } catch {
      // Not listening yet.
    }
  }
  throw new Error(`the api did not answer on :${API_PORT}; see ${apiLog}`);
}

async function restore(db: boolean): Promise<void> {
  if (!existsSync(gitDir)) {
    throw new Error("the playground has no baseline; run pnpm play:snap first");
  }
  const started = performance.now();
  const modules = db ? installed() : [];
  const driver = databaseDriver(modules);
  const withApi = db && driver !== undefined && modules.includes("api");
  if (db && !driver) {
    console.log(
      "[play] no database driver installed; --db has nothing to reset"
    );
  }
  if (withApi) {
    await stopApi();
  }
  git(["reset", "--hard", "--quiet", "HEAD"]);
  git(["clean", "-d", "--force", "--quiet"]);
  console.log(
    `[play] files back at ${git(["rev-parse", "--short", "HEAD"]).trim()}`
  );
  pnpm(["install"]);
  if (db && driver) {
    resetDatabase(driver);
  }
  if (withApi) {
    await startApi();
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`[play] restored in ${seconds}s`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(resolve(playground, "saasaloy.json"))) {
    throw new Error("no .dev/playground; run pnpm play:init first");
  }
  if (args.command === "snap") {
    snap();
  } else {
    await restore(args.db);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[play] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
