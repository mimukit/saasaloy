# Plan: plural snake_case table names

Status: draft, not built. Written 2026-09-12.

## Context

Saasaloy table names do not follow one rule. Better Auth tables are singular (`user`, `session`), `teams` has a camelCase SQL name (`organizationRole`), `feature-flags` is singular snake_case (`feature_flag`), and `waitlist` is a mass noun. Postgres reserves `user`, so the auth skill quotes it in raw SQL (`update "user" ...`).

This plan makes every table name plural snake_case, the Better Auth tables included. `drizzleAdapter` gets `usePlural: true`, so the adapter asks for `users` when Better Auth asks for `user`. The rule goes into the database skill, so every generated project inherits it.

## The convention

- A table name is plural snake_case: `users`, `order_items`, `feature_flags`. Pluralize the last word only. A join table names both sides: `team_members`.
- The Drizzle export key is the camelCase form of the same plural (`featureFlags`). The file name stays kebab-case.
- A column stays singular: `user_id`, `organization_id`.
- An index is named after the plural table: `sessions_user_id_idx`.
- A mass noun takes a count noun instead of a bare `s`: `waitlist_entries`, not `waitlists`.

## Facts checked against the pinned source

The auth module pins `better-auth@1.7.3`. I read the 1.7.3 copies in the local pnpm store.

- `@better-auth/drizzle-adapter/dist/index.mjs:90-91` reads `schema[model]` and throws `The model "${model}" was not found in the schema object`. The adapter never reads the SQL table name.
- `index.mjs:308-334` (`getQueryModel`) applies `usePlural` to plain queries and to joins.
- `@better-auth/core/dist/db/adapter/get-model-name.mjs` returns `` `${modelName}s` `` for a custom `modelName` and `` `${model}s` `` otherwise. The export key must be `<modelName>s`.
- `index.mjs:601` runs the schema check with the same `usePlural` value, so the check agrees with the lookup.
- Adapter calls in module code keep the singular model name. `modules/api-keys/files/auth/plugins/api-key.ts:250` passes `model: "member"`, and `usePlural` maps it to `members`. That line does not change.
- Plugin schema option keys (`schema.apikey`, `schema.subscription`, `schema.user` in `stripe.ts`) are model names, not export keys. They do not change.

The reference in unishopr-reborn is **uncommitted** work in `~/worktrees/unishopr-reborn/issue-30-set-up-the-database-package`, not a commit on that branch. The `## Table names` section and the `usePlural` comment in `packages/auth/src/auth.ts:80-83` exist only in that working tree. I copy the wording from there.

## Renames

Every table ships as a `.pg.ts` and a `.sqlite.ts` file. Each row changes in both files.

### auth (`modules/auth/files/db/schema/auth.{pg,sqlite}.ts`)

| Old export | Old table | New export | New table |
| --- | --- | --- | --- |
| `user` | `user` | `users` | `users` |
| `session` | `session` | `sessions` | `sessions` |
| `account` | `account` | `accounts` | `accounts` |
| `verification` | `verification` | `verifications` | `verifications` |

Indexes: `session_user_id_idx` → `sessions_user_id_idx`, `account_user_id_idx` → `accounts_user_id_idx`, `verification_identifier_idx` → `verifications_identifier_idx`. The auth skill SQL at line 262 names `account_issuer_account_id_uidx` and `"account"`. Those become `accounts_issuer_account_id_uidx` and `accounts`.

### teams (`modules/teams/files/db/schema/teams.{pg,sqlite}.ts`)

| Old export | Old table | New export | New table |
| --- | --- | --- | --- |
| `organization` | `organization` | `organizations` | `organizations` |
| `member` | `member` | `members` | `members` |
| `invitation` | `invitation` | `invitations` | `invitations` |
| `organizationRole` | `organizationRole` | `organizationRoles` | `organization_roles` |

Indexes: `member_*` → `members_*`, `invitation_*` → `invitations_*`, `organization_role_*` → `organization_roles_*` (six names, one `_uidx` among them). The organization plugin runs with `teams: { enabled: false }`, so no `team` or `teamMember` model exists. `organizationRole` is the one camelCase SQL name in the repo, and it becomes snake_case here.

### api-keys (`modules/api-keys/files/db/schema/api-keys.{pg,sqlite}.ts`)

| Old export | Old table | New export | New table |
| --- | --- | --- | --- |
| `apikey` | `apikey` | `apiKeys` | `api_keys` |

The plugin model name is `apikey`. A plain `usePlural` asks for `apikeys`. I propose `schema.apikey.modelName: "apiKey"` in `api-key.ts:95`, so the adapter asks for `apiKeys` and the SQL name is `api_keys`. The other option is export `apikeys` and table `apikeys`, with no `modelName`. Decision 1 below asks you to pick. Indexes: `apikey_key_idx` → `api_keys_key_idx`, `apikey_config_id_idx` → `api_keys_config_id_idx`.

