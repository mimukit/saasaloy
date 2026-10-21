import { resolve } from "node:path";
import { assertManagedDatabase, testDatabaseName } from "./branch-name.ts";
import { API_ENV, withSql } from "./context.ts";
import type { Context } from "./context.ts";
import { databaseOf, hostOf } from "./url.ts";
import type * as SeedModule from "../../src/seed/index.ts";

// What `db:seed` and the route test harness share: the guard that keeps the seed off a
// database this project does not own, the loader for the seed entry, and the one
// transaction that writes the whole plan.

/** The seed entry's exports: `packages/db/src/seed/index.ts`. */
export type SeedEntry = typeof SeedModule;

export interface SeedResult {
  database: string;
  counts: { table: string; rows: number }[];
  messages: string[];
}

/** The seed never runs with `NODE_ENV=production`. Checked before anything is loaded. */
export function refuseProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. db:seed writes example rows, and only to a development database this project made."
    );
  }
}

/**
 * The URL `db:seed` writes to: `DATABASE_URL` from the environment when it is set, the one
 * in `apps/api/.env` otherwise. The same order `drizzle.config.ts` reads it in.
 */
export function seedUrl(
  context: Context,
  env: NodeJS.ProcessEnv = process.env
): string {
  const url = env.DATABASE_URL || context.env.values.get("DATABASE_URL");
  if (!url) {
    throw new Error(
      `No DATABASE_URL in the environment or in ${API_ENV}. Run pnpm db:setup first.`
    );
  }
  return url;
}

/**
 * Throw unless `url` names a database these scripts manage: `<prefix>` or `<prefix>_<x>`.
 * That refuses `postgres`, another project's database and anything a person pointed
 * `DATABASE_URL` at by hand. Returns the database name.
 */
export function assertSeedTarget(prefix: string, url: string): string {
  let database: string;
  try {
    database = databaseOf(url);
  } catch {
    throw new Error("Refusing to seed: DATABASE_URL is not a URL.");
  }
  try {
    assertManagedDatabase(prefix, database);
  } catch {
    throw new Error(
      `Refusing to seed "${database}": db:seed only writes to ${prefix} and ${prefix}_<branch>, the databases pnpm db:setup makes.`
    );
  }
  return database;
}

/**
 * Throw when `DATABASE_URL` from the environment names another server than the one
 * `pnpm db:setup` wrote to `apps/api/.env`. The name check alone lets a shell variable
 * aimed at a remote `<prefix>` through, and the seed writes a superadmin whose password
 * it prints. `db:seed` only; the test setup has `assertTestTarget`.
 */
export function assertSeedServer(
  context: Context,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!env.DATABASE_URL) {
    return;
  }
  const recorded = context.env.values.get("DATABASE_URL");
  if (!recorded) {
    throw new Error(
      `Refusing to seed: DATABASE_URL is set in the environment, but ${API_ENV} has none to check it against. Run pnpm db:setup first.`
    );
  }
  const asked = hostOf(env.DATABASE_URL);
  const known = hostOf(recorded);
  if (asked !== known) {
    throw new Error(
      `Refusing to seed ${asked}: DATABASE_URL in the environment names another server than ${known}, the one in ${API_ENV}. Unset it, or run pnpm db:setup against that server.`
    );
  }
}

/**
 * Throw unless `url` names this checkout's test database, `testDatabaseName` of its
 * development database: the one database the route test setup may create, migrate, drop
 * and seed. `assertSeedTarget` is not enough here: it accepts every branch database, and a
 * failed migration drops the test database with `WITH (FORCE)`. Returns the name.
 */
export function assertTestTarget(context: Context, url: string): string {
  let database: string;
  try {
    database = databaseOf(url);
  } catch {
    throw new Error("Refusing to use the test database: its URL is not a URL.");
  }
  const expected = testDatabaseName(context.database);
  if (database !== expected) {
    throw new Error(
      `Refusing to use "${database}" as the test database: the route test setup creates, migrates, drops and seeds only ${expected}. Point TEST_DATABASE_URL at ${expected}, or unset it.`
    );
  }
  return database;
}

/**
 * Load the seed entry. It uses Vite's `import.meta.glob`, so plain Node cannot import it;
 * `runnerImport` runs it through Vite with no config file, and loads `drizzle-orm` and
 * `postgres` natively, so the tables it returns are the ones this process's Drizzle knows.
 */
export async function loadSeedEntry(root: string): Promise<SeedEntry> {
  const { runnerImport } = await import("vite");
  const { module } = await runnerImport<SeedEntry>(
    resolve(root, "packages/db/src/seed/index.ts"),
    { logLevel: "error", root: resolve(root, "packages/db") }
  );
  return module;
}

/**
 * Write the whole seed plan to `url` in one transaction. Either every row lands or none
 * does. The guard is the caller's job: run `assertSeedTarget` first.
 */
export async function writeSeed(
  url: string,
  entry: SeedEntry
): Promise<SeedResult> {
  const plan = entry.seedPlan();
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const database = databaseOf(url);
  await withSql(
    url,
    `Cannot reach ${database} on ${hostOf(url)}. Run pnpm db:status`,
    async (sql) => {
      const db = drizzle(sql);
      await db.transaction(async (tx) => {
        for (const statement of entry.statementsFor(tx, plan)) {
          await statement;
        }
      });
    }
  );
  return {
    counts: entry.countsFor(plan),
    database,
    messages: entry.messagesFor(plan),
  };
}
