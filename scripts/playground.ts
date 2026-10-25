// A git baseline for `.dev/playground`, so a playground returns to a known state in
// seconds instead of a destroy and a fresh init (#178), and a one-command bring-up on top
// of it (#187).
//
//   node scripts/playground.ts snap          commit the current state as the baseline
//   node scripts/playground.ts restore       reset tracked files, remove untracked ones,
//                                            then `pnpm install`
//   node scripts/playground.ts restore --db  also stop the api, wipe the database,
//                                            migrate and seed; you start the api again
//   node scripts/playground.ts up [--preset minimal|full] [--db d1|postgres]
//                                            a fresh playground from a preset in
//                                            scripts/play-presets.json, migrated, seeded,
//                                            snapped, with every app's dev server running
//   node scripts/playground.ts down          stop the dev servers `up` started
//
// Ignored files survive a restore, so node_modules, the env files and the D1 state stay.
// Every git call pins GIT_DIR to the playground's own `.git`: the playground sits inside
// this repository's work tree, and a git call that fell through to the outer repository
// would reset the maintainer's own work. `saasaloy init` creates that `.git`: the
// playground is ignored here, so init treats it as a project of its own (ADR 0024).
//
// `restore --db` and `up` end with `pnpm db:seed`, so the database holds the installed
// modules' seed slices (plan 0072).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { SpawnSyncOptions } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const USAGE =
  "usage: node scripts/playground.ts snap | restore [--db] | up [--preset minimal|full] [--db d1|postgres] | down";
const API_PORT = 4000;
const START_API =
  "the api is stopped; start it with: pnpm -C .dev/playground/apps/api dev";

export type Driver = "d1" | "postgres";

export type Args =
  | { command: "snap" }
  | { command: "restore"; db: boolean }
  | { command: "up"; preset: string; db: Driver }
  | { command: "down" };

function upArgs(flags: string[]): Args {
  let preset = "full";
  let db: Driver = "d1";
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i] ?? "";
    const value = flags[i + 1];
    if (flag !== "--preset" && flag !== "--db") {
      throw new Error(`unknown flag ${flag}\n${USAGE}`);
    }
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`${flag} needs a value\n${USAGE}`);
    }
    i++;
    if (flag === "--preset") {
      preset = value;
    } else if (value === "d1" || value === "postgres") {
      db = value;
    } else {
      throw new Error(`--db is d1 or postgres, not ${value}\n${USAGE}`);
    }
  }
  return { command: "up", db, preset };
}

export function parseArgs(argv: string[]): Args {
  const [command, ...flags] = argv;
  if (command === "up") {
    return upArgs(flags);
  }
  if (command === "snap" || command === "down") {
    if (flags.length > 0) {
      throw new Error(`${command} takes no flags\n${USAGE}`);
    }
    return { command };
  }
  if (command !== "restore") {
    throw new Error(USAGE);
  }
  for (const flag of flags) {
    if (flag !== "--db") {
      throw new Error(`unknown flag ${flag}\n${USAGE}`);
    }
  }
  return { command, db: flags.includes("--db") };
}

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

/** One key of a `.env` or `.dev.vars` file, with its quotes removed. */
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

