# Plan: Production operator tools for database-postgres

Grilled: 2026-11-04

Issue: #309. Source: `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, "Issue 4".

## Context

A Saasaloy project that deploys to production today gives an agent one way to look at production data: `env-deploy --run api`, which loads the owner `DATABASE_URL`. Every query then runs as the owner role, which can write, drop and migrate. PrimeShopr hit this on 2026-10-31: the agent debugged a "no login code" report as the owner role, and read-only was only a setting on its own connection that any statement could switch off. Half of the answer also sat in the api Worker logs, which the agent could not read. PrimeShopr fixed it in its own plan 0036 (branch `hotfix-prod-readonly-access`, built 2026-11-04). This plan moves that fix into the `database` core, the `database-postgres` driver, the `auth` module and the base template, so every new project gets it.

The same session showed a second gap. A fresh deploy promotes the first account that signs up to `superadmin` (`modules/auth/files/src/auth.ts`, the `databaseHooks.user.create.before` hook). `auth.ts` only warns about the race in a comment. This plan removes the hook and gives Postgres projects `pnpm db:prod:superadmin`, run before the api answers in public.

Goal: an agent answers "what happened to this user" from production rows and logs, and the server, not the agent's care, stops a write or a secret read.

Target: on the project's test Postgres server, as the read-only role, an `insert`, a `set transaction read write` followed by an `update`, and a `select password from accounts` each fail, while a `select` on a `plain` column succeeds. A schema column with no class fails `pnpm test` in a generated project, on both drivers.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the column classes live | One file per table at `packages/db/src/column-classes/<table>.ts` (the SQL name in kebab-case), shipped by the module that owns the table and collected by `import.meta.glob`, the same shape as `src/seed/slices/`. Each file calls `defineColumnClasses(table, { <column key>: "secret" \| "pii" \| "plain" })` from the `database` core, typed against the Drizzle table so a wrong key fails `tsc`. A central file, a sibling export in the schema file and a field on the seed slice were rejected: the first breaks the module boundary, the second reaches Drizzle through the schema barrel and doubles across `.pg.ts` and `.sqlite.ts`, the third puts a production rule in dev seed data. (Grill Q1, asked.) |
| The class rule | `secret`: credentials, tokens, password and key hashes, one-time codes. `pii`: names, emails, phones, addresses, IP addresses, free text a person wrote. Everything else `plain`. (Grill Q11, defaulted.) |
| Which modules classify | All 10 modules that ship a schema today: `auth`, `api-keys-user`, `api-keys-organization`, `billing`, `feature-flags`, `file-uploads`, `multitenant`, `payment`, `teams`, `waitlist`. (Grill Q9, defaulted.) |
| `database-d1` | Gets the class files and the class test only, because both live in the driver-neutral core. No D1 query, grant or superadmin script: D1 has no roles and no column grants, so a D1 tool would run on a token that can write. `logs:prod` serves both drivers. (Grill Q2, asked.) |
| Who enforces read-only | The server. A login role named from the dev prefix with `_dev` replaced by `_ro` (`acme_shop_ro`), `SELECT` only on `pii` and `plain` columns, with `default_transaction_read_only = on`, `statement_timeout = '15s'`, `idle_in_transaction_session_timeout = '30s'`, `CONNECTION LIMIT 2`, `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`. The role can switch its read-only default off, but it holds no write grant, so the column grants stop the write. The client read-only transaction is a second guard. (Grill Q5, defaulted.) |
| How secrets stay out | Column-level grants only. No table-level grant and no `ALTER DEFAULT PRIVILEGES`, so a new column stays unreadable until someone classifies it. |
| Grant script | `pnpm db:prod:readonly-grants`, under `env-deploy --run api`, guarded by the existing `assertProductionTarget`. It reads the live columns of `public`, maps them through the class files, and runs the grant plan in one transaction. A live column or table with no class gets nothing. A classified column the database lacks is skipped. It never sets or prints a password: the owner sets it with `ALTER ROLE <role> PASSWORD ...`. `log_statement = 'all'` is set only when the connecting role is a superuser; otherwise the script prints a skip. |
| Grants after a migration | `runProduction` calls the grant step after a successful `migrate`, through a new `ProductionDeps` member. A grant failure prints an error and does not change the migrate result, because the old grants stay and a new column stays unreadable. |
| Where the read-only URL lives | `~/.config/<project>/prod-readonly.env`, mode 0600, key `PROD_READONLY_DATABASE_URL`, where `<project>` is the dev prefix without `_dev`. Never `packages/env/.env.prod`, which holds the owner URL. No `.env.example` entry, because no service reads the key. |
| How the agent queries | `pnpm db:prod:query "<sql>"`, SQL on stdin, or `--auth-trace <email>`. It reads only the read-only file, refuses a file mode wider than 0600, checks that the URL names `<project>_production` as the read-only role on a server other than the dev one, then checks `current_user` and `default_transaction_read_only` before the first statement. It runs one statement per call through the extended protocol, in `begin read only`, rolls back, caps rows (default 200, `--max-rows` 1 to 5000), and masks `pii` output columns. It never prints the URL. |
| The `--auth-trace` key | Email only. The preset queries `users`, `accounts` (provider and `has_password` only), `sessions` (newest 20, no token) and `verifications` (identifier and times only). A phone form waits for #308. (Grill Q6 and Q13, defaulted.) Amended 2026-11-04 during the build: Better Auth stores a password reset as `identifier = "reset-password:<token>"`, so `verifications.identifier` is `secret`, and the preset drops `verifications`, because no readable column ties a row to a user. |
| Masking | Client side, by output column name, from the `pii` set the class files give: an email to `***@domain`, a phone-shaped value to its first four and last four characters, anything else to `[masked, N chars]`, `null` kept. It is an accident guard: an alias gets past it, and a `WHERE` clause still matches the raw value. No `--unmask` flag. |
| Logs | `pnpm logs:prod --since <time> [--until] [--search] [--limit] [--worker]` in the base template `packages/tooling/src/logs-prod.ts`, over the Workers Observability query API with `dry: true`. Token and account id come from `~/.config/<project>/cloudflare-logs.env`, mode 0600, keys `CLOUDFLARE_LOGS_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; the token carries "Workers Observability: Read" only. The default worker is the `name` in `apps/api/wrangler.jsonc`. Output passes through a text masker for emails. It prints the oldest line it saw, so an empty result outside the retention window reads as "the logs are gone". (Grill Q7, defaulted.) |
| The first-user hook | Removed from `sharedOptions()` in `modules/auth/files/src/auth.ts`, with `noUsersYet` and its tests. A first sign-up gets `user`. Dev gets its superadmin from the seed. Postgres production gets it from `pnpm db:prod:superadmin`. D1 production signs up, then runs the `update users set role = 'superadmin'` SQL the auth skill documents, through `wrangler d1 execute --remote`. The auth and admin skills, the `config/auth.ts` and `admin/src/lib/auth.ts` comments, and `scripts/qa-tenant-scoping.sh` step 0 change to match. (Grill Q3, asked.) |
| Existing projects | An `auth` update note in `modules/auth/update-notes/` tells an owner the hook is gone, how to delete it from their `auth.ts`, and how to make the first superadmin on each driver. (Grill Q10, defaulted.) |
| Superadmin script | `pnpm db:prod:superadmin --email <address> [--name] [--keep-password]`, shipped by `database-postgres` with every file and patch under `when: { installed: ["auth"] }`, under `env-deploy --run api`. It reads the password from a hidden prompt, hashes it the way Better Auth does (scrypt, `<salt>:<key>` hex), and in one transaction creates or promotes the `users` row and its `credential` account. It prints neither the password nor the hash. It also accepts this project's development databases, so a developer tries it before launch. (Grill Q8, defaulted.) |
| Test approach | `tests-after`. Pure logic in this repo runs under `pnpm test:modules` (`node --test`, `*.test.ts` files that import no Drizzle schema). Tests that need the generated schema or a database ship as `*.vitest.ts`, renamed to `*.test.ts` by the descriptor with `when: { testing: true }`, like `completeness.vitest.ts` and `production.vitest.ts`. A repo-side `scripts/column-classes.test.ts`, modeled on `scripts/seed-slices.test.ts`, reads the files as text and checks every module table has a class file covering every column. |
| Proof against a real server | A `when: { testing: true }` vitest in the generated `packages/db` runs on the project's test database: it creates a role with a random suffix, applies the grant plan, runs the three statements that must fail and one select that must pass, and drops the role. It skips with a message when no test database is configured or the test user lacks `CREATEROLE`. The e2e `postgres` job runs it with no new CI wiring. (Grill Q4, asked; Q12, defaulted.) Amended 2026-11-04 during the build: the e2e job runs Playwright specs only, not the project's Vitest suite, so no CI job runs this test yet. It runs in a generated project's own `pnpm test`, and `packages/cli/vitest.tooling.config.ts` excludes it from this repo's `db-scripts` project. |
| Parallel issues | #308, #310 and #313 add tables in parallel threads. Each gets one comment now that states the class rule, the file path and the test name. Whichever PR merges second adds the class files for its own tables. (Grill Q15, asked.) |
| Outward actions | This build commits nothing, pushes nothing and opens no PR. It labels #309 and posts the three comments in the row above. (Grill Q14, defaulted.) |
| Production safety | No command in this build touches a real production database or Cloudflare account. Every check runs on a local test database or a stubbed `fetch`. Any local Postgres the build starts gets a free port checked first and is stopped before the build ends. |

## Approach

Lift the PrimeShopr code and fit it to the module shape. The `database-postgres` driver already has the production pattern: `files/scripts/prod.ts` for the command, `files/scripts/lib/production.ts` for the pure, testable half (`assertProductionTarget`, `productionDatabaseName`, `ProductionDeps` stand-ins), and `production.vitest.ts` for its tests. New scripts follow that split. `modules/database/files/src/seed/table.ts` already has `tablesIn` and reads columns off both Postgres and SQLite tables, and `src/seed/completeness.vitest.ts` is the model for the class test. `modules/auth/files/db/seed/accounts.ts` holds the dev password hash the hasher test checks against. The `saasaloy-deploy` skill in `packages/cli/templates/base/_agents/skills/` gains the deploy-tag rule.

Alternatives considered:

- Keep `env-deploy --run api` and add only the role: the agent's process still loads the owner URL. Rejected.
- Masked views in a `support` schema: a view that masks the email cannot be searched by email. Rejected.
- A separate `ops` module: one more module for a capability every Postgres project needs, and it still depends on driver internals. Rejected.

No phase is attended.

### Phase 1: Column classes and the class test (built 2026-11-05)

- Add `defineColumnClasses`, the `ColumnClass` type, `classificationProblems` and the glob collection (`src/column-classes.ts` beside `src/schema.ts`) to the `database` core, plus the empty `src/column-classes/` folder.
- Add the class test beside `completeness.vitest.ts` (`src/column-classes.vitest.ts` → `src/column-classes.test.ts`, `when: { testing: true }`). It fails on a column with no class, a class for a column or table the schema lacks, and names the file to add.
- Ship one class file per table from each of the 10 modules, in both driver variants where the column keys differ.
- Add `scripts/column-classes.test.ts`.

Done when: in a `.dev` project with `database-postgres` and `auth`, `pnpm test` passes; a column added to `packages/db/src/schema/auth.ts` makes it fail with that column named; the same holds with `database-d1`; `pnpm test:scripts` in this repo passes, and fails when a class file is removed.

### Phase 2: The read-only role and grants (built 2026-11-05)

- Add `files/scripts/lib/readonly.ts` (role name from the prefix, `buildGrantPlan`, `assertReadonlySession`, `quoteIdent`) and `files/scripts/readonly-grants.ts`, plus the `db:prod:readonly-grants` package and root scripts in `registry-item.json`.
- Call the grant step at the end of `runProduction` for `migrate`, through `ProductionDeps`.
- Unit tests for the SQL builder: no table-level grant, `REVOKE ALL` before each column grant, an unclassified live column gets nothing, a classified column missing live is skipped, `log_statement` only for a superuser; and for `runProduction`: a grant failure leaves the migrate result as it was.
- The real-server vitest from the design decisions.

Done when: the unit tests pass, and in a `.dev` Postgres project with a test database, the real-server test passes: the `insert`, the `set transaction read write; update`, and the `select password from accounts` each fail, and `select count(*) from users` returns a number.

### Phase 3: `pnpm db:prod:query` (built 2026-11-05)

- Add `files/scripts/lib/query.ts` (argument parser, `assertPrivateFile`, `assertReadonlyUrl`, `AUTH_TRACE`), `files/scripts/lib/mask.ts`, and `files/scripts/query.ts`, plus the package and root scripts.
- Unit tests for the parser, the URL and file-mode guards, the session guard and the masker.
- Extend the real-server test: as the role, the `AUTH_TRACE` queries run, and `delete from users` fails.

Done when: the unit tests and the extended real-server test pass, and a by-hand run in `.dev` against a local Postgres on a free port, with a temporary `HOME`, prints the seed superadmin's trace with the email as `***@example.test`. The local Postgres is stopped after the run.

### Phase 4: `pnpm logs:prod` (built 2026-11-05)

- Add `packages/cli/templates/base/packages/tooling/src/logs-prod.ts`, its test, and the root `logs:prod` script.
- The request builder, the time parser, the retention warning, the token-file guard and the text masker are tested with a stubbed `fetch`. No test calls Cloudflare.

Done when: `pnpm test:tooling` passes with tests for the request body, the `--since` span forms, the retention warning, a missing or mode-0644 token file, and the email masker.

### Phase 5: The first superadmin (built 2026-11-05)

- Remove the first-user hook and `noUsersYet` from `modules/auth/files/src/auth.ts`; update its tests, the comments in `config/auth.ts` and `modules/admin/files/src/lib/auth.ts`, the auth and admin skills, and `scripts/qa-tenant-scoping.sh` step 0.
- Add the `auth` update note.
- Add `files/scripts/superadmin.ts`, `files/scripts/lib/superadmin.ts`, `files/scripts/lib/password.ts` and `files/scripts/lib/prompt.ts` to `database-postgres`, all under `when: { installed: ["auth"] }`, with the package and root scripts as patches under the same `when`.
- Test the hasher against the seed hash in `modules/auth/files/db/seed/accounts.ts`, and test `ensureSuperadmin` on the test database.

Done when: a test shows a first sign-up on an empty `users` table gets `user`; the hasher test matches the seed hash; the `ensureSuperadmin` test creates a superadmin, then promotes or keeps it and lists other superadmins; `saasaloy add database-postgres` without `auth` writes no superadmin file or script.

### Phase 6: Skills and docs (built 2026-11-05)

- Add `saasaloy-prod-debug` to `modules/database-postgres/skills/`, lifted from PrimeShopr `.agents/skills/primeshopr-prod-debug/SKILL.md`: the rule, the commands, the logs caveat, a generic symptom table (sign-in, reset code, sessions), the report shape. No PrimeShopr names or phone numbers. Register it in the descriptor's `agent.skills`.
- `saasaloy-deploy` skill: a production question is answered against the last deploy tag (`git describe --tags --match 'deploy-*' --abbrev=0`, then `git show <tag>:<path>`), not `main`; run `pnpm db:prod:superadmin` once before the first `pnpm deploy:production`.
- `saasaloy-database-postgres` skill: the new commands, the role setup, the password rotation.
- `saasaloy-database` skill: the class files and the rule.
- Update `llms.txt` where it lists driver commands.

Done when: `pnpm lint` and `pnpm test` pass, and `saasaloy add database-postgres` in `.dev` links `saasaloy-prod-debug`.

## Open questions

None. All 15 grill decisions are settled.

## Non-goals

- Write access of any kind for the agent, including "safe" fixes.
- A production query, grant or superadmin script for `database-d1`.
- An `--auth-trace` by phone; that waits for #308.
- An audit log beyond `log_statement = 'all'` on the role.
- Agent deny rules in `~/.claude/settings.json`; the skill names the files to avoid, and the role's rights are the real limit.
- Classifying the tables of #308, #310 or #313 before they reach `main`.
- Running any command against a real production database or Cloudflare account during this build.
