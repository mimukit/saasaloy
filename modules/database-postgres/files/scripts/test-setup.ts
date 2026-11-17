import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import * as docker from "./backends/docker.ts";
import * as server from "./backends/server.ts";
import { testDatabaseName, workerDatabaseName } from "./lib/branch-name.ts";
import {
  journalEntries,
  loadContext,
  resolveState,
  withSql,
} from "./lib/context.ts";
import type { Context } from "./lib/context.ts";
import { cloneId, mappingStatement } from "./lib/mapping.ts";
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
// 4. When the api project runs more than one worker (`maxWorkers` in
//    `apps/api/vitest.config.ts`), copy the seeded database once per worker, into
//    `<database>_test_w1` to `_w<N>`. The copies are made fresh on every run, so each starts
//    from the seed just written. Two test files on one database wait on each other's row
//    locks; one database per worker removes the wait.
//
// Then it provides the URL and the worker count to `testDatabase()` in `src/testing.ts`,
// which picks its worker's copy, runs each test in a transaction and rolls it back.

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

  const backend = resolveState(context)?.backend;
  if (backend === "docker") {
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
  // The mapping `db:setup` writes on the development database, so `db:prune` drops the test
  // database together with it once the branch closes.
  await withSql(url, "Cannot reach the test database", async (sql) => {
    await sql.unsafe(
      mappingStatement(context.prefix, database, {
        prefix: context.prefix,
        branch: context.branch ?? "",
        worktree: context.root,
        clone: cloneId(context.root),
      })
    );
  });

  // No copies on neon.new. `CREATE DATABASE ... TEMPLATE` refuses to copy a database that
  // has another session on it, and neon.new's compute now and then holds one on the test
  // database that ending every session the project's role can see does not remove. A check
  // on 2026-11-16 failed one run in four, after five tries per copy. So every worker shares the
  // one test database there, and two files may wait on each other's row locks.
  // `API_TEST_WORKERS=1` runs the files one at a time instead.
  const workers = backend === "neon" ? 1 : project.config.maxWorkers;
  if (workers > 1) {
    await Promise.all(
      Array.from({ length: workers }, (_, index) =>
        server.cloneDatabase(
          context.prefix,
          admin,
          database,
          workerDatabaseName(database, index + 1)
        )
      )
    );
  }

  project.provide("testDatabaseUrl", url);
  project.provide("testDatabaseWorkers", workers);
}

/**
 * `setup` for a test file that prepares the test database itself, in its own `beforeAll`,
 * rather than through a project's global setup. Vitest runs test files in parallel workers,
 * so two such files would create, migrate and seed `<database>_test` at the same moment, and
 * the second `CREATE DATABASE` fails on `pg_database_datname_index`. A session advisory lock
 * on the server makes each file wait for the one before it; by then the database exists, the
 * migrations are applied and the seed is an upsert, so the second run changes nothing.
 */
export async function setupLocked(): Promise<void> {
  const context = loadContext(ROOT);
  const url = testDatabaseUrl(context);
  const project = {
    provide: () => {
      // A file-level call has no project to hand the URL to; each file reads it itself.
    },
  } as unknown as TestProject;
  if (!url) {
    await setup(project);
    return;
  }
  if (resolveState(context)?.backend === "docker") {
    await docker.ensureRunning(context.root);
  }
  const key = `saasaloy-test-setup:${databaseOf(url)}`;
  await withSql(
    server.adminUrl(url),
    "Cannot reach the test database server",
    async (sql) => {
      await sql`select pg_advisory_lock(hashtext(${key}))`;
      try {
        await setup(project);
      } finally {
        await sql`select pg_advisory_unlock(hashtext(${key}))`;
      }
    }
  );
}
