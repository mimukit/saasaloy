import { notifyBilling } from "./notify";
import type { BillingNotificationKind, BillingRecipient } from "./notify";
import { isLiveStatus } from "./provider";
import type {
  BillableSubject,
  BillingEvent,
  PaymentSubmission,
  PlanInterval,
  Subscription,
  SubscriptionInput,
  SubscriptionStatus,
  SubscriptionWrite,
} from "./provider";

// Reading the projection, and writing it from a normalized event. Everything that touches
// `billing_subscriptions` and `billing_events` goes through here, so the dedupe rule lives in
// one place and a provider never writes a row itself (ADR 0034).
//
// The database arrives as a **port**, not as a Drizzle client. `packages/billing` has zero
// npm runtime dependencies, so it cannot import `drizzle-orm` to type a query, and a
// structural type over a query builder would pin the core to one ORM's shape. A port of
// five named methods keeps the core vendor-blind, keeps these rules unit-testable with a
// fake, and leaves the SQL in the one workspace that owns the schema. `apps/api` builds
// the port over its request-scoped client (ADR 0029) and hands it in.

/** What `applyEvent` writes into `billing_events`. */
export interface BillingEventRecord {
  provider: string;
  providerEventId: string;
  type: string;
  receivedAt: Date;
}

/** Columns only the core writes. A provider never sets one of these. */
export interface SubscriptionPatch {
  lockedAt?: Date | null;
  reminderSentAt?: Date | null;
  /**
   * Written by the renewal job and by nothing else in the core.
   *
   * A status is a provider's word everywhere except here: under manual renewal there is no
   * vendor to say that a period ran out with no new payment, so the core says it. The write
   * also refreshes `updatedAt`, which is what opens the lockout window on the row.
   */
  status?: SubscriptionStatus;
}

/**
 * The persistence port. One implementation per project, built over the installed database
 * driver; the tests in this folder use an in-memory fake.
 */
export interface BillingStore {
  /**
   * Insert the event row. Returns `false` when `(provider, providerEventId)` is already
   * there, which is the whole dedupe: it is the table's primary key, so the answer comes
   * from the database rather than from a read the next delivery could race.
   */
  recordEvent(record: BillingEventRecord): Promise<boolean>;
  /** Stamp `processedAt` once the side effects for this event are done. */
  markEventProcessed(
    provider: string,
    providerEventId: string,
    at: Date
  ): Promise<void>;
  /** The most recent row for this subject, whatever its status. */
  latestSubscription(
    subject: BillableSubject
  ): Promise<Subscription | undefined>;
  /**
   * Insert or update the row `providerSubscriptionId` names, under this subject. The
   * column is unique, so a redelivered vendor state converges rather than duplicating.
   */
  upsertSubscription(
    subject: BillableSubject,
    input: SubscriptionWrite
  ): Promise<Subscription>;
  /** Write the core-only columns on one row. */
  patchSubscription(id: string, patch: SubscriptionPatch): Promise<void>;
  /**
   * Every row still `past_due` whose `past_due` window opened before `before` and which
   * the lockout job has not locked yet. The daily job's whole query.
   *
   * "Opened before" is read off `updatedAt`, because the projection has one writer and it
   * stamps that column on every vendor state change — so it is the moment the vendor last
   * said `past_due`. A separate `pastDueSince` column would be a second thing to keep in
   * step for no extra truth.
   */
  pastDueSince(before: Date): Promise<Subscription[]>;
  /**
   * Every live row owned by one of `providers` whose paid period has already ended at
   * `at` — `periodEnd` for an `active` row, `trialEnd` for a `trialing` one — and which is
   * not locked. The renewal job's whole query.
   *
   * `providers` is the set that declares `renewal: "manual"`. An empty set selects nothing,
   * so a project on Stripe alone runs the sweep and touches no row.
   */
  renewalDue(at: Date, providers: string[]): Promise<Subscription[]>;
  /**
   * Where a billing email for this subject goes, or nothing when the project can no longer
   * resolve one — a deleted user, an organization with no billing contact.
   *
   * On the port rather than in the notifier because the answer is a database read, and
   * `apps/api` is the workspace that owns the schema. `subject.ts` decides *what* a subject
   * is; this decides where to write to it, and `teams` replaces both together.
   */
  recipientFor(subject: BillableSubject): Promise<BillingRecipient | undefined>;

  // The manual-settlement queue. Every method below is core-only: no provider is handed the
  // port, and the admin review route reaches `billing_subscriptions` through the event path
  // like everything else (ADR 0034, ADR 0040).

