import type { BillingEvent } from "./provider";

// How a provider puts a normalized event on the queue, and the indirection that keeps the
// workspace graph acyclic. The sibling of `./store.ts`, for the same reason and by the same
// shape.
//
// `billing-console` never needs this: it has no webhook, so it hands its event back as
// `CheckoutResult.event` and the route in `apps/api` enqueues it. A provider with a real
// webhook has no route to hand anything to — the vendor posts straight to an endpoint the
// auth plugin mounts — so it has to enqueue from inside `packages/billing`.
//
// It cannot import `@repo/queue` to do that. `packages/queue/src/index.ts` imports *this*
// package to register `billingEventJob()`, so an import back is a cycle for one function.
// (It is the same constraint that makes `jobs/event.ts` declare the `Job` shape
// structurally instead of importing it.) So the core declares the port and `apps/api` —
// the one workspace that already holds both packages — supplies it at module load.

/** What a provider hands the queue. `apps/api` implements it over `createQueue(env)`. */
export type BillingEnqueuer = (event: BillingEvent) => Promise<void>;

let enqueuer: BillingEnqueuer | undefined;

/**
 * Tell `packages/billing` how to reach the queue.
 *
 * `apps/api/src/billing-store.ts` calls this at module load. Calling it again replaces the
 * enqueuer, which is what a test wants and what nothing else should do.
 */
export function setBillingEnqueuer(enqueue: BillingEnqueuer): void {
  enqueuer = enqueue;
}

/**
 * Put a normalized event on the queue, or throw naming what has to register the enqueuer.
 *
 * A throw rather than a silent drop: a webhook whose side effects vanish is the failure
 * mode this whole capability is built to avoid, and it would otherwise look identical to a
 * vendor that never delivered.
 */
export function enqueueBillingEvent(event: BillingEvent): Promise<void> {
  if (!enqueuer) {
    throw new Error(
      "No billing enqueuer is registered. `apps/api/src/billing-store.ts` calls " +
        "`setBillingEnqueuer` at module load; import it from the Worker entry so the " +
        "call has run before the first webhook arrives."
    );
  }
  return enqueuer(event);
}
