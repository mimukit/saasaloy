import type {
  BillableSubject,
  BillingEventRecord,
  BillingStore,
  Subscription,
  SubscriptionInput,
  SubscriptionPatch,
  BillingNotification,
} from "@repo/billing";
import {
  BILLING_EVENT_JOB,
  billingConfig,
  defaultPlan,
  findPlan,
  plans,
  readLockoutDays,
  setBillingConfig,
  setBillingEnqueuer,
  setBillingNotifier,
  setBillingStoreResolver,
} from "@repo/billing";
import { createEmail } from "@repo/email";
import { accountLocked } from "@repo/email/templates/account-locked";
import { paymentFailed } from "@repo/email/templates/payment-failed";
import { trialEnding } from "@repo/email/templates/trial-ending";
import type { EmailEnv } from "@repo/email";
import type { Db } from "@repo/db/client";
import { user } from "@repo/db/schema/auth";
import { billingEvent, billingSubscription } from "@repo/db/schema/billing";
import { createQueue } from "@repo/queue";
import type { QueueEnv } from "@repo/queue";
import { env } from "cloudflare:workers";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
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

// The third registration, for the third thing a job handler cannot reach: `env`. A handler
// signature is `(payload, ctx)` (packages/queue/src/provider.ts), so the daily lockout job
// has no way to read `BILLING_LOCKOUT_DAYS` for itself, and the core never reads
// `process.env`. Read once here, where the importable Workers `env` already is.
setBillingConfig({
  lockoutDays: readLockoutDays(
    (env as unknown as { BILLING_LOCKOUT_DAYS?: string }).BILLING_LOCKOUT_DAYS
  ),
});

/** What the billing emails call the project, and where they send the reader. */
const appName =
  (env as unknown as { BILLING_APP_NAME?: string }).BILLING_APP_NAME ??
  "your app";
const billingUrl =
  (env as unknown as { BILLING_APP_URL?: string }).BILLING_APP_URL ??
  "http://localhost:3001/billing";

// And the fourth: how a billing email is actually sent. `packages/billing` decides when one
// is owed and to whom (packages/billing/src/notify.ts); which provider sends it, what
// `EMAIL_FROM` is and how the template renders are the email capability's business, and this
// is the one file that holds both packages.
//
// Every call reaching here comes from a queue consumer or the scheduled sweep. No request
// handler sends a billing email, which is what makes a webhook redelivery cost nothing: the
// `billing_event` insert in `applyEvent` guards the whole side-effect body.
setBillingNotifier(async (notification: BillingNotification) => {
  await createEmail(env as unknown as EmailEnv).send({
    to: notification.to.email,
    ...content(notification),
  });
});

function content(notification: BillingNotification) {
  const { subscription, to } = notification;
  const name = to.name ?? to.email;
  const planName = planLabel(subscription.plan);

  switch (notification.kind) {
    case "trial.ending": {
      return trialEnding({
        appName,
        billingUrl,
        endsOn: day(subscription.trialEnd ?? subscription.periodEnd),
        name,
        planName,
      });
    }
    case "payment.failed": {
      return paymentFailed({
        appName,
        billingUrl,
        // The date the sweep would lock this row, computed from the same number the sweep
        // reads, so the email cannot promise a grace period the job does not honour.
        lockoutOn: day(
          new Date(
            Date.now() + billingConfig().lockoutDays * 24 * 60 * 60 * 1000
          )
        ),
        name,
        planName,
      });
    }
    default: {
      return accountLocked({
        appName,
        billingUrl,
        defaultPlanName: defaultPlan(plans).name,
        name,
        planName,
      });
    }
  }
}

/** A plan's display name, or its raw id when the project has since dropped the tier. */
function planLabel(id: string): string {
  try {
    return findPlan(plans, id).name;
  } catch {
    return id;
  }
}

/** `2026-09-08`. Deliberately not localized: the Worker has no reader locale to use. */
function day(at: Date | null | undefined): string {
  return (at ?? new Date()).toISOString().slice(0, 10);
}

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

    // The daily sweep's whole query. `locked_at is null` keeps it idempotent: a row this
    // job already locked is out of the set, so a second tick on the same day locks nothing
    // and sends no second email.
    pastDueSince(before: Date) {
      return db
        .select()
        .from(billingSubscription)
        .where(
          and(
            eq(billingSubscription.status, "past_due"),
            isNull(billingSubscription.lockedAt),
            lt(billingSubscription.updatedAt, before)
          )
        )
        .then((rows) => rows as Subscription[]);
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
    // Where a billing email goes. The default subject is a user, so this is one read of the
    // `user` table by id. `teams` replaces `subject.ts` to bill an organization instead, and
    // this method is the other half of that swap: it would read the organization's billing
    // contact for `customerType === "organization"`. Until then an unknown type resolves to
    // nothing and the core skips the send rather than failing the job.
    async recipientFor(subject: BillableSubject) {
      if (subject.customerType !== "user") {
        return;
      }
      return await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, subject.referenceId))
        .limit(1)
        .then((rows) => rows.at(0));
    },

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
