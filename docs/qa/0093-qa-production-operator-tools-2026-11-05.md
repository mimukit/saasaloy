# QA Plan: Production operator tools (#309)

_Generated 2026-11-05 · against `d4f4fd5a` (clean) · covers the column classes, the read-only production role, `db:prod:query`, `logs:prod`, `db:prod:superadmin` and the first-user hook removal. Plan: `docs/plans/0100-plan-production-operator-tools-2026-11-04.md`._

## Summary
- An agent reads production rows and Worker logs through a read-only role and a read-only token, and the server refuses every write and every secret column.
- "Working" means: the three refusal statements fail on a real production database, a masked auth trace answers, and the logs command reads real Worker lines.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-309-add-production-operator-tools` at `d4f4fd5a`.
- Scenario 1 runs in `.dev/playground` of this worktree. It needs Docker and ports 5432 free.
- Scenario 2 runs in a real Saasaloy project that deploys to Postgres production. Only the owner runs it, with the owner credentials. An agent never runs it.
- No screenshots: the feature has no screen.

Build the playground with the branch's modules:

```sh
pnpm play:init && cd .dev/playground && ./saasaloy add database-postgres --yes && ./saasaloy add auth --yes
```

Set the database client once. Every query in Scenario 1 runs through it.

```sh
export DB_CMD='docker compose exec -T postgres psql -U postgres playground_dev'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Seeded playground, local Postgres | The superadmin command hides and confirms the password | 🔴 Critical |
| TC-1.2 | 1: Seeded playground, local Postgres | The skill and the update note read clearly | 🟡 Normal |
| TC-2.1 | 2: Real production, owner credentials | The read-only role refuses writes and secrets on production | 🔴 Critical |
| TC-2.2 | 2: Real production, owner credentials | `logs:prod` reads real api Worker lines | 🟡 Normal |
| TC-2.3 | 2: Real production, owner credentials | A new agent session answers from the skill only | 🟡 Normal |

## Scenario 1: Seeded playground, local Postgres

**Setup.** Run once, for every case in this scenario, from `.dev/playground`.

```sh
pnpm db:setup --docker && pnpm db:seed
```

- [ ] Setup complete

### TC-1.1: The superadmin command hides and confirms the password  ·  🔴 Critical

**Goal.** An owner makes the first superadmin with a password that never shows on screen and that Better Auth accepts.

**Steps**

1. Run the command against the playground's development database. Type `qa-owner-password-1` twice when it asks.

   ```sh
   cd packages/db && DATABASE_URL="$(grep '^DATABASE_URL=' ../../apps/api/.env | cut -d= -f2-)" node scripts/superadmin.ts --email qa-owner@example.test --name "QA Owner"
   ```

   - [ ] The prompt shows no character of the password, and it asks a second time to confirm
   - [ ] The output says `Created qa-owner@example.test as superadmin.` and lists the other superadmins, and it prints no password or hash
2. Read the rows the command wrote.

   ```sh
   $DB_CMD -c "select u.email, u.role, u.email_verified, a.provider_id, length(a.password) as hash_length from users u join accounts a on a.user_id = u.id where u.email = 'qa-owner@example.test';"
   ```

   - [ ] One row: role `superadmin`, `email_verified` true, provider `credential`, hash length 161
3. Run the command again with `--keep-password`.

   ```sh
   DATABASE_URL="$(grep '^DATABASE_URL=' ../../apps/api/.env | cut -d= -f2-)" node scripts/superadmin.ts --email qa-owner@example.test --keep-password
   ```

   - [ ] It asks for no password and says the account is a superadmin already
4. Type two different passwords on a third run.

   ```sh
   DATABASE_URL="$(grep '^DATABASE_URL=' ../../apps/api/.env | cut -d= -f2-)" node scripts/superadmin.ts --email qa-owner@example.test
   ```

   - [ ] It stops with a message that the two passwords differ, and it writes nothing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The skill and the update note read clearly  ·  🟡 Normal

**Goal.** An agent and an owner can follow the new skill and the update note with no other source.

**Steps**

1. Read `modules/database-postgres/skills/saasaloy-prod-debug/SKILL.md` top to bottom.
   - [ ] The rules are clear, and nothing in it reads as permission to write to production or to open a credential file
     - the rule section and the "answer against the last deploy tag" rule
     - the commands table and the masking caveat
     - the symptom table and the report shape
