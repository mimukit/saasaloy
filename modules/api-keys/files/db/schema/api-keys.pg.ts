import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { tenantColumn, tenantIndex } from "../tenant-column";

// The Postgres half of the API-key table, selected by `onlyWith: "database-postgres"`.
// Its SQLite twin sits beside it as `api-keys.sqlite.ts`, and exactly one of the two
// lands as `packages/db/src/schema/api-keys.ts`. Change one and change the other: they
// are the same table, and `packages/auth/src/db-provider.ts` tells the adapter which
// dialect it is generating SQL for. Parity is semantic, not textual — each column is the
// idiomatic form for its dialect, and what has to match is the shape a row comes back in.
//
// Hand-authored Drizzle snapshot of the API-key plugin's `apikey` table, pinned to
// @better-auth/api-key@1.7.2 (the range this module's descriptor patches into
// packages/auth/package.json). Column for column against that version's `apiKeySchema()`
// plus the Drizzle adapter's Postgres type mapping: string→text, boolean→boolean,
// number→integer, date→timestamp. A version bump implies re-verifying this file;
// `schema-version.test.ts` beside it fails the build until the header and the pinned
// range agree again.
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

// `timestamptz`, for the reason `auth.pg.ts` spells out: a bare `timestamp` drops the
// offset postgres.js sends, and a JS `Date` then reads it back in the server's own zone.
const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const apikey = pgTable(
  "apikey",
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
    // The tenant column convention, reached through the plugin's `referenceId` rename.
    organizationId: tenantColumn(),
    // The key's scope, a JSON string of the same shape `access.ts`'s `statements`
    // describes, e.g. `{"project":["read"]}`. Fixed at issue time: editing a role later
    // changes members and never keys.
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
  },
  (table) => [
    // Every bearer call looks a key up by its hash. Without this index that is a
    // sequential scan on the hot path of every machine request.
    index("apikey_key_idx").on(table.key),
    tenantIndex(table, "apikey"),
    index("apikey_config_id_idx").on(table.configId),
  ]
);
