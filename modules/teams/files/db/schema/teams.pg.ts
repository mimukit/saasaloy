import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// The Postgres half of the organization tables, selected by
// `onlyWith: "database-postgres"`. Its SQLite twin sits beside it as `teams.sqlite.ts`,
// and exactly one of the two lands as `packages/db/src/schema/teams.ts`. Change one and
// change the other: they are the same four tables, and
// `packages/auth/src/db-provider.ts` tells the adapter which dialect it is generating SQL
// for. Parity is semantic, not textual — each column is the idiomatic form for its
// dialect, and what has to match is the shape a row comes back in.
//
// Hand-authored Drizzle snapshot of Better Auth 1.7.2's organization plugin schema
// with its nested teams feature disabled. Keep property names aligned with the plugin
// adapter. A Better Auth version change requires a new column-for-column check.
//
// `organizationRoles` is here because `organizationPlugin()` sets
// `dynamicAccessControl: { enabled: true }`. Turning that option off does not remove the
// table; drop the table and the option together, or `createRole` writes into nothing.
//
// THE TENANT COLUMN CONVENTION: every table a request may read on behalf of one
// organization declares `organizationId: text("organization_id").notNull().references(()
// => organizations.id)` plus one index on it. `members`, `invitations` and
// `organizationRoles` all follow it below, which is what lets `forTenant` from
// `@repo/db/tenant` accept them.

// `timestamptz`, for the reason `auth.pg.ts` spells out: a bare `timestamp` drops the
// offset postgres.js sends, and a JS `Date` then reads it back in the server's own zone.
// That would disagree with the SQLite variant's millisecond epoch integers.
const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const organizations = pgTable("organizations", {
  createdAt: timestamptz("created_at").notNull(),
  id: text("id").primaryKey(),
  logo: text("logo"),
  metadata: text("metadata"),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const members = pgTable(
  "members",
  {
    createdAt: timestamptz("created_at").notNull(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    role: text("role").notNull().default("member"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index("members_organization_id_idx").on(table.organizationId),
    index("members_user_id_idx").on(table.userId),
  ]
);

export const invitations = pgTable(
  "invitations",
  {
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    email: text("email").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    id: text("id").primaryKey(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    role: text("role"),
    status: text("status").notNull().default("pending"),
  },
  (table) => [
    index("invitations_organization_id_idx").on(table.organizationId),
    index("invitations_email_idx").on(table.email),
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
export const organizationRoles = pgTable(
  "organization_roles",
  {
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    permission: text("permission").notNull(),
    role: text("role").notNull(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("organization_roles_organization_id_idx").on(table.organizationId),
    index("organization_roles_role_idx").on(table.role),
    uniqueIndex("organization_roles_organization_id_role_uidx").on(
      table.organizationId,
      table.role
    ),
  ]
);
