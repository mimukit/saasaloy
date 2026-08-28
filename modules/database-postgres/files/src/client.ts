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
export type DbBindings = {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
};

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
        "`wrangler secret put DATABASE_URL` in production) or bind HYPERDRIVE.",
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
 * Close the connection when the response is done, so a socket does not linger for the rest
 * of the isolate's life:
 *
 *   c.executionCtx.waitUntil(db.$client.end());
 */
export function getDb(env: DbBindings) {
  const sql = postgres(resolveConnectionString(env), { max: 5, fetch_types: false });
  return drizzle(sql, { schema });
}
