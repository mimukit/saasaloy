import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Hand-authored Drizzle snapshot of Better Auth's core schema (user/session/account/
// verification), pinned to better-auth@1.6.23 (packages/auth/package.json) — NOT
// generated at `add` time (no exec, deterministic, `--diff`-able; see the auth plan's
// "Auth schema" decision). Column-for-column against that version's
// `getAuthTables()` (@better-auth/core/db) plus its Drizzle-adapter SQLite type
// mapping (string→text, boolean→integer{mode:"boolean"}, date→integer
// {mode:"timestamp_ms"} — NOT "timestamp": Better Auth's default date values are
// millisecond epoch integers, so "timestamp" (seconds) would silently corrupt every
// date). A `better-auth` version bump implies re-verifying this file against the new
// version's schema — fix the snapshot, not the adapter config, on mismatch.
//
// Auth deliberately owns no `db:generate`/migration step of its own: dropping this
// file into `packages/db/src/schema/` means database's existing barrel + migration
// scripts (`db:generate`/`db:migrate:local`/`db:migrate:prod`) pick it up like any
// other table — the ADR 0020 exception (schema is database's domain even when
// another capability authors the table).

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .default(createdAtDefault)
    .$onUpdate(() => new Date()),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestampMs("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestampMs("access_token_expires_at"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
