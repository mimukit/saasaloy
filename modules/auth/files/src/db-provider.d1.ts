import { getDb } from "@repo/db/client";
import type { DbBindings, DbRequestContext } from "@repo/db/client";
import { dbScope } from "./db-scope";

// The D1 half of auth's database wiring, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `db-provider.pg.ts`, and exactly one of the two lands
// as `packages/auth/src/db-provider.ts`. Change one and change the other: `./auth.ts`,
// `./server.ts` and `apps/api/src/routes/auth.ts` are written against both, and none of
// them knows which driver the project holds.
//
// The two files differ in three lines and nothing else: the `provider` string Better
// Auth's Drizzle adapter takes, and what `withAuthScope` does after entering the scope.
// `authDb` and `dbScope` come from `./db-scope.ts` unchanged in both.

/**
 * The dialect Better Auth's Drizzle adapter generates SQL for.
 *
 * It has to agree with `packages/db/src/schema/auth.ts`, which `modules/auth` ships
 * twice for the same reason. `auth.sqlite.ts` lands under this driver.
 */
export const provider = "sqlite" as const;

/**
 * The binding shape a route composing auth into its Hono generic needs.
 *
 * Re-exported from the driver rather than declared here, so `D1Database` appears in this
 * file and nowhere else in `packages/auth`. `./auth.ts` stays free of it, which is what
 * lets one `auth.ts` serve both drivers.
 */
export type AuthDbBindings = DbBindings;

export { authDb } from "./db-scope";

/**
 * Run `body` with this request's database client in scope.
 *
 * D1 hands the Worker a binding stub rather than a socket, so there is nothing to close
 * and this opens a client and runs the callback. It still enters the scope, and that is
 * deliberate rather than a formality: D1 is the default driver, so most development
 * happens here, and a permissive version would let a route that forgets the wrapper pass
 * every local test and throw only after the project switches to Postgres. Forgetting it
 * fails identically under both drivers instead. The cost is one property lookup per
 * `auth.api` call. See ADR 0026 and `./db-scope.ts`.
 *
 * `packages/auth/src/server.ts` re-exports this, and `getSession(c)` already applies it.
 * Reach for it directly only when calling `auth.api.*` or `auth.handler` by hand.
 */
export function withAuthScope<T>(
  c: DbRequestContext,
  body: () => Promise<T>
): Promise<T> {
  return dbScope.run(getDb(c.env), body);
}
