import type { BillingStore } from "./subscription";

// How a job handler reaches the `BillingStore` port, and the one indirection that makes it
// possible.
//
// A route needs nothing here: it holds the request's Drizzle client and passes the port to
// `applyEvent` directly. A **job handler** cannot. `defineJob`'s handler signature is
// `(payload, ctx)` and `JobContext` carries `attempt`, `step` and `sleep` and nothing else
// (packages/queue/src/provider.ts), so there is no argument to hand a client through.
//
// The answer is a resolver registered once at module load, not a scope declared here. The
// scope itself is an `AsyncLocalStorage`, which comes from `node:async_hooks`, and
// importing that in this package would force `"types": ["node"]` on every workspace that
// imports `@repo/billing` — `packages/queue` first, because it imports this package to
// register the job. So `apps/api/src/billing-store.ts` owns the scope and hands its reader
// in through `setBillingStoreResolver`, and this package keeps zero imports of any kind.
//
// The mutable below is set once, at load, with a function. What varies per request lives
// in the scope on the other side of that function, never here.

let resolver: (() => BillingStore | undefined) | undefined;

/** How a job opens a scope of its own when nothing else has. See `setBillingStoreRunner`. */
export type BillingStoreRunner = <T>(body: () => Promise<T>) => Promise<T>;

let runner: BillingStoreRunner | undefined;

/**
 * Tell `packages/billing` how to find the port for the work currently running.
 *
 * `apps/api/src/billing-store.ts` calls this at module load with a reader over its own
 * request scope. Calling it a second time replaces the reader, which is what a test wants
 * and what nothing else should do.
 */
export function setBillingStoreResolver(
  read: () => BillingStore | undefined
): void {
  resolver = read;
}

/**
 * Tell `packages/billing` how to open a scope when it is not already inside one.
 *
 * `apps/api/src/billing-store.ts` calls this at module load with a function that opens the
 * request-less client (`withDb` over the importable Workers `env`), builds the port and
 * enters the scope. A queue consumer, the cron sweep and a provider's own webhook all run
 * outside a billing route, so without this they would reach `requireBillingStore` with
 * nothing in scope and lose the event.
 */
export function setBillingStoreRunner(run: BillingStoreRunner): void {
  runner = run;
}

/**
 * Run `body` with a `BillingStore` in scope, opening one only if none is.
 *
 * This is what every job wraps its work in. Inside a billing route the scope the route
 * already opened is reused, so an inline provider such as `queue-memory` keeps writing
 * through the request's own client and its transaction. Outside one — the Workers queue
 * consumer, the scheduled tick, a vendor webhook posting to the auth plugin's endpoint —
 * the registered runner opens a client for this message and closes it afterwards.
 */
export function inBillingStore<T>(body: () => Promise<T>): Promise<T> {
  if (resolver?.()) {
    return body();
  }
  if (!runner) {
    throw new Error(
      "No BillingStore is in scope and no runner is registered. " +
        "`apps/api/src/billing-store.ts` calls `setBillingStoreRunner` at module load; " +
        "import it from the Worker entry so the call has run before the first message arrives. " +
        "See apps/api/src/billing-store.ts."
    );
  }
  return runner(body);
}

/**
 * The port for the current unit of work, or a throw naming what has to wrap the caller.
 *
 * A throw rather than a lazily built client: this package has zero npm runtime
 * dependencies, so it cannot open a database itself, and guessing one from an importable
 * `env` would leak a socket per message under `database-postgres`.
 */
export function requireBillingStore(): BillingStore {
  const store = resolver?.();
  if (!store) {
    throw new Error(
      "No BillingStore is in scope. Wrap the caller in `withBillingStore(createBillingStore(db), ...)` — " +
        "a billing route does it inside `withDb`, and a job body wraps itself in `inBillingStore(...)`, " +
        "which opens one when the caller is not a route. See apps/api/src/billing-store.ts."
    );
  }
  return store;
}
