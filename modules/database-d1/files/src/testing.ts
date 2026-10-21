import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterAll, beforeAll, beforeEach, inject } from "vitest";
import type { Db, DbBindings } from "./client";
import { schema } from "./schema";
import { seedPlan, statementsFor, tables } from "./seed/index";
import { orderTables } from "./seed/order";
import { describeTable } from "./seed/table";

// The route test harness for D1. Call `testDatabase()` once at the top of a test file,
// hand `database.env` to the app, and every test starts from the seed:
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
// The Vitest global setup in `scripts/test-setup.ts` builds a migrated, seeded template
// database. Each test file copies it to a temporary folder and opens a local D1 on the copy
// through wrangler's `getPlatformProxy`, so files running in parallel never share one.
// D1 has no transaction a test could hold open, so before each test the copy is emptied
// and the seed written again, in one batch. A test sees the seed and nothing an earlier
// test wrote. See the `saasaloy-database-d1` skill, "Route tests".

declare module "vitest" {
  interface ProvidedContext {
    /** The template database's state folder, provided by `scripts/test-setup.ts`. */
    testD1State: string;
    /** `apps/api/wrangler.jsonc`, so the copy opens with the api's own bindings. */
    testWranglerConfig: string;
  }
}

export { TEST_DB } from "./client";

/** The client a test looks behind a route with. */
export type TestDb = Db;

/** The `env` a test hands the app: the db bindings, plus whatever the test adds. */
export type TestEnv<TExtra extends object = object> = DbBindings & TExtra;

/** What `testDatabase()` returns. Read both inside a test, never at module scope. */
export interface TestDatabase {
  /** A client on this file's database, to set a row up or look behind a route. */
  readonly db: TestDb;
  /** An `env` for `app.request(path, init, env)` carrying this file's D1 as `DB`. */
  readonly env: TestEnv;
}

/** An `env` whose `DB` is `d1`. */
export function testEnv<TExtra extends object = object>(
  d1: D1Database,
  extra?: TExtra
): TestEnv<TExtra> {
  return { ...extra, DB: d1 } as TestEnv<TExtra>;
}

/** Empty every table, children first, then write the seed, all in one atomic batch. */
async function resetToSeed(d1: D1Database): Promise<void> {
  const db = drizzle(d1);
  const byName = new Map(tables.map((table) => [getTableName(table), table]));
  const childrenFirst = orderTables(
    tables.map((table) => {
      const shape = describeTable(table);
      return { after: shape.references, name: shape.name };
    })
  ).toReversed();
  // `statementsFor` serves both drivers, so it returns `unknown[]`; these are D1 inserts.
  const statements: unknown[] = [
    ...childrenFirst.flatMap((name) => {
      const table = byName.get(name);
      return table ? [db.delete(table as Parameters<typeof db.delete>[0])] : [];
    }),
    ...statementsFor(db, seedPlan()),
  ];
  if (statements.length > 0) {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  }
}

/**
 * Register the hooks that give this file its own copy of the test database, reset to the
 * seed before every test.
 */
export function testDatabase(): TestDatabase {
  let folder: string | undefined;
  let d1: D1Database | undefined;
  let dispose: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "saasaloy-d1-test-"));
    const state = join(folder, "v3");
    cpSync(inject("testD1State"), state, { recursive: true });
    const { getPlatformProxy } = await import("wrangler");
    const proxy = await getPlatformProxy<{ DB: D1Database }>({
      configPath: inject("testWranglerConfig"),
      persist: { path: state },
      remoteBindings: false,
    });
    d1 = proxy.env.DB;
    dispose = () => proxy.dispose();
  });

  afterAll(async () => {
    await dispose?.();
    if (folder) {
      rmSync(folder, { force: true, recursive: true });
    }
  });

  beforeEach(async () => {
    await resetToSeed(binding());
  });

  function binding(): D1Database {
    if (!d1) {
      throw new Error(
        "testDatabase(): read `db` and `env` inside a test, once the database is open."
      );
    }
    return d1;
  }

  return {
    get db() {
      return drizzle(binding(), { schema }) as TestDb;
    },
    get env() {
      return testEnv(binding());
    },
  };
}
