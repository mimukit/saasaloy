import type {
  BillableSubject,
  SubscriptionEventRecord,
  SubscriptionStore,
  Subscription,
  SubscriptionInput,
  SubscriptionPatch,
  SubscriptionNotification,
} from "@repo/subscription";
import {
  SUBSCRIPTION_EVENT_JOB,
  subscriptionConfig,
  defaultPlan,
  findPlan,
  plans,
  readLockoutDays,
  setSubscriptionConfig,
  setSubscriptionEnqueuer,
  setSubscriptionNotifier,
  setSubscriptionStoreResolver,
  setSubscriptionStoreRunner,
} from "@repo/subscription";
import { config } from "@repo/config";
import { createEmail } from "@repo/email";
import { accountLocked } from "@repo/email/templates/account-locked";
import { paymentFailed } from "@repo/email/templates/payment-failed";
import { trialEnding } from "@repo/email/templates/trial-ending";
import type { EmailEnv } from "@repo/email";
import type { Db, DbBindings } from "@repo/db/client";
import { withDb } from "@repo/db/client";
import { users } from "@repo/db/schema/auth";
import {
  subscriptionEvents,
  subscriptions,
} from "@repo/db/schema/subscription";
import { createQueue } from "@repo/queue";
import type { QueueEnv } from "@repo/queue";
import { env } from "cloudflare:workers";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";

// The `SubscriptionStore` port, built over this request's Drizzle client, and the scope a job
// handler reads it back out of.
//
// `packages/subscription` declares the port and never implements it: the core has zero npm
// runtime dependencies, so it cannot import `drizzle-orm` to write a query, and a
// structural type over a query builder would pin it to one ORM. `apps/api` is the one
// workspace that holds both the schema and the request-scoped client, so the SQL lives
// here (ADR 0029, and the doc comment at the top of packages/subscription/src/subscription.ts).
//
// The scope lives here for a second reason. It is an `AsyncLocalStorage`, which means
// `node:async_hooks`, and importing that inside `packages/subscription` would force
// `"types": ["node"]` on every workspace that imports the package — `packages/queue`
// first, because it imports it to register `subscriptionEventJob()`. So the core exposes
// `setSubscriptionStoreResolver` and this file supplies the reader. Same arrangement as
// `packages/auth/src/db-scope.ts`, which solves the identical problem for Better Auth's
// adapter.
//
// Dialect-neutral by construction. The dialect reaches the table declarations, which
// `modules/subscription` ships twice under `onlyWith`; every builder call below is the same
// under D1 and Postgres.

/** The port belonging to the unit of work currently running, or nothing. */
const storeScope = new AsyncLocalStorage<SubscriptionStore>();

// Registered once, at module load. `apps/api/src/routes/subscription.ts` imports this file, and
// `src/index.ts` imports that route, so both the fetch handler and the Worker's queue
// consumer have the resolver in place before the first message arrives.
setSubscriptionStoreResolver(() => storeScope.getStore());

// The other half of the same registration, and the one that makes the background paths
// work at all. A subscription route opens the scope itself, inside `withDb`. Nothing else does:
// the Workers queue consumer calls `dispatch` from the platform's `queue()` handler, the
// daily sweep arrives on the cron tick, and a vendor webhook posts to the endpoint the auth
// plugin mounts under `/auth/*`. Each of those reaches a job body with no request in scope,
// so the job asks for a scope here instead of throwing.
//
// `withDb` rather than `getDb` on purpose: under `database-postgres` the message owns a real
// socket and something has to close it. There is no `executionCtx` to hand the close to out
// here, so the no-op below lets `withDb` take its "nothing to keep alive on" branch — the
// socket still closes when `body` settles, the runtime just is not asked to wait for it.
setSubscriptionStoreRunner((body) =>
  withDb(
    {
      env: env as unknown as DbBindings,
      executionCtx: {
        waitUntil: () => {
          // No request to keep alive. `withDb` closes the socket either way.
        },
      },
    },
    (db) => withSubscriptionStore(createSubscriptionStore(db), body)
  )
);

// The other half of the same arrangement, for the other direction. A provider whose vendor
// posts to its own webhook endpoint has no route to hand an event to, so it enqueues from
// inside `packages/subscription` — which cannot import `@repo/queue`, because `packages/queue`
// imports it back to register the job. This file holds both packages, so it supplies the
// enqueuer. See `packages/subscription/src/enqueue.ts`.
//
// `env` is the importable Workers one rather than a request's `c.env`: a webhook reaches
// the plugin's endpoint, not a subscription route, so there is no Hono context in scope by then.
setSubscriptionEnqueuer(async (event) => {
  await createQueue(env as unknown as QueueEnv).enqueue(
    SUBSCRIPTION_EVENT_JOB,
    event
  );
});

// The third registration, for the third thing a job handler cannot reach: `env`. A handler
// signature is `(payload, ctx)` (packages/queue/src/provider.ts), so the daily lockout job
// has no way to read `SUBSCRIPTION_LOCKOUT_DAYS` for itself, and the core never reads
// `process.env`. Read once here, where the importable Workers `env` already is.
setSubscriptionConfig({
  lockoutDays: readLockoutDays(
    (env as unknown as { SUBSCRIPTION_LOCKOUT_DAYS?: string })
      .SUBSCRIPTION_LOCKOUT_DAYS
  ),
});

// What the subscription emails call the project, and where they send the reader.
//
// The name is a `config` value: two deployments of this project call it the same thing, so
// it is checked into the repo rather than set per environment. `config.subscription.appName` is
// empty unless a project wants subscription mail signed differently, and the fallback to
// `config.app.name` is applied here because a section never reads another section.
//
// `BILLING_APP_NAME` is retired: subscription no longer declares it, and `saasaloy doctor` says so when it is
// still set in a `.env`. The url stays an env var: it names a deployed origin.
const appName = config.subscription.appName || config.app.name;
const subscriptionUrl =
  (env as unknown as { SUBSCRIPTION_APP_URL?: string }).SUBSCRIPTION_APP_URL ??
  "http://localhost:3001/subscription";

