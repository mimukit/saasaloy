import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// The Postgres half of the flag tables, selected by `onlyWith: "database-postgres"`. Its
// SQLite twin sits beside it as `feature-flags.sqlite.ts`, and exactly one of the two lands
// as `packages/db/src/schema/feature-flags.ts`. Change one and change the other: they are
// the same two tables, and the repository, the routes and the admin screen are written
// against both. Parity is semantic, not textual — each column is the idiomatic form for its
// dialect, and what has to match is the shape a row comes back in.
//
// **These tables are the source of truth.** The `kv` document is a published read cache
// rebuilt from them, so a row here is what survives a cache wipe, and the admin screen reads
// this side rather than the cache — it can never show its own write stale.
//
// A key with no row is not an error: `flag()` falls back to the code default in
// `packages/feature-flags/src/index.ts`. A row appears the first time somebody toggles the
// flag, which is why nothing seeds this table at install time.
export const featureFlags = pgTable("feature_flags", {
  // `timestamptz`, matching the millisecond integers the SQLite twin stores: both come back
  // as a `Date` with sub-second precision, which is what makes a route body port between
  // the two drivers unchanged.
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  // Free text for the admin screen. The code definition carries one too; this column is
  // what an operator can edit without a deploy.
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  // An identity column, not `serial`: `GENERATED ALWAYS AS IDENTITY` is the standard form
  // and refuses a write that would desynchronise the sequence. Matches the waitlist table.
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Matches `FlagDefinition.key`. Unique, because one key resolves to one value.
  key: text("key").notNull().unique(),
  // 0–100, and read only when `type` is "percentage". Null on a boolean flag rather than 0,
  // so "no share set" and "a share of nobody" stay distinguishable in the table.
  percentage: integer("percentage"),
  // "boolean" or "percentage". Kept as text rather than an enum: adding a third kind would
  // otherwise be a type migration on every deployed database before the code that reads it
  // can ship.
  type: text("type").notNull().default("boolean"),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per (flag, tenant) pair, and the level that beats the global value. A tenant with
// no row inherits the global one — the absence is the inheritance, so turning an override
// off means deleting the row rather than storing "same as global".
//
// `flagKey` is the key text, not a foreign key to `feature_flags.id`. A global row only
// exists once somebody has toggled the flag, so an override can legitimately be the first
// row either table has for that key, and a constraint would forbid the ordinary case.
export const featureFlagOverrides = pgTable(
  "feature_flag_overrides",
  {
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    enabled: boolean("enabled").notNull().default(false),
    flagKey: text("flag_key").notNull(),
    // An identity column, not `serial`: `GENERATED ALWAYS AS IDENTITY` is the standard form
    // and refuses a write that would desynchronise the sequence. Matches the waitlist table.
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    percentage: integer("percentage"),
    // Whatever a project calls a tenant: an organization id under `teams`, or its own
    // string. `feature-flags` deliberately does not depend on `teams`, so this is free text.
    tenantId: text("tenant_id").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("feature_flag_overrides_key_tenant_idx").on(
      table.flagKey,
      table.tenantId
    ),
  ]
);
