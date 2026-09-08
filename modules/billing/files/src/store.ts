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
        "a billing route does it inside `withDb`, and a queue consumer has to do it around `dispatch`. " +
        "See apps/api/src/billing-store.ts."
    );
  }
  return store;
}