  /** Open the shell a manual checkout starts from. Carries no reference yet. */
  openSubmission(input: NewPaymentSubmission): Promise<PaymentSubmission>;
  /** The subject's one `pending` submission, or nothing. */
  pendingSubmission(
    subject: BillableSubject
  ): Promise<PaymentSubmission | undefined>;
  /** The subject's most recent submission of any status. What the pre-fill reads. */
  latestSubmission(
    subject: BillableSubject
  ): Promise<PaymentSubmission | undefined>;
  /** The most recent submission this subject made *before* `before`. The change flag's other half. */
  previousSubmission(
    subject: BillableSubject,
    before: Date
  ): Promise<PaymentSubmission | undefined>;
  submissionById(id: string): Promise<PaymentSubmission | undefined>;
  /**
   * Write the subject's reference and field values onto their `pending` shell.
   *
   * Throws `BillingError("invalid_request", …, { providerCode: "duplicate_reference" })`
   * when the partial unique index refuses the reference, so the route answers 409 rather
   * than surfacing a driver's own constraint name.
   */
  fillSubmission(
    id: string,
    fill: SubmissionFill
  ): Promise<PaymentSubmission | undefined>;
  /** The queue, newest first, optionally narrowed to one status. */
  listSubmissions(
    status: PaymentSubmission["status"] | undefined,
    limit: number
  ): Promise<PaymentSubmission[]>;
  /**
   * Move one submission out of `pending`, **only if it is still `pending`**.
   *
   * Returns the updated row, or nothing when no row changed. That is the whole race guard
   * between two admins reviewing the same submission: the loser reads nothing back and the
   * route answers 409 naming who got there first.
   */
  reviewSubmission(
    id: string,
    review: SubmissionReview
  ): Promise<PaymentSubmission | undefined>;
}

/** The shell a manual checkout opens. */
export interface NewPaymentSubmission {
  provider: string;
  subject: BillableSubject;
  plan: string;
  billingInterval: PlanInterval;
  /** The figure quoted at checkout, in the currency's minor unit. Never recomputed later. */
  expectedAmount: number;
  currency: string;
}

/** What `POST /billing/submission` writes onto the shell. */
export interface SubmissionFill {
  transactionRef: string;
  transactionRefNormalized: string;
  fields: Record<string, string>;
}

/** What an admin's decision writes. `status` is never `pending`. */
export interface SubmissionReview {
  status: "approved" | "rejected" | "withdrawn";
  reviewedBy: string | null;
  reviewedAt: Date;
  reviewNote: string | null;
}

/**
 * The subject's live subscription, or `undefined`. "Live" means the status still entitles
 * the paid plan (`trialing`, `active`, `past_due`) **and** the lockout job has not set
 * `lockedAt`. A locked row is deliberately not live: that is how a `past_due` subject drops
 * to the default plan after `BILLING_LOCKOUT_DAYS` without the vendor changing anything.
 */
export async function currentSubscription(
  db: BillingStore,
  subject: BillableSubject
): Promise<Subscription | undefined> {
  const latest = await db.latestSubscription(subject);
  if (!latest) {
    return undefined;
  }
  if (!isLiveStatus(latest.status) || latest.lockedAt) {
    return undefined;
  }
  return latest;
}

/** What `applyEvent` reports back to its caller. */
export interface ApplyEventResult {
  /** False only when the event was already recorded, so no side effect ran. */
  applied: boolean;
  /** True when `(provider, providerEventId)` was already in `billing_events`. */
  duplicate: boolean;
  /** The row as it stands after the write, when the event carried subscription state. */
  subscription?: Subscription;
  /** Which billing email this event sent, if any. Nothing when it sent none. */
  notified?: BillingNotificationKind;
}

/**
 * The event types whose side effect needs the current row even when the vendor sent none
 * with the event.
 *
 * Stripe is the reason this list exists. `invoice.paid` and `invoice.payment_failed` carry
 * an invoice, not a subscription, so `stripeBilling` maps them with no projected row —
 * correctly, since there is no vendor subscription state in them to project. But clearing a
 * lockout and sending a dunning email both need the row, so the core reads it back rather
 * than doing nothing at all on the one event that ends a lockout.
 */
const NEEDS_CURRENT_ROW = new Set<BillingEvent["type"]>([
  "payment.succeeded",
  "payment.failed",
  "trial.ending",
]);

/**
 * Apply one normalized event to the projection.
 *
 * The `billing_events` insert comes **first**, and a conflict returns immediately. That
 * ordering is the dedupe guarantee: every side effect below it — the row write, the lock
 * clear, and in Phase 5 the emails — sits inside the guarded body, so a vendor redelivering
 * the same event id runs none of them a second time.
 */