function pnpm(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = playground
): void {
  run("pnpm", args, { cwd, env, stdio: "inherit" });
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
  return portPids(API_PORT);
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
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Exited between the check and the kill.
    }
  }
  console.log(`[play] stopped the api (${pids.length} process(es))`);
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // `pnpm env:setup` and `pnpm db:setup` write apps/api/.env (ADR 0039); a playground
  // made before the env capability keeps it in apps/api/.dev.vars.
  for (const file of ["apps/api/.env", "apps/api/.dev.vars"]) {
    const path = resolve(playground, file);
    const url = existsSync(path)
      ? readDevVar(readFileSync(path, "utf-8"), "DATABASE_URL")
      : undefined;
    if (url) {
      return url;
    }
  }
  throw new Error(
    "database-postgres is installed, but DATABASE_URL is set neither in the environment nor in apps/api/.env"
  );
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
  // A playground made before the seed system (plan 0072) has no db:seed script.
  if (existsSync(resolve(db, "scripts/seed.ts"))) {
    pnpm(
      ["-C", db, "db:seed"],
      driver === "d1"
        ? undefined
        : { ...process.env, DATABASE_URL: databaseUrl() }
    );
  }
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
  try {
    git(["reset", "--hard", "--quiet", "HEAD"]);
    git(["clean", "-d", "--force", "--quiet"]);
    console.log(
      `[play] files back at ${git(["rev-parse", "--short", "HEAD"]).trim()}`
    );
    pnpm(["install"]);
    if (db && driver) {
      resetDatabase(driver);
    }
  } catch (error) {
    if (withApi) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason}\n[play] ${START_API}`, { cause: error });
    }
    throw error;
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`[play] restored in ${seconds}s`);
  if (withApi) {
    console.log(`[play] ${START_API}`);
  }
}

// `up` and `down` (#187). The presets live in one data file, so `examples/full` (#184)
// and CI read the module list and the env values `up` uses, not a copy of them.
const presetsFile = resolve(root, "scripts/play-presets.json");
// Logs and pid files sit beside the playground, not in it, so the baseline never
// tracks them and a restore never removes them.
const playState = resolve(root, ".dev/play");

// The credentials of the database-postgres module's compose.yaml.
const POSTGRES_PORT = 5432;
const POSTGRES_ADMIN_URL = `postgres://postgres:postgres@localhost:${POSTGRES_PORT}/postgres`;

/** The fixed dev port of each app, from its astro, vite or wrangler config. */
export const DEV_PORTS: Readonly<Record<string, number>> = {
  admin: 3001,
  api: API_PORT,
  app: 3002,
  web: 3000,
};

export interface Preset {
  description: string;
  modules: string[];
  env: Record<string, string>;
}

/** The presets in `scripts/play-presets.json`, checked for shape. */
export function readPresets(text: string): Record<string, Preset> {
  const data = JSON.parse(text) as Record<string, Partial<Preset>>;
  const presets: Record<string, Preset> = {};
  for (const [name, entry] of Object.entries(data)) {
    if (name.startsWith("$")) {
      continue;
    }
    const { description, env, modules } = entry;
    if (
      typeof description !== "string" ||
      !Array.isArray(modules) ||
      !modules.every((m) => typeof m === "string") ||
      typeof env !== "object" ||
      env === null ||
      !Object.values(env).every((v) => typeof v === "string")
    ) {
      throw new Error(
        `preset ${name} needs a description, a modules list and an env map of strings`
      );
    }
    // Unset on purpose: Better Auth then uses its dev key, which the api allows only on
    // a loopback BETTER_AUTH_URL. A set secret would also drop every session per reset.
    if ("BETTER_AUTH_SECRET" in env) {
      throw new Error(`preset ${name} must leave BETTER_AUTH_SECRET unset`);
    }
    presets[name] = { description, env, modules };
  }
  return presets;
}

/** The `saasaloy add` arguments for a preset, with the driver `--db` picked. */
export function addArgs(preset: Preset, db: Driver): string[] {
  if (preset.modules.length === 0) {
    return [];
  }
  return ["add", ...preset.modules, "--with", `database-${db}`, "--yes"];
}

/** `packages/env/.env` for a preset: one `KEY=value` line per entry, sorted. */
export function envFile(preset: Preset): string {
  const lines = Object.keys(preset.env)
    .toSorted()
    .map((key) => `${key}=${preset.env[key] ?? ""}`);
  return `# Written by pnpm play:up from scripts/play-presets.json.\n${lines.join("\n")}\n`;
}

function portPids(port: number): number[] {
  const ss = spawnSync("ss", ["-ltnpH", `sport = :${port}`], {
    encoding: "utf-8",
  });
  const out = ss.error
    ? spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
        encoding: "utf-8",
      })
    : ss;
  return listenerPids(out.stdout ?? "");
}

function cwdOf(pid: number): string | undefined {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return undefined;
  }
}

