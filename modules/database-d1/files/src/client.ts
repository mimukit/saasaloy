import { drizzle } from "drizzle-orm/d1";
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
export interface DbBindings {
  DB: D1Database;
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
export function getDb(env: DbBindings) {
  return drizzle(env.DB, { schema });
}

/** The Drizzle client this driver hands a repository. */
export type Db = ReturnType<typeof getDb>;

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
