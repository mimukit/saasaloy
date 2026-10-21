import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import * as docker from "./backends/docker.ts";
import * as server from "./backends/server.ts";
import { testDatabaseName } from "./lib/branch-name.ts";
import {
  journalEntries,
  loadContext,
  resolveState,
  withSql,
} from "./lib/context.ts";
import type { Context } from "./lib/context.ts";
import {
  assertTestTarget,
  refuseProduction,
  seedUrl,
  writeSeed,
} from "./lib/seed.ts";
import { databaseOf, swapDatabase } from "./lib/url.ts";

// The Vitest global setup for route tests on Postgres. `apps/api/test/setup/database.ts`
// re-exports `setup`, and Vitest runs it once before the first test file.
//
// It prepares `<database>_test`, a database of its own beside this checkout's development
// database, so a test run never touches the rows a developer works with, and two worktrees
// never share one:
//
// 1. Create it when it is missing, on the server `DATABASE_URL` names, with the same code
//    `pnpm db:setup` uses. `TEST_DATABASE_URL`, when set, may move it to another server,
//    but it must still name `<database>_test`: step 2 drops whatever database it names.
// 2. Apply every migration. When that fails, because the migration files were regenerated
//    or a branch with another history ran here first, drop the database, create it again
//    and migrate once more. Nothing in it is worth keeping.
// 3. Run the seed. It is an upsert, so a database that already holds the rows is left as it
//    was, and a slice edited since the last run is picked up.
//
// Then it provides the URL to `testDatabase()` in `src/testing.ts`, which runs each test in
// a transaction and rolls it back.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * `TEST_DATABASE_URL`, or `DATABASE_URL` pointed at this checkout's `<database>_test`.
 * `undefined` when neither is set, which is a project that has not run `pnpm db:setup` yet.
 */
export function testDatabaseUrl(
  context: Context,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (env.TEST_DATABASE_URL) {
    return env.TEST_DATABASE_URL;
  }
  if (!(env.DATABASE_URL || context.env.values.get("DATABASE_URL"))) {
    return undefined;
  }
  return swapDatabase(
    seedUrl(context, env),
    testDatabaseName(context.database)
  );
}

async function migrate(url: string): Promise<void> {
  if (journalEntries(ROOT) === 0) {
    return;
  }
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate: apply } = await import("drizzle-orm/postgres-js/migrator");
  await withSql(url, "Cannot reach the test database", async (sql) => {
    await apply(drizzle(sql), {
      migrationsFolder: resolve(ROOT, "packages/db/migrations"),
    });
  });
}

export async function setup(project: TestProject): Promise<void> {
  refuseProduction();
  const context = loadContext(ROOT);
  const url = testDatabaseUrl(context);
  if (!url) {
    // Nothing to connect to yet. A test that calls `testDatabase()` fails and says so; every
    // other test still runs, so `pnpm test` on a fresh project is not blocked on a database.
    process.stderr.write(
      "No DATABASE_URL, so no test database was prepared. Run pnpm db:setup before a test that uses testDatabase().\n"
    );
    return;
  }
  const database = assertTestTarget(context, url);
  // Still possible when `DATABASE_URL` in the shell names the test database itself.
  const devUrl =
    process.env.DATABASE_URL || context.env.values.get("DATABASE_URL");
  if (devUrl && databaseOf(devUrl) === database) {
    throw new Error(
      `TEST_DATABASE_URL names ${database}, the development database. Point it at ${testDatabaseName(context.database)}, or unset it.`
    );
  }

  if (resolveState(context)?.backend === "docker") {
    await docker.ensureRunning(context.root);
  }
  const admin = server.adminUrl(url);
  await server.createDatabase(context.prefix, admin, database);
  try {
    await migrate(url);
  } catch (error) {
    // Drizzle wraps the driver's error, and its own message is the whole SQL text.
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const reason = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(
      `Migrating ${database} failed (${reason}). Creating it again.\n`
    );
    await server.dropDatabase(context.prefix, admin, database);
    await server.createDatabase(context.prefix, admin, database);
    await migrate(url);
  }
  await writeSeed(url, await import("../src/seed/index.ts"));

  project.provide("testDatabaseUrl", url);
}
