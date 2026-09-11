import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";

// The SQLite half of the organization tables, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `teams.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/teams.ts`. Change one and change the other: they are the same
// four tables, and `packages/auth/src/db-provider.ts` tells the adapter which dialect it
// is generating SQL for. Parity is semantic, not textual — each column is the idiomatic
// form for its dialect, and what has to match is the shape a row comes back in.
//
// Hand-authored Drizzle snapshot of Better Auth 1.7.2's organization plugin schema
// with its nested teams feature disabled. Keep property names aligned with the plugin
// adapter. A Better Auth version change requires a new column-for-column check.
//
// `organizationRole` is here because `organizationPlugin()` sets
// `dynamicAccessControl: { enabled: true }`. Turning that option off does not remove the
// table; drop the table and the option together, or `createRole` writes into nothing.
//
// THE TENANT COLUMN CONVENTION: every table a request may read on behalf of one
// organization declares `organizationId: text("organization_id").notNull().references(()
// => organization.id)` plus one index on it. `member`, `invitation` and
// `organizationRole` all follow it below, which is what lets `forTenant` from
// `@repo/db/tenant` accept them.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const organization = sqliteTable("organization", {
  createdAt: timestampMs("created_at").notNull(),
  id: text("id").primaryKey(),
  logo: text("logo"),
  metadata: text("metadata"),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const member = sqliteTable(
  "member",
  {
    createdAt: timestampMs("created_at").notNull(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    role: text("role").notNull().default("member"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
  ]
);

export const invitation = sqliteTable(
  "invitation",
  {
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    email: text("email").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    id: text("id").primaryKey(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    role: text("role"),
    status: text("status").notNull().default("pending"),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

// A role one organization defined at runtime. `permission` is a JSON string of the same
// shape `access.ts`'s `statements` describes, e.g. `{"project":["read"]}` — the plugin
// serializes it, so read it back through the plugin rather than parsing it in a route.
//
// `hasPermission` merges a row over the static role of the same name, so a row named
// `admin` would extend the static `admin`. `rbac`'s `roleLockGuard()` refuses those
// three names on write; the unique index below only stops one organization from holding
// two rows for one name.
export const organizationRole = sqliteTable(
  "organizationRole",
  {
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    permission: text("permission").notNull(),
    role: text("role").notNull(),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("organization_role_organization_id_idx").on(table.organizationId),
    index("organization_role_role_idx").on(table.role),
    uniqueIndex("organization_role_organization_id_role_uidx").on(
      table.organizationId,
      table.role
    ),
  ]
);