export async function applyEvent(
  db: BillingStore,
  event: BillingEvent,
  now: Date = new Date()
): Promise<ApplyEventResult> {
  const fresh = await db.recordEvent({
    provider: event.provider,
    providerEventId: event.providerEventId,
    receivedAt: now,
    type: event.type,
  });

  if (!fresh) {
    return { applied: false, duplicate: true };
  }

  let subscription: Subscription | undefined;

  if (event.subscription) {
    subscription = await db.upsertSubscription(
      event.subject,
      project(event.type, event.subscription, now, event.provider)
    );
  } else if (NEEDS_CURRENT_ROW.has(event.type)) {
    // No projected row on the event, but the side effect below needs one. See
    // `NEEDS_CURRENT_ROW`: this is the `invoice.paid` path, and it is what ends a lockout.
    subscription = await db.latestSubscription(event.subject);
  }

  let notified: BillingNotificationKind | undefined;

  if (subscription) {
    // A successful payment is the one event that clears a lockout: the subject paid, so
    // whatever the daily job locked is released. `lockedAt` is core-only, so no provider
    // can set or clear it by accident.
    if (event.type === "payment.succeeded" && subscription.lockedAt) {
      await db.patchSubscription(subscription.id, { lockedAt: null });
      subscription = { ...subscription, lockedAt: null };
    }

    // The trial reminder is once per subscription, not once per delivery. `billing_events`
    // already stops a redelivered event id, but a vendor may legitimately send
    // `trial_will_end` twice under two ids — Stripe does, on a trial that gets extended —
    // and the subject should still get one email. `reminderSentAt` is the row-level guard
    // that covers that, and it is core-only for the same reason `lockedAt` is.
    if (event.type === "trial.ending" && !subscription.reminderSentAt) {
      const sent = await notify(
        db,
        "trial.ending",
        event.subject,
        subscription
      );
      if (sent) {
        await db.patchSubscription(subscription.id, { reminderSentAt: now });
        subscription = { ...subscription, reminderSentAt: now };
        notified = "trial.ending";
      }
    }

    // Every distinct failed charge is worth an email: dunning is a sequence, and the
    // lockout job three failures later is the thing that finally changes the plan.
    if (event.type === "payment.failed") {
      const sent = await notify(
        db,
        "payment.failed",
        event.subject,
        subscription
      );
      if (sent) {
        notified = "payment.failed";
      }
    }
  }

  await db.markEventProcessed(event.provider, event.providerEventId, now);
  invalidateEntitlements(event.subject);

  return {
    applied: true,
    duplicate: false,
    ...(notified === undefined ? {} : { notified }),
    ...(subscription === undefined ? {} : { subscription }),
  };
}

/**
 * Send one billing email, and report whether it went.
 *
 * A subject with no resolvable address is a skip, not a throw. The alternative is a job
 * that fails, retries, fails again and finally dead-letters a *deleted user's* trial
 * reminder — a queue full of work that can never succeed. The state write above it has
 * already happened and is the part that matters.
 */
async function notify(
  db: BillingStore,
  kind: BillingNotificationKind,
  subject: BillableSubject,
  subscription: Subscription
): Promise<boolean> {
  const to = await db.recipientFor(subject);
  if (!to?.email) {
    return false;
  }
  await notifyBilling({ kind, subject, subscription, to });
  return true;
}

/**
 * Fill in what the event type implies but the provider did not spell out.
 *
 * Two things. `provider` is copied off the event and overwrites anything of that name on
 * the input, which is what stops a provider from writing another provider's name onto a row
 * and taking its renewals. And a deletion gets the terminal shape: providers report it with
 * their own status, and the projection stores `canceled` with an `endedAt` so a later read
 * needs no per-vendor knowledge.
 */
function project(
  type: BillingEvent["type"],
  input: SubscriptionInput,
  now: Date,
  provider: string
): SubscriptionWrite {
  const write: SubscriptionWrite = { ...input, provider };

  if (type !== "subscription.deleted") {
    return write;
  }
  return {
    ...write,
    canceledAt: input.canceledAt ?? now,
    endedAt: input.endedAt ?? now,
    status: "canceled",
  };
}

/**
 * Drop any cached entitlement answer for this subject. A no-op today, because
 * `entitlements` memoizes per request only and a request never outlives an event. It is
 * called from the one place a plan can change, so adding a `kv` cache later (issue filed
 * after #129) is an edit to this function and to nothing else.
 */
export function invalidateEntitlements(_subject: BillableSubject): void {
  // Intentionally empty. See the doc comment.
}
