import { AsyncLocalStorage } from "node:async_hooks";

// The request scope the auth database client lives in, and the proxy Better Auth's
// Drizzle adapter binds once at module load. Both database drivers share this file;
// `./db-provider.ts` is the per-driver half that enters the scope.
//
// Why a scope at all. `./auth.ts` builds `auth` at module scope, because the
// plugin-array patch point needs a module-scope `export const` (the comment there
// records it). `drizzleAdapter` takes a bound client rather than a factory, so the
// naive reading is that the client has to be module-scope too. Under
// `database-postgres` that is a bug with a two-request fuse: a Workers isolate
// outlives the request that created it, an open socket does not, and reusing one
// postgres.js instance across requests throws "Cannot perform I/O on behalf of a
// different request". The first sign-in works, the next request fails. See
// `packages/db/src/client.ts` and ADR 0026.
//
// So the adapter binds `authDb`, which holds no client of its own. It reads the one
// the current request put in `dbScope`. `withAuthScope` in `./db-provider.ts` is what
// puts it there, and `packages/auth/src/server.ts` plus `apps/api/src/routes/auth.ts`
// are what call it.
//
// `node:async_hooks` is available on workerd because this module's descriptor adds the
// `nodejs_compat` compatibility flag to `apps/api/wrangler.jsonc`. It is the only
// import in this file, and that is deliberate: the repo's own `src/db-scope.test.ts`
// runs this file under `node --test` with no bundler and no tsconfig, so a workspace
// import such as `@repo/db/client` would not resolve. `./db-provider.ts` carries every
// import that needs one. The same rule governs `./env.ts`.

/**
 * The Drizzle client belonging to the request currently running.
 *
 * Typed as `object` rather than the driver's `Db` for the import rule above. The
 * `db-provider` variant that calls `run()` supplies a real client, and `authDb` below
 * is the only reader.
 */
export const dbScope = new AsyncLocalStorage<object>();

/**
 * Properties that answer `undefined` outside a scope instead of throwing.
 *
 * `_` is the load-bearing one. `drizzleAdapter(db, config)` reads `db._?.schema` in its
 * own body (`@better-auth/drizzle-adapter@1.7.2`, `drizzle-adapter.ts`), which runs
 * while `./auth.ts` is still being imported — before any request exists. Throwing there
 * would take the Worker down on load rather than on a misuse. The adapter reads it to
 * build a relation-key map for `findOne`/`findMany` calls that pass `join`, and it
 * already handles an absent registry: `getOneToOneRelationKey` returns the plain model
 * name when the key set is empty. `@db/schema/auth.ts` declares no Drizzle `relations()`
 * either way, so that map is empty in both readings and the behaviour is the same.
 * Declare `relations()` over the auth tables and this is the line to revisit.
 *
 * `then` is the other one. Any `await` or promise adoption probes it, and an unrelated
 * `await` should not surface as an auth error.
 */
const PASSIVE_KEYS = new Set(["_", "then"]);

function outsideScope(prop: string): never {
  throw new Error(
    `@repo/auth read "${prop}" off the request-scoped database client outside ` +
      "`withAuthScope`. Better Auth holds one module-scope `auth`, but its database " +
      "client belongs to a single request, so every `auth.handler` and `auth.api.*` " +
      "call has to run inside the scope: " +
      "`withAuthScope(c, () => auth.api.getSession({ headers: c.req.raw.headers }))`. " +
      "`getSession(c)` from `@repo/auth/server` already does it. See " +
      "packages/auth/src/db-scope.ts."
  );
}

// A `Proxy` over an empty extensible object with no own properties, so the `get` trap
// may return anything without tripping a proxy invariant. `get` is the only trap the
// adapter needs: it reaches `db.select`, `db.insert`, `db.update`, `db.delete`,
// `db.query` and `db._`, and `DrizzleAdapterConfig.transaction` defaults to `false`, so
// `db.transaction` is never called. It also never probes with `in` or `Object.keys` on
// the client itself.
const authDbTarget: Record<string, unknown> = {};

/**
 * The database client `./auth.ts` hands `drizzleAdapter`.
 *
 * Every read resolves against the client `withAuthScope` put in `dbScope` for the
 * request that is running, so one module-scope `auth` serves every request with that
 * request's own connection. A read outside a scope throws, under both drivers, so a
 * route that forgets the wrapper fails the same way on D1 as on Postgres rather than
 * passing in development and failing after the driver switch.
 *
 * Methods come back bound to the real client. `db.select()` is called as a method, and
 * an unbound function would run with the proxy as its `this`.
 */
export const authDb = new Proxy(authDbTarget, {
  get(target, prop) {
    const db = dbScope.getStore();
    if (db === undefined) {
      // Symbols are runtime and tooling probes — `Symbol.toStringTag`,
      // `util.inspect.custom`, `Symbol.toPrimitive`. None of them is a misuse worth
      // throwing over, and one of them firing inside a logger would mask the real error.
      // The empty target answers them, which is `undefined` for every one.
      if (typeof prop === "symbol" || PASSIVE_KEYS.has(prop)) {
        return Reflect.get(target, prop) as unknown;
      }
      outsideScope(prop);
    }
    const value = Reflect.get(db, prop) as unknown;
    return typeof value === "function" ? value.bind(db) : value;
  },
});