2. Read `modules/auth/update-notes/0002-no-first-user-hook.md`.
   - [ ] An owner of an existing project knows what to delete and how to make the first superadmin on Postgres and on D1

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd .dev/playground && docker compose down -v
```

## Scenario 2: Real production, owner credentials

Only the owner runs this scenario. It reads production and sets a role password. The agent did not run it.

**Setup.** Run once, from the root of a real project on this branch's modules, with `packages/env/.env.prod` filled in.

1. Apply the grants as the owner role.

   ```sh
   pnpm db:prod:readonly-grants
   ```

2. Set the role password in `psql` on `<project>_production`, as the owner. Use a new random password.

   ```sh
   psql "<owner URL>" -c "alter role <project>_ro password '<new password>'"
   ```

3. Write the URL file, and make it private.

   ```sh
   mkdir -p ~/.config/<project> && printf 'PROD_READONLY_DATABASE_URL=postgres://<project>_ro:<new password>@<host>:<port>/<project>_production\n' > ~/.config/<project>/prod-readonly.env && chmod 600 ~/.config/<project>/prod-readonly.env
   ```

- [ ] Setup complete

### TC-2.1: The read-only role refuses writes and secrets on production  ·  🔴 Critical

**Goal.** On the real production server, the role reads plain and masked data and the server refuses every write and every secret column.

**Steps**

1. Run the auth trace for your own account.

   ```sh
   pnpm db:prod:query --auth-trace <your email>
   ```

   - [ ] The output shows your user row, `has_password`, and your sessions, with the email as `***@<domain>` and the name masked
2. Try a delete.

   ```sh
   pnpm db:prod:query "delete from users"
   ```

   - [ ] It fails with `cannot execute DELETE in a read-only transaction`
3. Connect as the role in `psql` and try a write after you switch the transaction to read write.

   ```sh
   psql "postgres://<project>_ro:<new password>@<host>:<port>/<project>_production" -c "begin; set transaction read write; update users set name = name; rollback;"
   ```

   - [ ] It fails with `permission denied for table users`
4. Try to read a secret column.

   ```sh
   pnpm db:prod:query "select password from accounts"
   ```

   - [ ] It fails with `permission denied for table accounts`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `logs:prod` reads real api Worker lines  ·  🟡 Normal

**Goal.** A token with "Workers Observability: Read" only reads the api Worker's recent lines.

**Steps**

1. Make a Cloudflare API token with "Workers Observability: Read" only. Write it and the account id to the file, and make it private.

   ```sh
   mkdir -p ~/.config/<project> && printf 'CLOUDFLARE_LOGS_API_TOKEN=<token>\nCLOUDFLARE_ACCOUNT_ID=<account id>\n' > ~/.config/<project>/cloudflare-logs.env && chmod 600 ~/.config/<project>/cloudflare-logs.env
   ```

2. Read the last hour.

   ```sh
   pnpm logs:prod --since 1h
   ```

   - [ ] It prints request lines from the api Worker, emails show as `***@<domain>`, and the last line names the oldest line's time
   - [ ] The output and the shell history show no token

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A new agent session answers from the skill only  ·  🟡 Normal

**Goal.** An agent answers a production question with the read-only commands and touches no credential.

**Steps**

1. Start a new agent session in the project. Ask: "Did <your email> sign in today, and from which user agent?"
   - [ ] The agent loads `saasaloy-prod-debug`, uses only `pnpm db:prod:query` and `pnpm logs:prod`, opens no credential file, and gives an answer that matches what you know

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Keep the role for normal use. To lock it out, run this as the owner.

```sh
psql "<owner URL>" -c "alter role <project>_ro password null"
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Repo gate. `lint`, `typecheck`, `test:modules`, `test:base`, `test:tooling` and `test:scripts` ran on `1dd2b5d9`. `lint`, `test:modules` and `test:tooling` ran again after the fix in `d4f4fd5a`, the only later commit.

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test:modules && pnpm test:base && pnpm test:tooling && pnpm test:scripts
```

```sh
pnpm exec turbo run test
```

- ✅ `pnpm lint` → exit 0 on `1dd2b5d9` and on the `d4f4fd5a` tree
- ✅ `pnpm typecheck` → exit 0
- ✅ `pnpm test:modules` → 1092 pass, 0 fail
- ✅ `pnpm test:base` → 91 pass, 0 fail
- ✅ `pnpm test:tooling` → 174 pass
- ✅ `pnpm test:scripts` → 568 pass, 0 fail
- ✅ `pnpm exec turbo run test` on `d4f4fd5a` → 75 of 75 files, 1959 of 1959 tests pass. On `1dd2b5d9` 1958 of 1959 passed; the one gap was a worker `SIGABRT` in `packages/cli/src/lib/exit.test.ts` under box load, and that file passes 8 of 8 alone.

Disposable target: `.dev/playground` (`AGENTS.md` names `.dev` for testing; `pnpm play:destroy` and `pnpm play:restore` rebuild it). A second `postgres:18` container on `127.0.0.1:55440` held `playground_production`, a copy of `playground_dev`, as a local stand-in for production. Both containers were removed after the run.

```sh
cd packages/db && DATABASE_URL=postgres://postgres:owner@127.0.0.1:55440/playground_production node scripts/readonly-grants.ts
```

```sh
HOME=<temp home> pnpm db:prod:query --auth-trace superadmin@example.test
```

```sh
HOME=<temp home> pnpm db:prod:query "delete from users"
```

```sh
printf "begin;\nset transaction read write;\ninsert into users (id, name, email) values ('qa1','qa','qa@example.test');\nrollback;\n" | docker exec -i -e PGPASSWORD=<role password> e309qa-prod psql -h 127.0.0.1 -U playground_ro playground_production
```

```sh
DB_DUMP_DIR=<temp dir> DATABASE_URL=postgres://postgres:owner@127.0.0.1:55440/playground_production node scripts/prod.ts migrate
```

```sh
pnpm exec vitest run packages/db
```

- ✅ `readonly-grants.ts` → grants for 19 tables; `accounts` withholds 4 secrets, `sessions` 1, `verifications` 2, `api_keys` 1; `log_statement = all` set; the hint names `ALTER ROLE` and prints no password
- ✅ `--auth-trace superadmin@example.test` → email `***@example.test`, name `[masked, 14 chars]`, `has_password: true`
- ✅ `delete from users` → `cannot execute DELETE in a read-only transaction`
- ✅ `select password from accounts` → `permission denied for table accounts`
- ✅ `set transaction read write; update ...` through `db:prod:query` → `cannot insert multiple commands into a prepared statement`
- ✅ `psql` as the role: `set transaction read write` then `update users` → `permission denied for table users`; then `insert into users` → `permission denied for table users`; `select token from sessions` → `permission denied for table sessions`
- ✅ `show default_transaction_read_only` → `on`; `show log_statement` → `all`
- ✅ `--max-rows 2` → 2 rows and `(first 2 rows; raise --max-rows to see more)`
- ✅ URL file at mode 644 → `... is mode 644. It holds a database password: run chmod 600 ... Nothing ran.`, exit 1
- ✅ Grants after migrate: revoked the role's `users` grant as the owner (`has_column_privilege` → `f`), ran `prod.ts migrate` → dump written, migrate passed, `users.email` → `t`, `accounts.password` → `f`
- ✅ Class test: added `users.qa_nickname` → `users.qa_nickname: column has no class`; reverted → 1 passed
- ❌ then fixed: `pnpm exec vitest run packages/db` on a fresh test database → `readonly.test.ts` 11 skipped, `duplicate key value violates unique constraint "pg_database_datname_index"`. The read-only and superadmin tests created `<db>_test` at the same time. Fixed in `d4f4fd5a` (`setupLocked`). After the fix, three runs on a dropped test database → 45 of 45 pass each time.

## Not covered / needs human judgment
- Real production and real Cloudflare: the agent may not use the owner credentials or a Cloudflare token. Scenario 2 covers them.
- The interactive password prompt needs a terminal, so TC-1.1 covers it.
- `database-d1`: it gets the class test only. The build checked it in `.dev/d1check` before the commits. The D1 production SQL path for the first superadmin is documented, not scripted.
- No CI job runs `readonly.test.ts` or `superadmin.test.ts`. They run in a generated project's own `pnpm test`.
- No UI changed, so compatibility, accessibility and visual checks do not apply.
- Concurrency of two agents querying at once: `CONNECTION LIMIT 2` caps it, and the check is not run.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
