import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// The Postgres half of the billing projection, selected by
// `onlyWith: "database-postgres"`. Its SQLite twin sits beside it as `billing.sqlite.ts`,
// and exactly one of the two lands as `packages/db/src/schema/billing.ts`. Change one and
// change the other: they are the same three tables, and parity is semantic rather than
// textual — each column is the idiomatic form for its dialect, and what has to match is
// the shape a row comes back in.
//
// These tables are a **projection** of the payment provider's own record, not the record
// itself (ADR 0034). Every id that identifies a row upstream is a provider id, every write
// comes from a webhook the vendor sent, and the whole thing is rebuildable by replaying
// events. That is why `billing` takes provider modules even though the project owns the
// schema: a move from Stripe to Polar re-subscribes customers instead of migrating rows.
//
// The column names are vendor-blind on purpose. `billing-stripe` maps
// `@better-auth/stripe`'s own model onto them through `schema.subscription.fields`, so the
// plugin writes these names and nothing outside the provider file says "Stripe".
//
// Dates are `timestamptz`, matching `auth.pg.ts`. The stored instant is unambiguous and
// the driver hands back a `Date` either way.
//
// Billing owns no `db:generate`/migration step of its own: dropping this file into
// `packages/db/src/schema/` means database's existing barrel + migration scripts pick it up
// like any other table (the ADR 0020 exception — schema is database's domain even when
// another capability authors the table).

const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    /**
     * Which interval the subject is paying on — "month" or "year" as the vendor words it.
     * Written by the provider, read by the admin page beside the price.
     */
    billingInterval: text("billing_interval"),
    /** Set when the vendor schedules the end, before it happens. */
    cancelAt: timestamptz("cancel_at"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamptz("canceled_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** What `referenceId` names — "user" by default, "organization" with `teams`. */
    customerType: text("customer_type").notNull().default("user"),
    endedAt: timestamptz("ended_at"),
    id: text("id").primaryKey(),
    /**
     * Core-only. The lockout job sets it once a row has been `past_due` for longer than
     * BILLING_LOCKOUT_DAYS, and `payment.succeeded` clears it. A locked row keeps its
     * status but stops entitling its plan. No provider ever writes this column.
     */
    lockedAt: timestamptz("locked_at"),
    /** The provider's raw status and anything else it wants to keep, as JSON. */
    metadata: jsonb("metadata"),
    /** End of the interval currently paid for — the renewal date the admin page shows. */
    periodEnd: timestamptz("period_end"),
    /** Start of the interval currently paid for. */
    periodStart: timestamptz("period_start"),
    /** The plan id from `packages/billing/src/plans.ts`, not a vendor price id. */
    plan: text("plan").notNull(),
    /**
     * Which provider owns this row, matching `BillingProvider.name`. Written by the core
     * from the event, never by a provider, so no provider can name another on a row. The
     * renewal sweep filters on it. Nullable: rows written before this column existed carry
     * no provider, and the sweep leaves them alone.
     */
    provider: text("provider"),
    providerCustomerId: text("provider_customer_id").notNull(),
    /** The vendor's id for a pending plan change, when it schedules one. */
    providerScheduleId: text("provider_schedule_id"),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    /** The billable subject's id. See CONTEXT.md → "Billable subject". */
    referenceId: text("reference_id").notNull(),
    /** Core-only. Set when the trial-ending reminder went out, so a replay sends no second one. */
    reminderSentAt: timestamptz("reminder_sent_at"),
    seats: integer("seats"),
    /** One of the normalized statuses in `packages/billing/src/provider.ts`. */
    status: text("status").notNull(),
    trialEnd: timestamptz("trial_end"),
    trialStart: timestamptz("trial_start"),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The vendor's subscription id is the row's identity, so a redelivered webhook
    // converges on one row instead of inserting a second.
    uniqueIndex("billing_subscriptions_provider_subscription_id_uidx").on(
      table.providerSubscriptionId
    ),
    // Every entitlement check is a read by subject, so this index is the hot path.
    index("billing_subscriptions_reference_id_idx").on(
      table.referenceId,
      table.customerType
    ),
  ]
);

export const billingPaymentSubmissions = pgTable(
  "billing_payment_submissions",
  {
    /** "monthly" or "yearly" — the interval the quoted figure is for. */
    billingInterval: text("billing_interval").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** ISO 4217, upper case. BDT for every provider that exists today. */
    currency: text("currency").notNull(),
    /** What `reference_id` names — "user" by default, "organization" with `teams`. */
    customerType: text("customer_type").notNull().default("user"),
    /**
     * What the subject was told to pay, in the currency's minor unit, copied from the plan
     * at checkout. Deliberately stored rather than recomputed at review time: the subject
     * paid what they were quoted, and a price change afterwards must not make their payment
     * look short.
     */
    expectedAmount: integer("expected_amount").notNull(),
    /** Every value the provider's `submissionFields` asked for, normalized. JSON. */
    fields: jsonb("fields").notNull(),
    id: text("id").primaryKey(),
    /** The plan id from `packages/billing/src/plans.ts`. */
    plan: text("plan").notNull(),
    /** Which provider opened it, matching `BillingProvider.name`. */
    provider: text("provider").notNull(),
    /** The billable subject's id. See CONTEXT.md → "Billable subject". */
    referenceId: text("reference_id").notNull(),
    /** What the reviewing admin wrote. The subject reads it on a rejection. */
    reviewNote: text("review_note"),
    reviewedAt: timestamptz("reviewed_at"),
    /** The reviewing admin's user id. */
    reviewedBy: text("reviewed_by"),
    /** pending | approved | rejected | withdrawn. */
    status: text("status").notNull().default("pending"),
    /** The reference as the subject typed it. Null while the shell is still empty. */
    transactionRef: text("transaction_ref"),
    /** The same value trimmed and upper-cased. Half of the partial unique index below. */
    transactionRefNormalized: text("transaction_ref_normalized"),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One live claim per transaction reference, per provider. Partial on purpose: a
    // *rejected* reference frees up again, so an admin who rejects a real payment by
    // mistake does not burn that transaction id forever. A permanent index would need a
    // manual DELETE to undo a misclick.
    uniqueIndex("billing_payment_submissions_transaction_ref_uidx")
      .on(table.provider, table.transactionRefNormalized)
      .where(sql`status <> 'rejected'`),
    // The subject's own reads: the pending check, and the pre-fill.
    index("billing_payment_submissions_reference_id_idx").on(
      table.referenceId,
      table.customerType
    ),
    // The admin queue's read, which is always "pending, oldest first".
    index("billing_payment_submissions_status_idx").on(
      table.status,
      table.createdAt
    ),
  ]
);

export const billingEvents = pgTable(
  "billing_events",
  {
    /** The provider name, matching `BillingProvider.name`. Half of the primary key. */
    provider: text("provider").notNull(),
    /** The vendor's own event id, verbatim. The other half. */
    providerEventId: text("provider_event_id").notNull(),
    /** Stamped once the side effects finished. Null means the job is still in flight. */
    processedAt: timestamptz("processed_at"),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    type: text("type").notNull(),
  },
  (table) => [
    // The dedupe key, and the reason a redelivered event runs no side effect twice: the
    // insert conflicts and `applyEvent` returns before it touches anything else. It is the
    // primary key rather than a unique index so the conflict is unavoidable by any writer.
    //
    // The table is never pruned. It grows by a handful of rows per subscription per month,
    // which is the price of the dedupe guarantee surviving a vendor's redelivery window.
    primaryKey({ columns: [table.provider, table.providerEventId] }),
  ]
);
