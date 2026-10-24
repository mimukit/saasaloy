import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

// The SQLite half of the API-key table, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `api-keys.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/api-keys.ts`. Change one and change the other: they are the
// same table, and `packages/auth/src/db-provider.ts` tells the adapter which dialect it
// is generating SQL for. Parity is semantic, not textual — each column is the idiomatic
// form for its dialect, and what has to match is the shape a row comes back in.
//
// Hand-authored Drizzle snapshot of the API-key plugin's `apikey` model, stored as the
// `api_keys` table, pinned to @better-auth/api-key@1.7.7 (the range this module's
// descriptor patches into packages/auth/package.json). Column for column against that
// version's `apiKeySchema()` plus the Drizzle adapter's SQLite type mapping: string→text,
// boolean→integer {mode:"boolean"}, number→integer, date→integer{mode:"timestamp_ms"} —
// NOT "timestamp" (seconds), which would silently corrupt every date. A version bump
// implies re-verifying this file; `schema-version.test.ts` beside it fails the build
// until the header and the pinned range agree again.
//
// THE PROPERTY NAME IS WHAT THE ADAPTER MATCHES, not the SQL column name. The plugin's
// own field is `referenceId`, and `apiKeyPlugin()` in
// `packages/auth/src/plugins/api-key.ts` renames it to `userId` through
// `schema.apikey.fields.referenceId`. The two files change together, or the adapter
// writes into a column that is not there.
//
// `references: "user"` makes that id a user id, so a key is owned by one user and never
// by an organization. The foreign key to `users` cascades, so deleting an account deletes
// its keys and leaves no live credential behind. `enableSessionForAPIKeys` is off, so
// nothing here mints a session; `requireCaller` in `packages/auth/src/caller.ts` turns a
// verified key into its owner's caller instead.

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
    // The key's scope, a JSON string of resource to actions, e.g. `{"cards":["read"]}`.
    // Every pair was checked against `API_KEY_SCOPES` at issue time, and the value is
    // fixed from then on: editing the vocabulary later never changes a key.
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
    // The owner, reached through the plugin's `referenceId` rename. Cascades, so a deleted
    // user takes every key with them.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    // Every bearer call looks a key up by its hash. Without this index that is a full
    // scan on the hot path of every machine request.
    index("api_keys_key_idx").on(table.key),
    // `list` reads a user's keys by owner, and the cascade deletes by it.
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_config_id_idx").on(table.configId),
  ]
);