### billing (`modules/billing/files/db/schema/billing.{pg,sqlite}.ts`)

| Old export | Old table | New export | New table |
| --- | --- | --- | --- |
| `billingSubscription` | `billing_subscription` | `billingSubscriptions` | `billing_subscriptions` |
| `billingEvent` | `billing_event` | `billingEvents` | `billing_events` |

`modules/billing-stripe/files/stripe.ts:185` keeps `modelName: "billingSubscription"`. With `usePlural` the adapter asks for `billingSubscriptions`, which is the new export key. The comment there and `saasaloy-billing/SKILL.md:136` explain the `<modelName>s` rule. The `drizzle-column` patch in `modules/billing/registry-item.json:100` changes `exportName: "user"` → `"users"`. Indexes: `billing_subscription_*` → `billing_subscriptions_*` (two names).

### feature-flags (`modules/feature-flags/files/db/schema/feature-flags.{pg,sqlite}.ts`)

| Old export | Old table | New export | New table |
| --- | --- | --- | --- |
| `featureFlag` | `feature_flag` | `featureFlags` | `feature_flags` |
| `featureFlagOverride` | `feature_flag_override` | `featureFlagOverrides` | `feature_flag_overrides` |

Index: `feature_flag_override_key_tenant_idx` → `feature_flag_overrides_key_tenant_idx`. These are not Better Auth tables.

### multitenant (`modules/multitenant/files/db/schema/projects.{pg,sqlite}.ts`)

| Old export | Old table | New export | New table |
| --- | --- | --- | --- |
| `project` | `project` | `projects` | `projects` |

`tenantIndex(table, "project")` becomes `tenantIndex(table, "projects")`, so the index is `projects_organization_id_idx`. The doc comments in `tenant-column.{pg,sqlite}.ts` change the same way.

### waitlist (`modules/waitlist/files/db/schema/waitlist.{pg,sqlite}.ts`)

| Old export | Old table | New export | New table |
| --- | --- | --- | --- |
| `waitlist` | `waitlist` | `waitlistEntries` | `waitlist_entries` |

The file name stays `waitlist.{pg,sqlite}.ts`, because the file names the feature, and a rename would move the scaffold target in every installed project. The route sub-app `export const waitlist` in `apps/api/src/routes/waitlist.ts` is a route, not a table, and it keeps its name.

## Files to change

### Schema and code

- `modules/auth/files/db/schema/auth.{pg,sqlite}.ts`: exports, table names, indexes, `references()` targets, comments.
- `modules/auth/files/src/auth.ts`: `usePlural: true` with a comment on why; `user as userTable` → `users as userTable`; the `update user set role` and `select ... from user` comments.
- `modules/auth/files/src/authorize.ts`, `server.test.ts`, `db-scope.test.ts`: only where they name a table. The role value `"user"` is a role, not a table, and stays.
- `modules/teams/files/db/schema/teams.{pg,sqlite}.ts` and `teams/files/auth/plugins/organization.ts` (the comment names `organizationRole` as a table).
- `modules/api-keys/files/db/schema/api-keys.{pg,sqlite}.ts`, `auth/plugins/api-key.ts` (`modelName`, comments), `auth/resolvers/api-key.ts` if it names the table.
- `modules/billing/files/db/schema/billing.{pg,sqlite}.ts`, `api/billing-store.ts`, `api/routes/billing.ts`, `src/subject.ts`, `src/provider.ts`, `src/jobs/*`, and the billing tests that name the tables.
- `modules/billing/registry-item.json`: the `drizzle-column` `exportName` and the removal warning text.
- `modules/billing-stripe/files/stripe.ts`: comment only.
- `modules/billing-console/files/console.ts` and `console.test.ts` if they name the tables.
- `modules/entitlements/files/entitlements.ts`, `entitlements.test.ts`, `api/require-feature.ts`.
- `modules/feature-flags/files/db/schema/feature-flags.{pg,sqlite}.ts`, `db/repositories/feature-flags.ts`, `registry-item.json` warning.
- `modules/multitenant/files/db/schema/projects.{pg,sqlite}.ts`, `db/tenant-column.{pg,sqlite}.ts`, `db/tenant.typecheck.ts`, `db/repositories/{projects,organizations,organization-roles}.ts`, `api/routes/projects.ts`, `auth/tenant.ts`, `auth/tenant-rules.test.ts` where a table is named.
- `modules/waitlist/files/db/schema/waitlist.{pg,sqlite}.ts`, `api/routes/waitlist.ts`, `registry-item.json` if it names the table.
- `modules/teams/registry-item.json`, `modules/api-keys/registry-item.json`, `modules/rbac/registry-item.json`: removal warnings that name tables.
- `modules/admin/files/api/routes/admin-users.ts`: check only. The `admin()` plugin owns the query, so I expect no change.
- `packages/cli/src/lib/patch/drizzle-column.{ts,test.ts}` and `applier.test.ts`: fixture and doc-comment names (`user` → `users`, `waitlist` → `waitlistEntries`). `teams-module.test.ts:102` matches `/organizationRole/` in a warning and changes with the warning text.

