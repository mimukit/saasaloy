import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// The Postgres half of the API-key table, selected by `onlyWith: "database-postgres"`.
// Its SQLite twin sits beside it as `api-keys.sqlite.ts`, and exactly one of the two
// lands as `packages/db/src/schema/api-keys.ts`. Change one and change the other: they
// are the same table, and `packages/auth/src/db-provider.ts` tells the adapter which
// dialect it is generating SQL for. Parity is semantic, not textual — each column is the
// idiomatic form for its dialect, and what has to match is the shape a row comes back in.
//
// Hand-authored Drizzle snapshot of the API-key plugin's `apikey` model, stored as the
// `api_keys` table, pinned to @better-auth/api-key@1.7.7 (the range this module's
// descriptor patches into packages/auth/package.json). Column for column against that
// version's `apiKeySchema()` plus the Drizzle adapter's Postgres type mapping:
// string→text, boolean→boolean, number→integer, date→timestamp. A version bump implies
// re-verifying this file; `schema-version.test.ts` beside it fails the build until the
// header and the pinned range agree again.
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

// `timestamptz`, for the reason `auth.pg.ts` spells out: a bare `timestamp` drops the
// offset postgres.js sends, and a JS `Date` then reads it back in the server's own zone.
const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const apiKeys = pgTable(
  "api_keys",
  {
    // Which set of plugin options issued this key. One configuration ships here, so every
    // row carries the same value; the column exists because the plugin writes it.
    configId: text("config_id").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    // Off by default and never set by this project's screens. `enabled` is what a revoke
    // toggles when the operator wants the key to stay listed; `delete` removes it.
    enabled: boolean("enabled").notNull().default(true),
    expiresAt: timestamptz("expires_at"),
    id: text("id").primaryKey(),
    // The SHA-256 hash of the key, never the key itself. The plaintext exists exactly
    // once, in the create response, and the plugin has no endpoint that returns it again.
    key: text("key").notNull(),
    lastRefillAt: timestamptz("last_refill_at"),
    // Written on every bearer call by `verifyApiKey`. One synchronous write per request,
    // accepted by decision: `deferUpdates` needs a background-task handler, and Workers
    // has no `waitUntil` behind that hook.
    lastRequest: timestamptz("last_request"),
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
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(true),
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
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // The owner, reached through the plugin's `referenceId` rename. Cascades, so a deleted
    // user takes every key with them.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    // Every bearer call looks a key up by its hash. Without this index that is a
    // sequential scan on the hot path of every machine request.
    index("api_keys_key_idx").on(table.key),
    // `list` reads a user's keys by owner, and the cascade deletes by it.
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_config_id_idx").on(table.configId),
  ]
);
