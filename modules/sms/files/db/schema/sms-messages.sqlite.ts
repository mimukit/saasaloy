import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The SQLite half of the SMS log, selected by `onlyWith: "database-d1"`. Its Postgres twin
// sits beside it as `sms-messages.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/sms-messages.ts`. Change one and change the other.
//
// One row per send, written by the caller through `logSms()`. It answers "did the text go
// out", and a send limit counts its rows with `countSmsSince()`. The body is never stored:
// it can hold a one-time code, and `template` already tells the messages apart.
/** What a send came to. A text column typed to these two, not a database enum. */
export const SMS_STATUSES = ["sent", "failed"] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

export const smsMessages = sqliteTable(
  "sms_messages",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsecond') * 1000 AS INTEGER))`),
    /** The provider's error text on a failed send. The admin screen masks codes in it. */
    error: text("error"),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** `SMS_PROVIDER` at send time, so a provider swap stays legible in the log. */
    provider: text("provider").notNull(),
    /** The provider's own message id, when it returns one. */
    providerRef: text("provider_ref"),
    /** Free text the caller names, such as `sign_up` or `password_reset`. */
    purpose: text("purpose").notNull(),
    status: text("status", { enum: SMS_STATUSES }).notNull(),
    /** The template the body came from, such as `verification-code`. */
    template: text("template").notNull(),
    /** E.164. */
    toPhone: text("to_phone").notNull(),
    // Plain text with no foreign key: `sms` does not depend on `auth`, and a code sent to
    // a number with no account yet has no user. Null in that case.
    userId: text("user_id"),
  },
  (table) => [
    // The send limit: one number's rows for one purpose since a moment.
    index("sms_messages_to_phone_purpose_created_at_idx").on(
      table.toPhone,
      table.purpose,
      table.createdAt
    ),
    // The admin log, newest first across every number.
    index("sms_messages_created_at_idx").on(table.createdAt),
  ]
);
