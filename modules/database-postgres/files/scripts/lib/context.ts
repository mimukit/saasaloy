import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type postgres from "postgres";
import {
  assertManagedDatabase,
  branchDatabaseName,
  databasePrefix,
} from "./branch-name.ts";
import { readEnvFile, writeEnvFile } from "./env-file.ts";
import type { EnvFile } from "./env-file.ts";
import { formatState, inferState, parseState } from "./state.ts";
import type { State } from "./state.ts";
import { databaseOf, hostOf } from "./url.ts";

// What `db:setup`, `db:status`, `db:drop` and `db:seed` share: where the repo root, the api
// env file and the state file are, which database this checkout should use, one short-lived
// SQL connection, and the pnpm child process that runs the migrations.
//
// Every script runs from `packages/db` (`pnpm --filter @repo/db db:setup`), so the repo root
// is two levels up.

/**
 * The env file wrangler reads in local development. `pnpm env:setup` writes it too, and
 * keeps `DATABASE_URL` across a rewrite because the key is checkout-owned.
 */
export const API_ENV = "apps/api/.env";

/** The file that holds the state block. `pnpm env:setup` never touches it. */
export const STATE_FILE = "apps/api/.env.db";

type Sql = ReturnType<typeof postgres>;

export interface Context {
  /** Absolute path of the repo root. */
  root: string;
  /** The current branch, or `undefined` on a detached HEAD or outside git. */
  branch?: string;
  /** True when this checkout is on the default branch, which keeps the plain database. */
  isDefaultBranch: boolean;
  /** Every database name these scripts may touch starts with it. */
  prefix: string;
  /** The database this checkout should use, branch-named off the default branch. */
  database: string;
  /** `apps/api/.env`, read once at start-up. */
  env: EnvFile;
  /** Absolute path of `apps/api/.env.db`. */
  statePath: string;
}

/** Branches that keep the plain `<prefix>` database rather than one of their own. */
const DEFAULT_BRANCHES = new Set(["main", "master"]);

/** Error codes that mean the server never answered, as opposed to a refused query. */
const CONNECT_CODES = new Set([
  "CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Run `body`, and turn a thrown error into one line on stderr and exit code 1. No script
 * prints a stack: every refusal here is a message a developer acts on.
 */
export async function run(body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}

/** The flags on the command line, refusing any name `allowed` does not list. */
export function readFlags(allowed: readonly string[]): Set<string> {
  const passed = new Set(process.argv.slice(2));
  for (const flag of passed) {
    if (!allowed.includes(flag)) {
      throw new Error(
        `Unknown flag ${flag}. This command takes ${allowed.length > 0 ? allowed.join(", ") : "no flags"}.`
      );
    }
  }
  return passed;
}

function gitBranch(root: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  });
  const branch = result.stdout?.trim();
  if (result.status !== 0 || !branch || branch === "HEAD") {
    return undefined;
  }
  return branch;
}

function projectName(root: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf-8")
    ) as { name?: string };
    return pkg.name ?? "";
  } catch {
    return "";
  }
}

/**
 * The repo root, the branch, the database name this checkout should use, and the api env
 * file. A checkout on `main` (or outside git) gets the plain `<prefix>`; every other branch
 * gets `<prefix>_<branch>`, so a migration that is not merged never reaches a database
 * another developer shares.
 *
 * `root` defaults to two levels above the working directory, which is the repo root for a
 * script run through `pnpm --filter @repo/db`. The test harness passes its own, because
 * Vitest runs from the repo root.
 */
export function loadContext(
  root: string = resolve(process.cwd(), "../..")
): Context {
  const branch = gitBranch(root);
  const prefix = databasePrefix(projectName(root));
  const isDefaultBranch = !branch || DEFAULT_BRANCHES.has(branch);
  const database =
    isDefaultBranch || !branch ? prefix : branchDatabaseName(prefix, branch);
  return {
    root,
    ...(branch ? { branch } : {}),
    isDefaultBranch,
    prefix,
    database,
    env: readEnvFile(resolve(root, API_ENV)),
    statePath: resolve(root, STATE_FILE),
  };
}

