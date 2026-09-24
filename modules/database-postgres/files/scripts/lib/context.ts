import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
import { hostOf } from "./url.ts";

// What `db:setup`, `db:status` and `db:drop` share: where the repo root and the api env
// file are, which database this checkout should use, the state block inside that file, one
// short-lived SQL connection, and the pnpm child process that runs the migrations.
//
// Every script runs from `packages/db` (`pnpm --filter @repo/db db:setup`), so the repo root
// is two levels up.

/** The env file wrangler reads in local development, and the only file these scripts write. */
export const API_ENV = "apps/api/.dev.vars";

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
  /** `apps/api/.dev.vars`, read once at start-up. */
  env: EnvFile;
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
 */
export function loadContext(): Context {
  const root = resolve(process.cwd(), "../..");
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
 * A file that sets `DATABASE_URL` but carries no block gets one inferred, when the URL names
 * a neon.new host or a database this project manages. Any other URL infers nothing and is
 * left alone: it is a server connection a developer put there, and `--server` is built to
 * create a database on exactly that server.
 *
 * Inferring nothing is also the safety rule. `db:drop` drops what the block names and
 * nothing else, so a URL no block vouches for is never a drop target.
 */
export function resolveState(context: Context): State | undefined {
  const existing = parseState(context.env.blockLines);
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
  context.env.blockLines = formatState(inferred);
  writeEnvFile(context.env.path, context.env.blockLines, context.env.lines);
  return inferred;
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
