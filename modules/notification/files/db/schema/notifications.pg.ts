import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// The Postgres half of the notification tables, selected by `onlyWith: "database-postgres"`.
// Its SQLite twin sits beside it as `notifications.sqlite.ts`, and exactly one of the two
// lands as `packages/db/src/schema/notifications.ts`. Change one and change the other: the
// repository and the routes are written against both. Parity is semantic, not textual:
// each column is the idiomatic form for its dialect, and what has to match is the shape a
// row comes back in.
//
// A row stores rendered text. `notify` writes the title and body the user reads, so the
// table needs no registry of kinds and an old row reads the same after a code change.

// `timestamptz`, for the reason `auth.pg.ts` spells out: a bare `timestamp` drops the
// offset postgres.js sends, and a JS `Date` then reads it back in the server's own zone.
const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const notifications = pgTable(
  "notifications",
  {
    /** A category id from `config.notification.categories`. Free text, checked by `notify`. */
    category: text("category").notNull(),
    /** Optional second line. */
    body: text("body"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** An app-relative path the row opens, such as `/settings/billing`. `notify` checks it. */
    href: text("href"),
    /** `crypto.randomUUID()`, set by the repository. */
    id: text("id").primaryKey(),
    /** Null while unread. Set once, so a second "mark read" keeps the first time. */
    readAt: timestamptz("read_at"),
    title: text("title").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    // The page and the menu read one user's rows newest first, and the cursor walks it.
    index("notifications_user_id_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
    // The unread count filters one user's rows on `read_at` being null.
    index("notifications_user_id_read_at_idx").on(table.userId, table.readAt),
  ]
);

// One row per category a user turned off. No row means the category is on, so a new
// category starts on for every user with no backfill.
export const notificationOptOuts = pgTable(
  "notification_opt_outs",
  {
    category: text("category").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category] })]
);
