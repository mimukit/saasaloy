import type {
  BillableSubject,
  BillingEventRecord,
  BillingStore,
  Subscription,
  SubscriptionInput,
  SubscriptionPatch,
} from "@repo/billing";
import {
  BILLING_EVENT_JOB,
  setBillingEnqueuer,
  setBillingStoreResolver,
} from "@repo/billing";
import type { Db } from "@repo/db/client";
import { billingEvent, billingSubscription } from "@repo/db/schema/billing";
import { createQueue } from "@repo/queue";
import type { QueueEnv } from "@repo/queue";
import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";

// The `BillingStore` port, built over this request's Drizzle client, and the scope a job
// handler reads it back out of.
//
// `packages/billing` declares the port and never implements it: the core has zero npm
// runtime dependencies, so it cannot import `drizzle-orm` to write a query, and a
// structural type over a query builder would pin it to one ORM. `apps/api` is the one
// workspace that holds both the schema and the request-scoped client, so the SQL lives
// here (ADR 0029, and the doc comment at the top of packages/billing/src/subscription.ts).
//
// The scope lives here for a second reason. It is an `AsyncLocalStorage`, which means
// `node:async_hooks`, and importing that inside `packages/billing` would force
// `"types": ["node"]` on every workspace that imports the package — `packages/queue`
// first, because it imports it to register `billingEventJob()`. So the core exposes
// `setBillingStoreResolver` and this file supplies the reader. Same arrangement as
// `packages/auth/src/db-scope.ts`, which solves the identical problem for Better Auth's
// adapter.
//
// Dialect-neutral by construction. The dialect reaches the table declarations, which
// `modules/billing` ships twice under `onlyWith`; every builder call below is the same
// under D1 and Postgres.

/** The port belonging to the unit of work currently running, or nothing. */
const storeScope = new AsyncLocalStorage<BillingStore>();

// Registered once, at module load. `apps/api/src/routes/billing.ts` imports this file, and
// `src/index.ts` imports that route, so both the fetch handler and the Worker's queue
// consumer have the resolver in place before the first message arrives.
setBillingStoreResolver(() => storeScope.getStore());

// The other half of the same arrangement, for the other direction. A provider whose vendor
// posts to its own webhook endpoint has no route to hand an event to, so it enqueues from
// inside `packages/billing` — which cannot import `@repo/queue`, because `packages/queue`
// imports it back to register the job. This file holds both packages, so it supplies the
// enqueuer. See `packages/billing/src/enqueue.ts`.
//
// `env` is the importable Workers one rather than a request's `c.env`: a webhook reaches
// the plugin's endpoint, not a billing route, so there is no Hono context in scope by then.
setBillingEnqueuer(async (event) => {
  await createQueue(env as unknown as QueueEnv).enqueue(
    BILLING_EVENT_JOB,
    event
  );
});

/**
 * Run `body` with `store` in scope.
 *
 * Every billing route wraps its handler in this, inside `withDb`, so anything the request
 * reaches — including a job it enqueues into an inline provider such as `queue-memory` —
 * finds the same request-scoped client. A queue consumer that dispatches outside a request
 * has to do the same around its own `dispatch` call.
 */
export function withBillingStore<T>(
  store: BillingStore,
  body: () => Promise<T>
): Promise<T> {
  return storeScope.run(store, body);
}

/** Build the port over `db`. Call it inside `withDb`, and hand it to `withBillingStore`. */
export function createBillingStore(db: Db): BillingStore {
  return {
    latestSubscription(subject: BillableSubject) {
      return (
        db
          .select()
          .from(billingSubscription)
          .where(subjectMatches(subject))
          // Newest first, so a resubscribe wins over the history rows the table keeps.
          .orderBy(desc(billingSubscription.createdAt))
          .limit(1)
          .then((rows) => rows.at(0) as Subscription | undefined)
      );
    },

    async markEventProcessed(
      provider: string,
      providerEventId: string,
      at: Date
    ) {
      await db
        .update(billingEvent)
        .set({ processedAt: at })
        .where(
          and(
            eq(billingEvent.provider, provider),
            eq(billingEvent.providerEventId, providerEventId)
          )
        );
    },

    async patchSubscription(id: string, patch: SubscriptionPatch) {
      await db
        .update(billingSubscription)
        .set(patch)
        .where(eq(billingSubscription.id, id));
    },

    // The insert is the dedupe, not a read-then-write. `(provider, provider_event_id)` is
    // the table's primary key, so the conflict comes from the database and no second
    // delivery can race past it. An empty `returning()` means the row was already there.
    recordEvent(record: BillingEventRecord) {
      return db
        .insert(billingEvent)
        .values(record)
        .onConflictDoNothing()
        .returning({ provider: billingEvent.provider })
        .then((rows) => rows.length > 0);
    },

    upsertSubscription(subject: BillableSubject, input: SubscriptionInput) {
      const now = new Date();
      // `provider_subscription_id` is unique, so a redelivered vendor state converges on
      // the one row instead of inserting a second. `lockedAt` and `reminderSentAt` are
      // absent from both the insert and the update on purpose: they are core-only columns
      // and `patchSubscription` is the only writer.
      return db
        .insert(billingSubscription)
        .values({
          ...input,
          createdAt: now,
          customerType: subject.customerType,
          id: crypto.randomUUID(),
          referenceId: subject.referenceId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: { ...input, updatedAt: now },
          target: billingSubscription.providerSubscriptionId,
        })
        .returning()
        .then((rows) => rows[0] as Subscription);
    },
  };
}

function subjectMatches(subject: BillableSubject) {
  return and(
    eq(billingSubscription.referenceId, subject.referenceId),
    eq(billingSubscription.customerType, subject.customerType)
  );
}