// And the fourth: how a subscription email is actually sent. `packages/subscription` decides when one
// is owed and to whom (packages/subscription/src/notify.ts); which provider sends it, what
// `EMAIL_FROM` is and how the template renders are the email capability's business, and this
// is the one file that holds both packages.
//
// Every call reaching here comes from a queue consumer or the scheduled sweep. No request
// handler sends a subscription email, which is what makes a webhook redelivery cost nothing: the
// `subscription_events` insert in `applyEvent` guards the whole side-effect body.
setSubscriptionNotifier(async (notification: SubscriptionNotification) => {
  await createEmail(env as unknown as EmailEnv).send({
    to: notification.to.email,
    ...content(notification),
  });
});

function content(notification: SubscriptionNotification) {
  const { subscription, to } = notification;
  const name = to.name ?? to.email;
  const planName = planLabel(subscription.plan);

  switch (notification.kind) {
    case "trial.ending": {
      return trialEnding({
        appName,
        subscriptionUrl,
        endsOn: day(subscription.trialEnd ?? subscription.periodEnd),
        name,
        planName,
      });
    }
    case "payment.failed": {
      return paymentFailed({
        appName,
        subscriptionUrl,
        // The date the sweep would lock this row, computed from the row's own `updatedAt`
        // rather than the clock. The sweep selects `updatedAt < now - lockoutDays`, and a
        // `payment.failed` event carries an invoice, not a subscription, so `applyEvent`
        // reads the row instead of upserting it and `updatedAt` keeps the timestamp from
        // when the status first turned `past_due`. Off the clock the email would name a
        // date later than the one the job acts on.
        lockoutOn: day(
          new Date(
            subscription.updatedAt.getTime() +
              subscriptionConfig().lockoutDays * 24 * 60 * 60 * 1000
          )
        ),
        name,
        planName,
      });
    }
    default: {
      return accountLocked({
        appName,
        subscriptionUrl,
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
 * Every subscription route wraps its handler in this, inside `withDb`, so anything the request
 * reaches — including a job it enqueues into an inline provider such as `queue-memory` —
 * finds the same request-scoped client. A queue consumer that dispatches outside a request
 * has to do the same around its own `dispatch` call.
 */
export function withSubscriptionStore<T>(
  store: SubscriptionStore,
  body: () => Promise<T>
): Promise<T> {
  return storeScope.run(store, body);
}

/** Build the port over `db`. Call it inside `withDb`, and hand it to `withSubscriptionStore`. */
export function createSubscriptionStore(db: Db): SubscriptionStore {
  return {
    latestSubscription(subject: BillableSubject) {
      return (
        db
          .select()
          .from(subscriptions)
          .where(subjectMatches(subject))
          // Newest first, so a resubscribe wins over the history rows the table keeps.
          .orderBy(desc(subscriptions.createdAt))
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
        .update(subscriptionEvents)
        .set({ processedAt: at })
        .where(
          and(
            eq(subscriptionEvents.provider, provider),
            eq(subscriptionEvents.providerEventId, providerEventId)
          )
        );
    },

    // The daily sweep's whole query. `locked_at is null` keeps it idempotent: a row this
    // job already locked is out of the set, so a second tick on the same day locks nothing
    // and sends no second email.
    pastDueSince(before: Date) {
      return db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, "past_due"),
            isNull(subscriptions.lockedAt),
            lt(subscriptions.updatedAt, before)
          )
        )
        .then((rows) => rows as Subscription[]);
    },

    async patchSubscription(id: string, patch: SubscriptionPatch) {
      await db.update(subscriptions).set(patch).where(eq(subscriptions.id, id));
    },

    // The insert is the dedupe, not a read-then-write. `(provider, provider_event_id)` is
    // the table's primary key, so the conflict comes from the database and no second
    // delivery can race past it. An empty `returning()` means the row was already there.
    // Where a subscription email goes. The default subject is a user, so this is one read of the
    // `users` table by id. `teams` replaces `subject.ts` to bill an organization instead, and
    // this method is the other half of that swap: it would read the organization's subscription
    // contact for `customerType === "organization"`. Until then an unknown type resolves to
    // nothing and the core skips the send rather than failing the job.
    async recipientFor(subject: BillableSubject) {
      if (subject.customerType !== "user") {
        return;
      }
      return await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, subject.referenceId))
        .limit(1)
        .then((rows) => rows.at(0));
    },

    recordEvent(record: SubscriptionEventRecord) {
      return db
        .insert(subscriptionEvents)
        .values(record)
        .onConflictDoNothing()
        .returning({ provider: subscriptionEvents.provider })
        .then((rows) => rows.length > 0);
    },

    upsertSubscription(subject: BillableSubject, input: SubscriptionInput) {
      const now = new Date();
      // `provider_subscription_id` is unique, so a redelivered vendor state converges on
      // the one row instead of inserting a second. `lockedAt` and `reminderSentAt` are
      // absent from both the insert and the update on purpose: they are core-only columns
      // and `patchSubscription` is the only writer.
      return db
        .insert(subscriptions)
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
          target: subscriptions.providerSubscriptionId,
        })
        .returning()
        .then((rows) => rows[0] as Subscription);
    },
  };
}

function subjectMatches(subject: BillableSubject) {
  return and(
    eq(subscriptions.referenceId, subject.referenceId),
    eq(subscriptions.customerType, subject.customerType)
  );
}
