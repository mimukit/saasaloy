import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// The SQLite half of the flag tables, selected by `onlyWith: "database-d1"`. Its pg twin
// sits beside it as `feature-flags.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/feature-flags.ts`. Change one and change the other: they are the
// same two tables, and the repository, the routes and the admin screen are written against
// both.
//
// **These tables are the source of truth.** The `kv` document is a published read cache
// rebuilt from them, so a row here is what survives a cache wipe, and the admin screen
// reads this side rather than the cache — it can never show its own write stale.
//
// A key with no row is not an error: `flag()` falls back to the code default in
// `packages/feature-flags/src/index.ts`. A row appears the first time somebody toggles the
// flag, which is why nothing seeds this table at install time.
export const featureFlag = sqliteTable("feature_flag", {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(CAST(unixepoch('subsecond') * 1000 AS INTEGER))`),
  // Free text for the admin screen. The code definition carries one too; this column is
  // what an operator can edit without a deploy.
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Matches `FlagDefinition.key`. Unique, because one key resolves to one value.
  key: text("key").notNull().unique(),
  // 0–100, and read only when `type` is "percentage". Null on a boolean flag rather than
  // 0, so "no share set" and "a share of nobody" stay distinguishable in the table.
  percentage: integer("percentage"),
  // "boolean" or "percentage". Kept as text rather than a check constraint: the code
  // definition already decides how the value is read, and a drifted row would be a
  // migration to fix, not a query to reject.
  type: text("type").notNull().default("boolean"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(CAST(unixepoch('subsecond') * 1000 AS INTEGER))`),
});

// One row per (flag, tenant) pair, and the level that beats the global value. A tenant with
// no row inherits the global one — the absence is the inheritance, so turning an override
// off means deleting the row rather than storing "same as global".
//
// `flagKey` is the key text, not a foreign key to `feature_flag.id`. A global row only
// exists once somebody has toggled the flag, so an override can legitimately be the first
// row either table has for that key, and a constraint would forbid the ordinary case.
export const featureFlagOverride = sqliteTable(
  "feature_flag_override",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsecond') * 1000 AS INTEGER))`),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    flagKey: text("flag_key").notNull(),
    id: integer("id").primaryKey({ autoIncrement: true }),
    percentage: integer("percentage"),
    // Whatever a project calls a tenant: an organization id under `teams`, or its own
    // string. `feature-flags` deliberately does not depend on `teams`, so this is free text.
    tenantId: text("tenant_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsecond') * 1000 AS INTEGER))`),
  },
  (table) => [
    uniqueIndex("feature_flag_override_key_tenant_idx").on(
      table.flagKey,
      table.tenantId
    ),
  ]
);
