import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { schema } from "./schema";

// The D1 client. `getDb` wraps the Worker's D1 binding in a Drizzle instance carrying the
// whole schema barrel, so callers get typed relational queries. A feature route reads its
// env off Hono's `c.env` (never `process.env` — bindings live on the Workers runtime) and
// hands the whole object here:
//
//   const db = getDb(c.env);
//
// It takes the whole `env` rather than the bare `D1Database` so both drivers present one
// call shape. `database-postgres` has to read `env` to resolve a connection string, and a
// feature route written against `getDb(c.env)` compiles unchanged under either driver —
// which is what lets `waitlist` ship one route file instead of two.
//
// `DbBindings` is the binding shape to compose into a route's Hono generic, so `c.env.DB`
// is typed without api's entry needing a code-level patch:
//
//   new Hono<{ Bindings: DbBindings }>()

/**
 * The key a route test may put a client under, on the `env` it hands the app. `getDb`
 * returns that client instead of wrapping `env.DB`.
 *
 * The D1 harness in `./testing.ts` does not need it: it hands the routes a real local D1
 * binding as `DB`, because D1 has no transaction a test could hold open and roll back. The
 * key exists so a route test is written the same way under both drivers, and
 * `database-postgres` uses it for exactly that rollback.
 *
 * `Symbol.for`, so the test and the route agree on the key even when Vitest loads this file
 * twice.
 */
export const TEST_DB: unique symbol = Symbol.for("@repo/db/test-db");

export interface DbBindings {
  DB: D1Database;
  /** The route test seam. See `TEST_DB`. */
  [TEST_DB]?: unknown;
}

/**
 * Open a Drizzle client for this request.
 *
 * Cheap, and safe to call as often as you like. D1 hands the Worker a binding stub rather
 * than a socket, so there is no connection to pool and nothing to close afterwards.
 *
 * Prefer `withDb` in a route anyway. It is the same call here, and under
 * `database-postgres` the close it performs is not optional.
 */
export function getDb(env: DbBindings): Db {
  if (env[TEST_DB] !== undefined) {
    return env[TEST_DB] as Db;
  }
  return drizzle(env.DB, { schema });
}

/** The Drizzle client this driver hands a repository. */
export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

/**
 * The part of a Hono `Context` `withDb` reads. Structural on purpose: `packages/db` stays
 * free of a `hono` dependency, and any request context carrying an `env` and a
 * `waitUntil` fits.
 *
 * This driver never reads `executionCtx`. The field is declared so the type matches
 * `database-postgres`'s, and a route body typed against it ports between the two.
 */
export interface DbRequestContext {
  env: DbBindings;
  executionCtx: { waitUntil: (promise: Promise<unknown>) => void };
}

/**
 * Run `body` against a client for this request.
 *
 * A pass-through here, on purpose. There is no socket to close, so this driver schedules
 * nothing on `executionCtx.waitUntil` and adds no work of its own:
 *
 *   waitlist.get("/", (c) => withDb(c, async (db) => c.json(await listWaitlist(db))));
 *
 * It exists so one route body is correct under both drivers. Under `database-postgres`
 * the same call opens a connection and closes it when `body` settles; a route that reads
 * the db through `getDb` directly leaks a socket the moment the project switches driver.
 */
export function withDb<T>(
  c: DbRequestContext,
  body: (db: Db) => Promise<T>
): Promise<T> {
  return body(getDb(c.env));
}

/**
 * Run `body` against `db`. D1 has no interactive transaction, so this is NOT one: each
 * statement `body` runs commits as it runs, and a throw part-way leaves the earlier writes
 * in place.
 *
 * Both drivers export this with one signature, so code written against
 * `@repo/db/client` asks for a transaction without naming the driver. Under
 * `database-postgres` the same call is a real transaction that rolls back on a throw. Code
 * that needs D1 writes to be all-or-nothing sends them as one `db.batch`, which D1 runs
 * atomically, instead.
 *
 * `adminWrite` in `apps/api/src/lib/admin-write.ts` is the caller this was added for
 * (issue #310). On D1 its body's change stands first, the audit rows
 * go in after it, and a failed insert is logged at `error` while the change stays. The
 * `saasaloy-admin` skill states that weaker guarantee.
 */
export function transaction<T>(
  db: Db,
  body: (db: Db) => Promise<T>
): Promise<T> {
  return body(db);
}

/**
 * Whether `transaction` rolls back on a throw. `false` here, because D1 has no interactive
 * transaction. Code that has to act differently when it cannot (`adminWrite` logs a failed
 * audit insert instead of failing a change that already stood) reads this and never names
 * the driver.
 */
export const TRANSACTION_IS_ATOMIC = false;
