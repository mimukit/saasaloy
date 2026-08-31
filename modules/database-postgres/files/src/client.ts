import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

// The Postgres client, over postgres.js (`drizzle-orm/postgres-js`). `getDb` resolves a
// connection string off the Worker's `env`, opens a postgres.js connection and wraps it in
// a Drizzle instance carrying the whole schema barrel, so callers get typed relational
// queries. A feature route reads its env off Hono's `c.env` (never `process.env` — a
// Worker has no process) and hands the whole object here:
//
//   const db = getDb(c.env);
//
// `DbBindings` is the binding shape to compose into a route's Hono generic, so `c.env` is
// typed without api's entry needing a code-level patch:
//
//   new Hono<{ Bindings: DbBindings }>()
//
// Both fields are optional because a project supplies exactly one of them:
// `DATABASE_URL` is the default (a Workers secret in production, `.dev.vars` locally) and
// `HYPERDRIVE` only exists once you opt into a Hyperdrive binding. See the
// `saasaloy-database-postgres` skill.
export interface DbBindings {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
}

/**
 * Pick the connection string for this request: the Hyperdrive binding when it is present,
 * `DATABASE_URL` otherwise.
 *
 * Hyperdrive wins on purpose. Its `connectionString` points at Cloudflare's local proxy,
 * which pools connections and caches reads in front of the same database `DATABASE_URL`
 * names, so a project that adds the binding gets the pooled path with no code change and
 * no second place to update the credentials.
 *
 * Throws when neither is set. postgres.js would otherwise fall back to its own libpq-style
 * defaults (localhost, the OS user, no database) and fail later with a connection error
 * that says nothing about the missing configuration.
 */
export function resolveConnectionString(env: DbBindings): string {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No Postgres connection. Set DATABASE_URL (apps/api/.dev.vars locally, " +
        "`wrangler secret put DATABASE_URL` in production) or bind HYPERDRIVE."
    );
  }
  return url;
}

/**
 * Open a Drizzle client for one request.
 *
 * Call this **per request**, not once per module. A Workers isolate outlives the request
 * that created it, but an open socket does not: reusing one postgres.js instance across
 * requests throws "Cannot perform I/O on behalf of a different request". Creating the
 * client here keeps every connection owned by the request that opened it.
 *
 * `fetch_types: false` skips postgres.js's start-up round trip that introspects custom
 * Postgres types. Drizzle sends its own type information, so the query is pure latency,
 * and Hyperdrive's pooled connections cannot answer it consistently anyway. `max: 5` caps
 * the sockets one request may open when it issues queries in parallel.
 *
 * No `ssl` option is passed, deliberately. postgres.js defaults it to `false` and lets the
 * connection string set it, so a remote database asks for TLS with `?sslmode=verify-full`
 * in `DATABASE_URL`. Hardcoding a mode here would override that string and break the two
 * connections that carry no TLS of their own: Hyperdrive's local proxy, and a local
 * container. See the `saasaloy-database-postgres` skill.
 *
 * Close the connection when the response is done, so a socket does not linger for the rest
 * of the isolate's life. `end()` runs as soon as it is called, and postgres.js rejects every
 * query issued after it, so schedule it in a `finally` after the last `await`.
 *
 * `withDb` below does exactly that. Prefer it in a route and call `getDb` directly only
 * where there is no request context to hand it.
 */
export function getDb(env: DbBindings) {
  const sql = postgres(resolveConnectionString(env), {
    max: 5,
    fetch_types: false,
  });
  return drizzle(sql, { schema });
}

/** The Drizzle client this driver hands a repository. */
export type Db = ReturnType<typeof getDb>;

/**
 * The part of a Hono `Context` `withDb` reads. Structural on purpose: `packages/db` stays
 * free of a `hono` dependency, and any request context carrying an `env` and a
 * `waitUntil` fits.
 */
export interface DbRequestContext {
  env: DbBindings;
  executionCtx: { waitUntil: (promise: Promise<unknown>) => void };
}

/**
 * Open a connection for one request, run `body`, and close the socket afterwards.
 *
 * Closing is the whole point. `getDb` opens a real TCP socket per request, and a route
 * that forgets `db.$client.end()` leaks one for the rest of the isolate's life. Written by
 * hand that is a `try`/`finally` in every handler; here it is one wrapper:
 *
 *   waitlist.get("/", (c) => withDb(c, async (db) => c.json(await listWaitlist(db))));
 *
 * The close is scheduled on `executionCtx.waitUntil`, so the response is not held while
 * the socket drains. `end()` starts the moment `body` settles, and postgres.js rejects
 * every query issued after it, so read everything you need inside `body` — never return the
 * `db`, a lazy query builder, or an unawaited promise out of it.
 *
 * Hono throws when it has no execution context to give, which is what `app.request()` does
 * in a unit test. That is caught: the connection still closes, it just closes without the
 * runtime holding the isolate open for it.
 */
export async function withDb<T>(
  c: DbRequestContext,
  body: (db: Db) => Promise<T>
): Promise<T> {
  const db = getDb(c.env);
  try {
    return await body(db);
  } finally {
    // Detach the rejection first. `end()` runs now either way, and an unobserved rejection
    // would take the isolate down rather than the request that caused it.
    const closed = db.$client.end().catch(() => {
      // The socket is going away regardless; there is no caller left to tell.
    });
    try {
      c.executionCtx.waitUntil(closed);
    } catch {
      // No execution context — nothing to keep alive on. The socket still closes.
    }
  }
}
