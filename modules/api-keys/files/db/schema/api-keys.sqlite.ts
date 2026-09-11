import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenantColumn, tenantIndex } from "../tenant-column";

// The SQLite half of the API-key table, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `api-keys.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/api-keys.ts`. Change one and change the other: they are the
// same table, and `packages/auth/src/db-provider.ts` tells the adapter which dialect it
// is generating SQL for. Parity is semantic, not textual — each column is the idiomatic
// form for its dialect, and what has to match is the shape a row comes back in.
//
// Hand-authored Drizzle snapshot of the API-key plugin's `apikey` model, stored as the
// `api_keys` table, pinned to @better-auth/api-key@1.7.2 (the range this module's
// descriptor patches into packages/auth/package.json). Column for column against that
// version's `apiKeySchema()` plus the Drizzle adapter's SQLite type mapping: string→text,
// boolean→integer {mode:"boolean"}, number→integer, date→integer{mode:"timestamp_ms"} —
// NOT "timestamp" (seconds), which would silently corrupt every date. A version bump
// implies re-verifying this file; `schema-version.test.ts` beside it fails the build
// until the header and the pinned range agree again.
//
// THE PROPERTY NAME IS WHAT THE ADAPTER MATCHES, not the SQL column name. The plugin's
// own field is `referenceId`, and `apiKeyPlugin()` in
// `packages/auth/src/plugins/api-key.ts` renames it to `organizationId` through
// `schema.apikey.fields.referenceId`. That rename is the only reason this table meets the
// tenant column convention, so the two files change together or the adapter writes into a
// column that is not there.
//
// `references: "organization"` makes that id an organization id, so a key is owned by an
// organization and never by a user. `enableSessionForAPIKeys` is off, so nothing here
// mints a session; the bearer resolver in `packages/auth/src/resolvers/api-key.ts` turns a
// verified key into a `Tenant` instead.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const apiKeys = sqliteTable(
  "api_keys",
  {
    // Which set of plugin options issued this key. One configuration ships here, so every
    // row carries the same value; the column exists because the plugin writes it.
    configId: text("config_id").notNull(),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    // Off by default and never set by this project's screens. `enabled` is what a revoke
    // toggles when the operator wants the key to stay listed; `delete` removes it.
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    expiresAt: timestampMs("expires_at"),
    id: text("id").primaryKey(),
    // The SHA-256 hash of the key, never the key itself. The plaintext exists exactly
    // once, in the create response, and the plugin has no endpoint that returns it again.
    key: text("key").notNull(),
    lastRefillAt: timestampMs("last_refill_at"),
    // Written on every bearer call by `verifyApiKey`. One synchronous write per request,
    // accepted by decision: `deferUpdates` needs a background-task handler, and Workers
    // has no `waitUntil` behind that hook.
    lastRequest: timestampMs("last_request"),
    metadata: text("metadata"),
    // Nullable, because the plugin declares it optional. `requireName: true` in
    // `apiKeyPlugin()` is what makes every key this project issues carry one; the column
    // stays as the plugin declares it so the snapshot matches the adapter, not the config.
    name: text("name"),
    // The tenant column convention, reached through the plugin's `referenceId` rename.
    organizationId: tenantColumn(),
    // The key's scope, a JSON string of the same shape `access.ts`'s `statements`
    // describes, e.g. `{"project":["read"]}`. Fixed at issue time: editing a role later
    // changes members and never keys.
    permissions: text("permissions"),
    prefix: text("prefix"),
    rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    rateLimitMax: integer("rate_limit_max"),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    refillAmount: integer("refill_amount"),
    refillInterval: integer("refill_interval"),
    // The plugin's own limiter, quota and refill are all off in `apiKeyPlugin()`. The
    // columns stay because the plugin writes `requestCount` regardless, and because
    // dropping a column the adapter knows about is how a snapshot starts lying.
    remaining: integer("remaining"),
    requestCount: integer("request_count").notNull().default(0),
    // The first characters of the key, prefix included, so the screen can name a key
    // without holding it. `startingCharactersConfig.charactersLength` is 8.
    start: text("start"),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .default(createdAtDefault)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Every bearer call looks a key up by its hash. Without this index that is a full
    // scan on the hot path of every machine request.
    index("api_keys_key_idx").on(table.key),
    tenantIndex(table, "api_keys"),
    index("api_keys_config_id_idx").on(table.configId),
  ]
);