/** Whether a process runs from inside `dir`, so `down` may stop it. */
export function insideDir(cwd: string | undefined, dir: string): boolean {
  return cwd !== undefined && (cwd === dir || cwd.startsWith(`${dir}/`));
}

async function stopPids(pids: number[], signalGroup: boolean): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(signalGroup ? -pid : pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  for (let waited = 0; waited < 10_000 && pids.some(alive); waited += 250) {
    await sleep(250);
  }
  for (const pid of pids.filter(alive)) {
    try {
      process.kill(signalGroup ? -pid : pid, "SIGKILL");
    } catch {
      // Exited between the check and the kill.
    }
  }
}

// Stop what `up` started, by its pid files, then any playground process still holding a
// dev port. A process from another checkout is never touched: `up` refuses its port.
async function down(): Promise<void> {
  const groups: number[] = [];
  if (existsSync(playState)) {
    for (const file of readdirSync(playState)) {
      if (file.endsWith(".pid")) {
        const pid = Number(readFileSync(resolve(playState, file), "utf-8"));
        if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
          groups.push(pid);
        }
        rmSync(resolve(playState, file), { force: true });
      }
    }
  }
  await stopPids(groups, true);
  const strays = Object.values(DEV_PORTS)
    .flatMap((port) => portPids(port))
    .filter((pid) => insideDir(cwdOf(pid), playground));
  const tree = [...new Set(strays.flatMap((p) => [p, ...descendants(p)]))];
  await stopPids(tree, false);
  const extra = tree.length > 0 ? ` and ${tree.length} stray process(es)` : "";
  console.log(`[play] stopped ${groups.length} dev server(s)${extra}`);
}

function refuseForeignPorts(): void {
  const held: string[] = [];
  for (const [app, port] of Object.entries(DEV_PORTS)) {
    for (const pid of portPids(port)) {
      held.push(
        `:${port} (${app}) is held by pid ${pid} in ${cwdOf(pid) ?? "?"}`
      );
    }
  }
  if (held.length > 0) {
    throw new Error(
      `the dev ports are pinned with strictPort, so free them first:\n  ${held.join("\n  ")}`
    );
  }
}

// Every `.dev/playground` on a machine shares the directory name Compose takes its project
// name from, so they would share one container and one named volume, and a database left
// by an earlier run makes the next migration fail. A name per checkout keeps them apart.
const composeProject = `playground-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;

// Remove this checkout's container and its volume, then make sure nothing else answers on
// 5432: db:setup uses whatever Postgres answers there, which could be another checkout's.
function freshPostgres(): void {
  run(
    "docker",
    ["compose", "--project-name", composeProject, "down", "--volumes"],
    {
      stdio: "inherit",
    }
  );
  const held = portPids(POSTGRES_PORT);
  if (held.length > 0) {
    throw new Error(
      `:${POSTGRES_PORT} is held by pid ${held.join(", ")}; stop that Postgres (docker ps) and run play:up again`
    );
  }
}

function step(label: string): void {
  console.log(`\n[play] ${label}`);
}

function devApps(): string[] {
  const apps = resolve(playground, "apps");
  return readdirSync(apps).filter((app) => {
    const file = resolve(apps, app, "package.json");
    if (!existsSync(file)) {
      return false;
    }
    const pkg = JSON.parse(readFileSync(file, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    return typeof pkg.scripts?.dev === "string";
  });
}

function startServer(app: string): number {
  const log = openSync(resolve(playState, `${app}.log`), "w");
  const child = spawn("pnpm", ["dev"], {
    cwd: resolve(playground, "apps", app),
    detached: true,
    // Astro 7 moves `astro dev` into a background process when it detects a coding
    // agent; this keeps it under the pid `down` stops.
    env: { ...process.env, ASTRO_DEV_BACKGROUND: "1" },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  if (child.pid === undefined) {
    throw new Error(`could not start ${app}`);
  }
  writeFileSync(resolve(playState, `${app}.pid`), String(child.pid));
  return child.pid;
}

async function answers(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForServers(
  started: { app: string; pid: number; port: number }[]
): Promise<void> {
  const pending = new Set(started);
  for (let waited = 0; pending.size > 0; waited += 1000) {
    for (const server of pending) {
      if (await answers(server.port)) {
        console.log(
          `[play] ${server.app} answers on http://localhost:${server.port}`
        );
        pending.delete(server);
      } else if (!alive(server.pid) || waited > 240_000) {
        throw new Error(
          `${server.app} did not answer on :${server.port}; see .dev/play/${server.app}.log`
        );
      }
    }
    if (pending.size > 0) {
      await sleep(1000);
    }
  }
}

