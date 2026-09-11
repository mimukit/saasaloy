import { withDb } from "@repo/db/client";
import type { Db, DbBindings, DbRequestContext } from "@repo/db/client";
import { authDb as scopedAuthDb, dbScope } from "./db-scope";

// The Postgres half of auth's database wiring, selected by
// `onlyWith: "database-postgres"`. Its D1 twin sits beside it as `db-provider.d1.ts`,
// and exactly one of the two lands as `packages/auth/src/db-provider.ts`. Change one and
// change the other: `./auth.ts`, `./server.ts` and `apps/api/src/routes/auth.ts` are
// written against both, and none of them knows which driver the project holds.
//
// The two files differ in three lines and nothing else: the `provider` string Better
// Auth's Drizzle adapter takes, and what `withAuthScope` does after entering the scope.
// `authDb` and `dbScope` come from `./db-scope.ts` unchanged in both.

/**
 * The dialect Better Auth's Drizzle adapter generates SQL for.
 *
 * It has to agree with `packages/db/src/schema/auth.ts`, which `modules/auth` ships
 * twice for the same reason. `auth.pg.ts` lands under this driver.
 */
export const provider = "pg" as const;

/**
 * The binding shape a route composing auth into its Hono generic needs.
 *
 * Re-exported from the driver rather than declared here, so a route names one type under
 * either driver even though the bindings behind it are `DATABASE_URL`/`HYPERDRIVE` here
 * and a `DB` binding under D1.
 */
export type AuthDbBindings = DbBindings;

/**
 * The request-scoped client, carrying this driver's `Db` type.
 *
 * `./db-scope.ts` builds it as a `Proxy` over an empty object and may not import
 * `@repo/db/client` — the repo's own `node --test` run loads that file with no bundler,
 * so a workspace import would not resolve. A `Proxy` is typed as its target, so the
 * export arrives as `Record<string, unknown>` and `authDb.select` is `unknown`. This
 * file already holds the driver's import, so the type is restored here, where `Db` means
 * the Postgres client and nothing in `./auth.ts` has to name a driver to query a table.
 */
export const authDb = scopedAuthDb as unknown as Db;

/**
 * Open a connection for this request, run `body` with it in scope, and close the socket
 * afterwards.
 *
 * The close is the reason this whole scope exists. `getDb` opens a real TCP socket, a
 * Workers isolate outlives the request that opened it, and postgres.js throws "Cannot
 * perform I/O on behalf of a different request" the moment a second request reuses the
 * first one's client. `withDb` from `@repo/db/client` owns the open and the close and
 * schedules the close on `c.executionCtx.waitUntil`; this adds only the scope Better
 * Auth's module-scope `auth` reads through.
 *
 * The connection starts closing as soon as `body` settles, so read everything you need
 * inside it. Never return a lazy query builder or an unawaited promise out of `body`.
 *
 * `packages/auth/src/server.ts` re-exports this, and `getSession(c)` already applies it.
 * Reach for it directly only when calling `auth.api.*` or `auth.handler` by hand.
 */
export function withAuthScope<T>(
  c: DbRequestContext,
  body: () => Promise<T>
): Promise<T> {
  return withDb(c, (db) => dbScope.run(db, body));
}
