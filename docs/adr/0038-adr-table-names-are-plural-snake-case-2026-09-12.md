# 0038 — Table names are plural snake_case

Every table a module ships is named in plural snake_case, and so is every table Better Auth and its plugins own. The Drizzle export key is the camelCase form of the same plural. `packages/auth/src/auth.ts` passes `usePlural: true` to `drizzleAdapter`, which is what lets Better Auth's singular model names find plural tables. Settled while planning `docs/plans/0056-plan-plural-table-names-2026-09-12.md`.

## Status
accepted.

## Context

Before this record the registry had four naming styles at once. `auth` shipped Better Auth's own singular names (`user`, `session`). `teams` shipped `organizationRole` as a camelCase SQL name. `feature-flags` and `billing` used singular snake_case (`feature_flag`, `billing_subscription`). `waitlist` named its table after a mass noun. A project that added its own `orders` table next to them had no rule to follow, and the skills gave examples in whichever style the nearest module used.

`user` is also a reserved word in Postgres. The auth skill had to write `update "user" set role ...` with quotes, and a reader who dropped the quotes got a syntax error, or on some clients a query against the current role.

## Decision

- A table name is plural snake_case: `users`, `feature_flags`, `billing_subscriptions`. Only the last word takes the plural: `feature_flag_overrides`. A join table names both sides: `team_members`.
- The Drizzle export key is the camelCase form of that plural (`featureFlagOverrides`). The file name stays kebab-case and names the feature, so `waitlist.ts` holds `waitlistEntries`.
- A column stays singular: `user_id`, `organization_id`.
- An index is named after its table: `sessions_user_id_idx`.
- A mass noun takes a count noun instead of a bare `s`: `waitlist_entries`.

Plural wins over singular for two reasons. A project's own tables are collections, and a developer names them `orders` and `invoices` without being told, so a singular rule would be the one every new table breaks. And the plural removes the reserved-word problem for `user` in raw SQL, where the auth skill needs it most.

## How `usePlural` enforces it

`@better-auth/drizzle-adapter` finds a table by its **export key** in the schema object (`schema[model]`), never by the SQL table name. With the default config it asks for `user`. With `usePlural: true` it asks for `users`, in plain queries and in joins (`getQueryModel`). Checked against better-auth 1.7.3.

This has no compile-time check. A singular export key, or an `auth.ts` without `usePlural`, type-checks and then throws `The model "user" was not found in the schema object` on the first sign-up. `scripts/table-names.test.ts` is the guard: it fails when a module schema exports a singular key, when an index does not start with its table name, when a `.pg.ts` file and its `.sqlite.ts` twin disagree, or when `auth.ts` drops `usePlural`.

## The `modelName` + `s` trap

`usePlural` appends a plain `s`, and it appends it to a plugin's custom `modelName` as well (`getModelName` in `@better-auth/core/dist/db/adapter/get-model-name.mjs`). So a plugin configured with `modelName: "X"` needs the export key `Xs`.

- `billing-stripe` sets `modelName: "billingSubscription"`. The export key is therefore `billingSubscriptions`, which is also the camelCase plural of the table.
- `@better-auth/api-key` calls its model `apikey`, and a plain `s` would give `apikeys`. `api-keys` sets `modelName: "apiKey"`, so the export is `apiKeys` on the `api_keys` table.

When a plain `s` gives the wrong word, set `modelName` to the stem that takes the `s`, and write the correct SQL name in `pgTable()` or `sqliteTable()`. The adapter never reads the SQL name, so the two may differ. The guard test checks that every `modelName` in a module has a matching `<modelName>s` export. Re-check each plugin's model names when a module adds one, and on every `better-auth` version bump.

## Consequences

- An existing project that applied the singular migrations has to rename its tables. `db:generate` asks whether each table was renamed or created; the answer is "renamed", and the SQL has to be read before it is applied, because a drop-and-create loses every row. Each affected module skill carries an upgrade section with the old and new names.
- `auth` has to be updated before `teams`, `api-keys` and `billing`, because the schema rename and `usePlural` only work together.
- A new module that adds a Better Auth plugin must check that plugin's model names against this rule before it ships a schema snapshot.
- Historical plans, QA documents and ADRs keep the singular names they were written with.