### Skills

- `modules/database/skills/saasaloy-database/SKILL.md`: new `## Table names` section, copied from the unishopr working tree with unishopr details removed (`orders`, `customer_profiles`, `src/schema/auth.ts` paths). Examples at lines 77, 149 and 173 use the plural names.
- `modules/database-d1/skills/saasaloy-database-d1/SKILL.md:75` and `modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md:167`: example tables.
- `modules/auth/skills/saasaloy-auth/SKILL.md`: `usePlural` note, SQL at lines 230, 235, 240, 262, 272, 274 without quotes, and an upgrade section.
- `modules/teams/skills/saasaloy-teams/SKILL.md`, `modules/api-keys/skills/saasaloy-api-keys/SKILL.md`, `modules/billing/skills/saasaloy-billing/SKILL.md`, `modules/entitlements/skills/saasaloy-entitlements/SKILL.md`, `modules/feature-flags/skills/saasaloy-feature-flags/SKILL.md`, `modules/multitenant/skills/saasaloy-multitenant/SKILL.md`, `modules/rbac/skills/saasaloy-rbac/SKILL.md`, `modules/waitlist/skills/saasaloy-waitlist/SKILL.md` (SQL at line 151): table names, and an upgrade section in each skill whose module owns a renamed table.
- `.agents/skills/create-module/` and `.agents/skills/create-provider/SKILL.md:549`: the rule for authors, and the `billing_subscription` mention.

### Docs

- `docs/adr/0038-adr-table-names-are-plural-snake-case-2026-09-12.md`: new ADR.
- `CONTEXT.md`: a `Table name` term, and the current names at lines 32, 68, 80, 129.
- `AGENTS.md` (`## Conventions`) and `CONTRIBUTING.md` (`### Starting a module`): one rule each, with a link to the ADR and the database skill.
- `modules/README.md:45`, `docs/wiki/modules.md:39,42`, `docs/wiki/how-to/remove-a-module.md:44`: current table names. The wiki is reader-facing, not historical.
- Not changed: every file in `docs/plans/` (other than this one), `docs/qa/` and the existing ADRs.

## The upgrade section

Each skill whose module owns a renamed table gets `## Upgrading from singular table names`. The steps:

1. Run `saasaloy update <module>` to take the new schema file.
2. Run `pnpm db:generate`.
3. For each table, drizzle-kit asks whether the table was created or renamed. Pick the rename from the old name.
4. Read the SQL file before you apply it. It must contain `ALTER TABLE ... RENAME TO ...` and index renames, and no `DROP TABLE` or `CREATE TABLE` for a table with data.
5. If the file contains a `DROP TABLE`, delete the file and run `db:generate` again.
6. Apply the migration, then sign in once to prove the adapter finds every table.

The auth section also says that `usePlural: true` and the schema rename land together. One without the other breaks sign-in.

## Guard test

`pnpm test:modules` runs `node:test` over `modules/*/files/**/*.test.ts`. A per-module test would sit in one module's payload, and this rule covers all of them. I put the guard at `scripts/table-names.test.ts`, which `pnpm test:scripts` runs. It reads files as text, like `modules/auth/files/src/schema-version.test.ts`.

It checks:

- Every `modules/*/files/db/schema/*.{pg,sqlite}.ts` file: each `export const X = pgTable|sqliteTable("name"` has a snake_case `name` that ends in `s`, and `X` is the camelCase form of `name`.
- Every `index("...")` and `uniqueIndex("...")` name starts with the table name of its call.
- Each `.pg.ts` file and its `.sqlite.ts` twin export the same keys and table names.
- `modules/auth/files/src/auth.ts` passes `usePlural: true` to `drizzleAdapter`.
- A `modelName` string in a module plugin file plus `s` is an export key in some schema file.

Before the renames, I run the test on the current tree and record the failure output. That proves the test fails on a singular table.

## Checks

1. `pnpm typecheck`, `pnpm lint` and `pnpm test` from the root.
2. In `.dev`, scaffold a project with `auth`, `teams`, `api-keys` and `billing` on `database-d1`. Run `db:generate` and `db:migrate`, start the API and the web app, sign up, create an organization, and create an API key.
3. Do step 2 again on `database-postgres`, against a local Postgres.
4. For each run, record the migration SQL table names and the result of each request.

## Decisions

Settled 2026-09-12.

1. `apikey`: `modelName: "apiKey"`, export `apiKeys`, table `api_keys`.
2. `waitlist`: export `waitlistEntries`, table `waitlist_entries`.
3. Guard test location: `scripts/table-names.test.ts`.
