import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Hand-authored Drizzle snapshot of Better Auth's core schema (user/session/account/
// verification) plus the fields its `admin` plugin adds, pinned to better-auth@1.6.25
// (packages/auth/package.json) — NOT
// generated at `add` time (no exec, deterministic, `--diff`-able; see the auth plan's
// "Auth schema" decision). Column-for-column against that version's
// `getAuthTables()` (@better-auth/core/db) plus its Drizzle-adapter SQLite type
// mapping (string→text, boolean→integer{mode:"boolean"}, date→integer
// {mode:"timestamp_ms"} — NOT "timestamp": Better Auth's default date values are
// millisecond epoch integers, so "timestamp" (seconds) would silently corrupt every
// date). A `better-auth` version bump implies re-verifying this file against the new
// version's schema — fix the snapshot, not the adapter config, on mismatch. The admin
// fields come from that plugin's own `schema` export (`better-auth/plugins`, admin/
// schema.ts) and are marked inline below; re-verify them on a bump too. Note the
// Drizzle *property* name is what the adapter matches (`banReason`), not the SQL column
// name (`ban_reason`) — the adapter does no case conversion, so renaming a property
// silently detaches the field.
//
// Auth deliberately owns no `db:generate`/migration step of its own: dropping this
// file into `packages/db/src/schema/` means database's existing barrel + migration
// scripts (`db:generate`/`db:migrate:local`/`db:migrate:prod`) pick it up like any
// other table — the ADR 0020 exception (schema is database's domain even when
// another capability authors the table).

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const user = sqliteTable("user", {
  createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .default(createdAtDefault)
    .$onUpdate(() => new Date()),
  // --- admin plugin (`admin()` in packages/auth/src/auth.ts) ---
  // Nullable on purpose: the plugin writes the default role `"user"` in its own
  // create hook, so a DB-level default would only mask a plugin that got removed.
  // `role` is the single field the admin app's guard reads (`role === "admin"`).
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: timestampMs("ban_expires"),
});

export const session = sqliteTable(
  "session",
  {
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    expiresAt: timestampMs("expires_at").notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // --- admin plugin --- set only while an admin impersonates this user; the
    // plugin hides impersonated sessions from `listSessions` by reading it.
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

export const account = sqliteTable(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestampMs("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    scope: text("scope"),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_user_id_idx").on(table.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    expiresAt: timestampMs("expires_at").notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);