/** True when `database` is one this project's scripts made, or would make. */
export function isManagedDatabase(context: Context, database: string): boolean {
  try {
    assertManagedDatabase(context.prefix, database);
    return true;
  } catch {
    return false;
  }
}

/**
 * This checkout's state block, or `undefined` when there is none.
 *
 * A checkout whose `DATABASE_URL` has no state file gets one inferred, when the URL names
 * a neon.new host or a database this project manages. Any other URL infers nothing and is
 * left alone: it is a server connection a developer put there, and `--server` is built to
 * create a database on exactly that server.
 *
 * Inferring nothing is also the safety rule. `db:drop` drops what the block names and
 * nothing else, so a URL no block vouches for is never a drop target.
 */
export function resolveState(context: Context): State | undefined {
  const existing = parseState(readEnvFile(context.statePath).lines);
  if (existing) {
    return existing;
  }
  const url = context.env.values.get("DATABASE_URL");
  if (!url) {
    return undefined;
  }

  const inferred = inferState(url, (database) =>
    isManagedDatabase(context, database)
  );
  if (!inferred) {
    return undefined;
  }
  writeState(context, inferred);
  return inferred;
}

/** Write the state block, replacing whatever the state file held. */
export function writeState(context: Context, state: State): void {
  writeEnvFile(context.statePath, formatState(state));
}

/** Delete the state file. A file that is not there is already removed. */
export function removeState(context: Context): void {
  rmSync(context.statePath, { force: true });
}

/**
 * Why `url` and `state` disagree, or `undefined` when they name one database.
 *
 * The block and `DATABASE_URL` live in two files, so a hand edit can move one and not the
 * other. A script that acts on the block refuses when they disagree, because the database
 * the block names is then not the one this checkout uses.
 */
export function stateMismatch(state: State, url: string): string | undefined {
  let named: string;
  try {
    named = databaseOf(url);
  } catch {
    return `DATABASE_URL in ${API_ENV} is not a URL, but ${STATE_FILE} records ${state.database}.`;
  }
  return named === state.database
    ? undefined
    : `DATABASE_URL in ${API_ENV} names ${named}, but ${STATE_FILE} records ${state.database}.`;
}

/**
 * Open one connection, run `work`, and close it. A connection that never answers is
 * rethrown with `unreachable` in front, so the message can name the container or neon.new.
 */
export async function withSql<T>(
  url: string,
  unreachable: string,
  work: (sql: Sql) => Promise<T>
): Promise<T> {
  // Loaded here, not at the top, so a script that writes no SQL never needs the driver.
  const { default: connect } = await import("postgres");
  const sql = connect(url, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => {
      // Drop NOTICEs such as "database does not exist, skipping"; the scripts say what they did.
    },
  });
  try {
    return await work(sql);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (CONNECT_CODES.has(code)) {
      throw new Error(`${unreachable} (${hostOf(url)}, ${code}).`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Run `pnpm <args>` in the repo root with `env` added, and report whether it passed. */
export function runPnpm(
  root: string,
  args: string[],
  env: Record<string, string>
): boolean {
  const result = spawnSync("pnpm", args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return result.status === 0;
}

/**
 * How many migrations `db:generate` has written, read off drizzle's journal. Zero covers
 * both "no migrations folder yet" and "the folder is there and empty", which is the state a
 * project sits in until it declares its first table.
 *
 * `db:setup` uses it to skip `db:migrate`: drizzle-kit exits non-zero with no message when
 * it finds no migrations, and a fresh project must still get a database.
 */
export function journalEntries(root: string): number {
  try {
    const journal = JSON.parse(
      readFileSync(
        resolve(root, "packages/db/migrations/meta/_journal.json"),
        "utf-8"
      )
    ) as { entries?: unknown[] };
    return journal.entries?.length ?? 0;
  } catch {
    return 0;
  }
}
