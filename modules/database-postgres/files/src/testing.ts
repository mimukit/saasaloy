import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, aroundEach, beforeAll, inject } from "vitest";
import { TEST_DB } from "./client";
import type { Db, DbBindings } from "./client";
import { schema } from "./schema";

// The route test harness for Postgres. Call `testDatabase()` once at the top of a test
// file, hand `database.env` to the app, and everything a route writes is rolled back when
// the test ends:
//
//   import { describe, expect, it } from "vitest";
//   import { testDatabase } from "@repo/db/testing";
//   import app from "../index";
//
//   const database = testDatabase();
//
//   describe("GET /health", () => {
//     it("answers", async () => {
//       const res = await app.request("/health", {}, database.env);
//       expect(res.status).toBe(200);
//     });
//   });
//
// The Vitest global setup in `scripts/test-setup.ts` creates `<prefix>_test`, migrates it
// and seeds it once per run, and provides its URL here. Each test then runs inside one
// transaction on that database, and `getDb` returns the transaction through the `TEST_DB`
// key on `env`, so a seeded row is there to read and nothing a test writes reaches the next
// one. See the `saasaloy-database-postgres` skill, "Route tests".

declare module "vitest" {
  interface ProvidedContext {
    /** The test database's URL, provided by `scripts/test-setup.ts`. Unset without a `DATABASE_URL`. */
    testDatabaseUrl?: string;
  }
}

export { TEST_DB } from "./client";

/** The transaction a test runs in. It has the client's query API, minus `$client`. */
export type TestDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The `env` a test hands the app: the db bindings, plus whatever the test adds. */
export type TestEnv<TExtra extends object = object> = DbBindings & TExtra;

/** What `testDatabase()` returns. Read both inside a test, never at module scope. */
export interface TestDatabase {
  /** The running test's transaction, to set a row up or look behind a route. */
  readonly db: TestDb;
  /** An `env` for `app.request(path, init, env)` whose `getDb` returns `db`. */
  readonly env: TestEnv;
}

/**
 * An `env` whose `getDb` returns `db`. `DATABASE_URL` names the test database, so code that
 * reads the string itself never falls back to the development one.
 */
export function testEnv<TExtra extends object = object>(
  db: TestDb,
  extra?: TExtra
): TestEnv<TExtra> {
  return {
    ...extra,
    DATABASE_URL: testDatabaseUrl(),
    [TEST_DB]: db,
  } as TestEnv<TExtra>;
}

function testDatabaseUrl(): string {
  const url = inject("testDatabaseUrl");
  if (!url) {
    throw new Error(
      "testDatabase(): there is no test database. Run pnpm db:setup so apps/api/.env holds DATABASE_URL, or set TEST_DATABASE_URL, then run the tests again."
    );
  }
  return url;
}

/** Thrown inside the transaction once the test is done, so Drizzle rolls it back. */
class RollbackError extends Error {
  constructor() {
    super("Roll the test's transaction back.");
    this.name = "RollbackError";
  }
}

/**
 * Register the hooks that give every test in this file its own transaction on the test
 * database: one connection for the file, and an `aroundEach` that opens a transaction,
 * runs the test inside it and rolls it back.
 */
export function testDatabase(): TestDatabase {
  let sql: ReturnType<typeof postgres> | undefined;
  let current: TestDb | undefined;

  beforeAll(() => {
    sql = postgres(testDatabaseUrl(), {
      max: 1,
      onnotice: () => {
        // A test has no use for a NOTICE.
      },
    });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  aroundEach(async (runTest) => {
    if (!sql) {
      throw new Error("testDatabase(): the connection did not open.");
    }
    let failure: unknown;
    try {
      await drizzle(sql, { schema }).transaction(async (tx) => {
        current = tx;
        try {
          await runTest();
        } catch (error) {
          failure = error;
        } finally {
          current = undefined;
        }
        throw new RollbackError();
      });
    } catch (error) {
      if (!(error instanceof RollbackError)) {
        throw error;
      }
    }
    if (failure !== undefined) {
      throw failure;
    }
  });

  function db(): TestDb {
    if (!current) {
      throw new Error(
        "testDatabase(): read `db` and `env` inside a test, where the transaction is open."
      );
    }
    return current;
  }

  return {
    get db() {
      return db();
    },
    get env() {
      return testEnv(db());
    },
  };
}
