import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// The SQLite half of the payment tables, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `payment.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/payment.ts`. Change one and change the other: parity is
// semantic, so each column is the idiomatic form for its dialect and what has to match is
// the shape a row comes back in.
//
// Unlike `billing`'s tables these are the record, not a projection of a vendor's. A manual
// payment has no vendor record at all, so the `payments` row is the source of truth and an
// app reads it by reference. Every status change appends a `payment_events` row, and the
// core in `packages/payment` is the only writer of either table.
//
// Money is an integer in the currency's minor unit, beside an ISO 4217 `currency`.
//
// Timestamps use `timestamp_ms`, matching `auth.sqlite.ts`.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    /** The provider that took it, matching `PaymentProvider.name`. Every later call goes there. */
    provider: text("provider").notNull(),
    /** The method the payer chose, e.g. `card`, `bkash`, `bank`. */
    method: text("method").notNull(),
    /** pending | submitted | successful | failed | cancelled. */
    status: text("status").notNull(),
    /** What the payer owes, in minor units. */
    amount: integer("amount").notNull(),
    /** ISO 4217, upper case. */
    currency: text("currency").notNull(),
    /** What the vendor reported as received, in minor units. */
    settledAmount: integer("settled_amount"),
    /** What the payer said they sent, in minor units. `submit` fills it. */
    claimedAmount: integer("claimed_amount"),
    /** The sum of this payment's refunds. The refund bound is a conditional update on it. */
    refundedAmount: integer("refunded_amount").notNull().default(0),
    /** What the payment is for, e.g. `order`. Opaque to the core. */
    referenceType: text("reference_type").notNull(),
    referenceId: text("reference_id").notNull(),
    /** Who pays, when the app knows. No foreign key: a guest checkout has no user. */
    userId: text("user_id"),
    /** As the payer typed it, or as the vendor reported it. */
    transactionId: text("transaction_id"),
    /** Normalized by the provider. Half of the partial unique index below. */
    transactionIdNormalized: text("transaction_id_normalized"),
    senderAccount: text("sender_account"),
    /** Where a hosted checkout sends the browser afterwards. */
    returnUrl: text("return_url"),
    /** The provider's own data, plus `instructions` for a manual payment. JSON. */
    providerData: text("provider_data", { mode: "json" }),
    submittedAt: timestampMs("submitted_at"),
    settledAt: timestampMs("settled_at"),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One live claim per transaction id, per provider. Partial on purpose: a rejected or
    // cancelled payment frees its id again, so a payment staff rejected by mistake does
    // not burn the id forever (PR #170).
    uniqueIndex("payments_provider_transaction_id_normalized_uidx")
      .on(table.provider, table.transactionIdNormalized)
      .where(sql`status not in ('failed', 'cancelled')`),
    // An app reads its payment by what it is for.
    index("payments_reference_idx").on(table.referenceType, table.referenceId),
    // The staff queue reads by status.
    index("payments_status_idx").on(table.status, table.createdAt),
  ]
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    /** Null on the row that records the payment's creation. */
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    /** The staff member who confirmed or rejected it. Null for the payer and the gateway. */
    actorUserId: text("actor_user_id"),
    /** amount_mismatch | not_found | duplicate | other. Required on a rejection. */
    reason: text("reason"),
    /** Free text for the payer, written by staff on a rejection. */
    note: text("note"),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
  },
  (table) => [
    // Append-only. The detail page reads one payment's history, oldest first.
    index("payment_events_payment_id_idx").on(table.paymentId, table.createdAt),
  ]
);

export const paymentRefunds = sqliteTable(
  "payment_refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    /** Minor units. The sum per payment stays at or below `payments.amount`. */
    amount: integer("amount").notNull(),
    note: text("note"),
    actorUserId: text("actor_user_id"),
    /** The vendor's refund id. Null for a refund staff sent by hand. */
    providerRefundId: text("provider_refund_id"),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
  },
  (table) => [index("payment_refunds_payment_id_idx").on(table.paymentId)]
);
