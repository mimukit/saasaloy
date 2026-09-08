import { isLiveStatus } from "./provider";
import type {
  BillableSubject,
  BillingEvent,
  Subscription,
  SubscriptionInput,
} from "./provider";

// Reading the projection, and writing it from a normalized event. Everything that touches
// `billing_subscription` and `billing_event` goes through here, so the dedupe rule lives in
// one place and a provider never writes a row itself (ADR 0034).
//
// The database arrives as a **port**, not as a Drizzle client. `packages/billing` has zero
// npm runtime dependencies, so it cannot import `drizzle-orm` to type a query, and a
// structural type over a query builder would pin the core to one ORM's shape. A port of
// five named methods keeps the core vendor-blind, keeps these rules unit-testable with a
// fake, and leaves the SQL in the one workspace that owns the schema. `apps/api` builds
// the port over its request-scoped client (ADR 0029) and hands it in.

/** What `applyEvent` writes into `billing_event`. */
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
    input: SubscriptionInput
  ): Promise<Subscription>;
  /** Write the core-only columns on one row. */
  patchSubscription(id: string, patch: SubscriptionPatch): Promise<void>;
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
  /** True when `(provider, providerEventId)` was already in `billing_event`. */
  duplicate: boolean;
  /** The row as it stands after the write, when the event carried subscription state. */
  subscription?: Subscription;
}

/**
 * Apply one normalized event to the projection.
 *
 * The `billing_event` insert comes **first**, and a conflict returns immediately. That
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
      project(event.type, event.subscription, now)
    );

    // A successful payment is the one event that clears a lockout: the subject paid, so
    // whatever the daily job locked is released. `lockedAt` is core-only, so no provider
    // can set or clear it by accident.
    if (event.type === "payment.succeeded" && subscription.lockedAt) {
      await db.patchSubscription(subscription.id, { lockedAt: null });
      subscription = { ...subscription, lockedAt: null };
    }
  }

  await db.markEventProcessed(event.provider, event.providerEventId, now);
  invalidateEntitlements(event.subject);

  return {
    applied: true,
    duplicate: false,
    ...(subscription === undefined ? {} : { subscription }),
  };
}

/**
 * Fill in what the event type implies but the vendor did not spell out. A deletion is the
 * only one: providers report it with their own terminal status, and the projection stores
 * `canceled` with an `endedAt` so a later read needs no per-vendor knowledge.
 */
function project(
  type: BillingEvent["type"],
  input: SubscriptionInput,
  now: Date
): SubscriptionInput {
  if (type !== "subscription.deleted") {
    return input;
  }
  return {
    ...input,
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
