import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// The Postgres half of Better Auth's tables, selected by
// `onlyWith: "database-postgres"`. Its SQLite twin sits beside it as `auth.sqlite.ts`,
// and exactly one of the two lands as `packages/db/src/schema/auth.ts`. Change one and
// change the other: they are the same four tables, and
// `packages/auth/src/db-provider.ts` tells the adapter which dialect it is generating
// SQL for. Parity is semantic, not textual — each column is the idiomatic form for its
// dialect, and what has to match is the shape a row comes back in.
//
// Hand-authored Drizzle snapshot of Better Auth's core schema (user/session/account/
// verification) plus the fields its `admin` plugin adds, pinned to better-auth@1.7.2
// (packages/auth/package.json) — NOT
// generated at `add` time (no exec, deterministic, `--diff`-able; see the auth plan's
// "Auth schema" decision). Column-for-column against that version's
// `getAuthTables()` (@better-auth/core/db) plus the Drizzle adapter's own Postgres type
// mapping, which its schema generator states outright: string→text, boolean→boolean,
// number→integer, date→timestamp, and an id of `text("id").primaryKey()`
// (@better-auth/drizzle-adapter, generate-drizzle-schema.ts). A `better-auth` version
// bump implies re-verifying this file against the new version's schema — fix the
// snapshot, not the adapter config, on mismatch. The admin fields come from that
// plugin's own `schema` export (`better-auth/plugins`, admin/schema.ts) and are marked
// inline below; re-verify them on a bump too. Note the Drizzle *property* name is what
// the adapter matches (`banReason`), not the SQL column name (`ban_reason`) — the
// adapter does no case conversion, so renaming a property silently detaches the field.
//
// Re-verifying against 1.7.2 moved one thing: `account` gained a required `issuer`
// column and a unique index over (`issuer`, `accountId`). Better Auth writes
// `local:credential` there for an email/password account and `local:oauth:<provider>`
// for a linked social account, so the pair replaces (`providerId`, `accountId`) as the
// row's identity. Both are below, matching the SQLite variant. A project that installed
// auth before this landed has `account` rows with no `issuer`; unlike SQLite, Postgres
// can add a NOT NULL column to a populated table given a `DEFAULT`, so the generated
// migration still wants the backfill the auth skill carries. Nothing else moved: the
// other three tables and every admin-plugin field match 1.7.2 column for column.
//
// Auth deliberately owns no `db:generate`/migration step of its own: dropping this
// file into `packages/db/src/schema/` means database's existing barrel + migration
// scripts pick it up like any other table — the ADR 0020 exception (schema is
// database's domain even when another capability authors the table). `db:generate`
// belongs to the `database` core; the apply command belongs to the installed driver.

// `timestamptz`, where the adapter's generator emits a bare `timestamp`. The stored
// value is an absolute instant either way, but `timestamp without time zone` drops the
// offset postgres.js sends and reads back a string a JS `Date` then interprets in the
// server's own zone. `timestamptz` costs the same and cannot be misread, which is what
// makes it agree with the SQLite variant's millisecond epoch integers. The same choice
// is made in `modules/waitlist/files/db/schema/waitlist.pg.ts`.
const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const user = pgTable("user", {
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  // --- admin plugin (`admin()` in packages/auth/src/auth.ts) ---
  // Nullable on purpose: the plugin writes the default role `"user"` in its own
  // create hook, so a DB-level default would only mask a plugin that got removed.
  // `role` is the single field the admin app's guard reads (`role === "admin"`).
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamptz("ban_expires"),
});

export const session = pgTable(
  "session",
  {
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // --- admin plugin --- set only while an admin impersonates this user; the
    // plugin hides impersonated sessions from `listSessions` by reading it.
    impersonatedBy: text("impersonated_by"),
    // --- teams patch point --- nullable because the organization plugin sets it only
    // after a user chooses an active organization. This mirrors the plugin's `session`
    // schema block even when the teams module is not installed.
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

export const account = pgTable(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    // Added in better-auth 1.7.2. `local:credential` for an email/password account,
    // `local:oauth:<provider>` for a linked social one.
    issuer: text("issuer").notNull(),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
    scope: text("scope"),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("account_issuer_account_id_uidx").on(
      table.issuer,
      table.accountId
    ),
    index("account_user_id_idx").on(table.userId),
  ]
);

export const verification = pgTable(
  "verification",
  {
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);
