import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

// The SQLite half of the notification tables, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `notifications.pg.ts`, and exactly one of the two lands
// as `packages/db/src/schema/notifications.ts`. Change one and change the other: the
// repository and the routes are written against both.
//
// A row stores rendered text. `notify` writes the title and body the user reads, so the
// table needs no registry of kinds and an old row reads the same after a code change.
//
// Timestamps use `timestamp_ms`, matching `auth.sqlite.ts`. Millisecond precision matters
// here: the page's cursor orders on `created_at`, and whole seconds would tie far more
// often.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const notifications = sqliteTable(
  "notifications",
  {
    /** A category id from `config.notification.categories`. Free text, checked by `notify`. */
    category: text("category").notNull(),
    /** Optional second line. */
    body: text("body"),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    /** An app-relative path the row opens, such as `/settings/billing`. `notify` checks it. */
    href: text("href"),
    /** `crypto.randomUUID()`, set by the repository. */
    id: text("id").primaryKey(),
    /** Null while unread. Set once, so a second "mark read" keeps the first time. */
    readAt: timestampMs("read_at"),
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
export const notificationOptOuts = sqliteTable(
  "notification_opt_outs",
  {
    category: text("category").notNull(),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category] })]
);
