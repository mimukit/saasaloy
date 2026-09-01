import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

// Hand-authored Drizzle snapshot of Better Auth 1.7.2's organization plugin schema
// with its nested teams feature disabled. Keep property names aligned with the plugin
// adapter. A Better Auth version change requires a new column-for-column check.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const organization = sqliteTable(
  "organization",
  {
    createdAt: timestampMs("created_at").notNull(),
    id: text("id").primaryKey(),
    logo: text("logo"),
    metadata: text("metadata"),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
  },
  (table) => [index("organization_slug_idx").on(table.slug)]
);

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