async function up(name: string, db: Driver): Promise<void> {
  const started = performance.now();
  const presets = readPresets(readFileSync(presetsFile, "utf-8"));
  const preset = presets[name];
  if (!preset) {
    throw new Error(
      `no preset ${name}; scripts/play-presets.json has ${Object.keys(presets).join(", ")}`
    );
  }
  await down();
  refuseForeignPorts();
  step("build the CLI");
  pnpm(["--filter", "saasaloy", "build"], process.env, root);
  step(`scaffold .dev/playground with the ${name} preset`);
  rmSync(playground, { force: true, recursive: true });
  run(
    "node",
    [
      "packages/cli/dist/index.js",
      "init",
      ".dev/playground",
      "--force",
      "--no-install",
    ],
    { cwd: root, stdio: "inherit" }
  );
  copyFileSync(
    resolve(root, "scripts/saasaloy-shim.sh"),
    resolve(playground, "saasaloy")
  );
  chmodSync(resolve(playground, "saasaloy"), 0o755);
  const add = addArgs(preset, db);
  if (add.length > 0) {
    run("./saasaloy", add, { stdio: "inherit" });
  } else if (db !== "d1") {
    console.log(
      `[play] the ${name} preset installs no database; --db ${db} changes nothing`
    );
  }
  pnpm(["install"]);
  step("write packages/env/.env and each app's .env");
  const driver = databaseDriver(installed());
  const envPath = resolve(playground, "packages/env/.env");
  // `env:setup` refuses an unset DATABASE_URL, and `db:setup` is what names the database.
  // So the container's admin URL stands in until `db:setup` writes the real one.
  const env =
    driver === "postgres"
      ? { ...preset, env: { ...preset.env, DATABASE_URL: POSTGRES_ADMIN_URL } }
      : preset;
  writeFileSync(envPath, envFile(env));
  pnpm(["env:setup"]);
  if (driver) {
    step(`migrate and seed the ${driver} database`);
    const dbDir = resolve(playground, "packages/db");
    pnpm(["-C", dbDir, "db:generate"]);
    if (driver === "d1") {
      pnpm(["db:setup"]);
    } else {
      // db:setup starts the Compose container (a named volume, no host path) and points
      // DATABASE_URL in apps/api/.env at a fresh database. Copy that URL back to the
      // value source, so a later `pnpm env:setup` keeps it.
      freshPostgres();
      pnpm(["db:setup", "--docker"], {
        ...process.env,
        COMPOSE_PROJECT_NAME: composeProject,
      });
      const url = databaseUrl();
      writeFileSync(
        envPath,
        envFile({ ...preset, env: { ...preset.env, DATABASE_URL: url } })
      );
    }
    if (existsSync(resolve(dbDir, "scripts/seed.ts"))) {
      pnpm(["db:seed"]);
    }
  }
  snap();
  step("start the dev servers");
  mkdirSync(playState, { recursive: true });
  const servers = devApps().map((app) => ({
    app,
    pid: startServer(app),
    port: DEV_PORTS[app] ?? 0,
  }));
  await waitForServers(servers.filter((server) => server.port > 0));
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `\n[play] up in ${seconds}s; logs in .dev/play/, stop with pnpm play:down`
  );
  if (driver) {
    console.log(
      '[play] sign in as superadmin@example.test, admin@, member@ or banned@ with "saasaloy-dev-password"'
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "up") {
    await up(args.preset, args.db);
    return;
  }
  if (args.command === "down") {
    await down();
    return;
  }
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
