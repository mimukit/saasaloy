import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

// The SQLite half of the admin audit log, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `audit.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/audit.ts`. Change one and change the other: parity is semantic,
// so each column is the idiomatic form for its dialect and what has to match is the shape
// a row comes back in.
//
// One row for each change an admin made through an admin write route. `adminWrite` and
// `adminAuthWrite` in `apps/api/src/lib/admin-write.ts` are the only writers. Append-only:
// no route updates or deletes a row, and nothing prunes the table.
//
// `before` and `after` hold only the fields that changed, under dot-path keys for a nested
// field (`rates.us.perKg`). A create stores `after` only, and a delete `before` only. A key
// that names a password never goes in. Both are JSON text here; Drizzle parses them back,
// so a row reads the same as the `jsonb` columns of the Postgres twin.
//
// The table has no tenant column on purpose: it records site-staff writes. Tenant events
// are issue #142's, in a table of their own that reuses this row shape.
//
// Timestamps use `timestamp_ms`, matching `auth.sqlite.ts`.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** A changed field's value, keyed by its dot path. */
export type AuditFields = Record<string, unknown>;

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    /** The admin who made the change. A removed admin is banned, never deleted. */
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    /** The actor's role when they made the change, such as `admin` or `superadmin`. */
    actorRole: text("actor_role").notNull(),
    /** `<area>.<object>.<verb>`, one of the actions in `apps/api/src/lib/audit-actions.ts`. */
    action: text("action").notNull(),
    /** What changed, such as `payment` or `member`. The action's registry entry names it. */
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    /** The reference admins read: a payment reference, an email, a flag key. */
    targetLabel: text("target_label").notNull(),
    before: text("before", { mode: "json" }).$type<AuditFields>(),
    after: text("after", { mode: "json" }).$type<AuditFields>(),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
  },
  (table) => [
    // The Activity page reads newest first, by person, and by target.
    index("audit_events_created_at_idx").on(table.createdAt),
    index("audit_events_actor_user_id_idx").on(
      table.actorUserId,
      table.createdAt
    ),
    index("audit_events_target_type_target_id_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt
    ),
  ]
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
