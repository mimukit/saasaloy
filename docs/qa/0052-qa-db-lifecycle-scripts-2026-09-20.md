# QA Plan: db:setup, db:status and db:drop

_Generated 2026-09-20 · against the working tree on `a9f10f6` (changes are uncommitted) · covers the three lifecycle commands on both database drivers, the `@root` alias, and the docs that describe them_

## Summary

- `saasaloy add database-postgres` or `add database-d1` gives a project `pnpm db:setup`, `pnpm db:status` and `pnpm db:drop`, and the Postgres driver creates one database per git branch over a docker, server or neon backend.
- "Working" means a developer prepares a database from a clean checkout with one command, a second worktree gets a database of its own, and `db:drop` removes a database and never a server.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-152-add-db-setup-db-status-and-db-drop`, in the worktree at `/home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop`.
- The tree is uncommitted. Run the plan in that worktree, not in the main checkout.
- Docker must be running. This plan starts a Postgres container and removes it at the end.
- Scenario 4 reaches neon.new over the network. Skip that scenario with no network, and say so in its Notes.
- The playground project is the test subject. `pnpm play:reset` destroys and rebuilds it.

Move to the worktree.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop
```

Confirm Docker answers.

```sh
docker info >/dev/null 2>&1 && echo "daemon up"
```

Set the database client. Every query below runs through it.

```sh
export DB_CMD='docker exec playground-postgres-1 psql -U postgres -tAc'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| #      | Scenario                                   | Test case                                          | Priority    |
| ------ | ------------------------------------------ | -------------------------------------------------- | ----------- |
| TC-1.1 | 1: fresh playground, postgres driver added | First `db:setup` on the default branch              | 🔴 Critical |
| TC-1.2 | 1: fresh playground, postgres driver added | `db:setup` applies a new migration and re-runs safely | 🔴 Critical |
| TC-1.3 | 1: fresh playground, postgres driver added | `db:drop` removes the database and keeps the server | 🔴 Critical |
| TC-2.1 | 2: two worktrees on one container          | A second branch gets a database of its own          | 🔴 Critical |
| TC-2.2 | 2: two worktrees on one container          | `db:drop` in one worktree leaves the other alone     | 🔴 Critical |
| TC-3.1 | 3: playground with a database in place     | `--server` and `--reset` on the same server          | 🟡 Normal   |
| TC-3.2 | 3: playground with a database in place     | The refusals read clearly                           | 🟡 Normal   |
| TC-4.1 | 4: playground reaching neon.new            | `--neon` creates, reports and drops                  | 🟢 Low      |
| TC-5.1 | 5: fresh playground, d1 driver added       | The three commands on D1                             | 🔴 Critical |
| TC-6.1 | 6: playground with the postgres driver     | `remove database-postgres` takes `compose.yaml` back  | 🟡 Normal   |
| TC-7.1 | 7: the documents, read only                | The skills and the ADR match the commands            | 🟢 Low      |

## Scenario 1: fresh playground, postgres driver added

**Setup.** Run once, for every case in this scenario.

1. Rebuild the playground and add the driver.

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres --yes && pnpm install
```

2. Give the playground a git repository, so the branch rules have a branch to read.

```sh
git init -q && git add -A && git -c user.email=qa@test -c user.name=qa commit -qm "playground" && git branch -M main
```

- [ ] Setup complete

### TC-1.1: First `db:setup` on the default branch · 🔴 Critical

**Goal.** One command gives a clean checkout a running container, a database and a `DATABASE_URL`.

**Steps**

1. Read the file the module wrote at the repo root.

   ```sh
   cat compose.yaml
   ```

   - [ ] The file says it is development only, and names the credentials and the volume
     - the header comment warns against production use
     - the image is `postgres:18` and the port is `5432`
     - a comment ties the credentials to `packages/db/scripts/backends/docker.ts`

2. Run the command from the repo root, not from the package.

   ```sh
   pnpm db:setup
   ```

   - [ ] The output says the container started and the database was created
   - [ ] The summary names the backend, the database, the host and the branch rule
     - `Backend   a local Docker container`
     - `Database  playground_dev`
     - the last lines say this is the default branch and where `DATABASE_URL` went

3. Read the file the command wrote.

   ```sh
   cat apps/api/.dev.vars
   ```

   - [ ] A state block sits above `DATABASE_URL`, and every line of it is a comment
     - the block begins with `# db:setup state:` and ends with `# end db:setup state`
     - it records `backend=docker`, `database=playground_dev` and a `created` time
     - `DATABASE_URL` points at `playground_dev` on `127.0.0.1:5432`

4. Ask the container which databases exist.

   ```sh
   $DB_CMD "select datname from pg_database where datname like 'playground%';"
   ```

   - [ ] Exactly one row, `playground_dev`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `db:setup` applies a new migration and re-runs safely · 🔴 Critical

**Goal.** A re-run applies pending migrations and makes no second database.

**Steps**

1. Add a table and generate its migration.

   ```sh
   printf 'import { pgTable, serial, text } from "drizzle-orm/pg-core";\n\nexport const widgets = pgTable("widgets", {\n  id: serial("id").primaryKey(),\n  name: text("name").notNull(),\n});\n' > packages/db/src/schema/widgets.ts && pnpm --filter @repo/db db:generate
   ```

   - [ ] drizzle-kit reports one table and writes a file under `packages/db/migrations`

2. Run the command again.

   ```sh
   pnpm db:setup
   ```

   - [ ] The output says the migrations applied, and the database name has not changed

3. Ask the database what it holds.

   ```sh
   $DB_CMD -d playground_dev "select table_name from information_schema.tables where table_schema = 'public';"
   ```

   - [ ] The `widgets` table exists

4. Read the status report.

   ```sh
   pnpm db:status
   ```

   - [ ] The report says `Applied   1` and `0 pending migrations`
   - [ ] The report names the branch it read from git

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

### TC-1.3: `db:drop` removes the database and keeps the server · 🔴 Critical

**Goal.** `db:drop` removes one database, clears the env file and leaves the container running.

**Steps**

1. Drop the database.

   ```sh
   pnpm db:drop
   ```

   - [ ] The message names the database that went, and says the state block and `DATABASE_URL` are gone
   - [ ] A second line says the container is still running, and names `docker compose down -v`

2. Ask the container what is left.

   ```sh
   $DB_CMD "select datname from pg_database where datname like 'playground%';"
   ```

   - [ ] No rows

3. Confirm the container survived the drop.

   ```sh
   docker compose ps
   ```

   - [ ] `playground-postgres-1` is still up

4. Read the env file and the status report.

   ```sh
   cat apps/api/.dev.vars && pnpm db:status
   ```

   - [ ] The env file holds no `DATABASE_URL` and no state block
   - [ ] `db:status` says there is no database yet, and names the one `db:setup` would create

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop/.dev/playground && docker compose down -v
```

## Scenario 2: two worktrees on one container

This scenario proves the reason the feature exists. Two checkouts of one project share one Postgres, and a branch with an unmerged migration must not reach the other checkout's database.

**Setup.** Run once, for every case in this scenario.

1. Rebuild the playground, add the driver and commit it.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres --yes && pnpm install && git init -q && git add -A && git -c user.email=qa@test -c user.name=qa commit -qm "playground" && git branch -M main
```

2. Prepare the `main` database.

```sh
pnpm db:setup
```

3. Make a second worktree on a feature branch.

```sh
git worktree add ../playground-feature -b issue-999-add-widgets && cd ../playground-feature && pnpm install
```

- [ ] Setup complete

### TC-2.1: A second branch gets a database of its own · 🔴 Critical

**Goal.** A feature worktree creates a branch database and never writes to the `main` one.

**Steps**

1. Set the feature worktree up. Run this from `../playground-feature`.

   ```sh
   pnpm db:setup --server
   ```

   - [ ] The summary names a database with `issue_999` in it, not `playground_dev`
   - [ ] The last line says this branch has its own database and to run `pnpm db:drop` when done

2. Add a table in the feature worktree only, then apply it.

   ```sh
   printf 'import { pgTable, serial, text } from "drizzle-orm/pg-core";\n\nexport const widgets = pgTable("widgets", {\n  id: serial("id").primaryKey(),\n  name: text("name").notNull(),\n});\n' > packages/db/src/schema/widgets.ts && pnpm --filter @repo/db db:generate && pnpm db:setup
   ```

   - [ ] The migration applies against the branch database

3. Ask the server which databases exist.

   ```sh
   $DB_CMD "select datname from pg_database where datname like 'playground%' order by datname;"
   ```

   - [ ] Two rows: `playground_dev` and one branch database naming issue 999

4. Ask the `main` database whether the unmerged table reached it.

   ```sh
   $DB_CMD -d playground_dev "select table_name from information_schema.tables where table_schema = 'public';"
   ```

   - [ ] `widgets` is **not** there
     - this is the whole point of the branch rule; a hit here is a blocking failure

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

### TC-2.2: `db:drop` in one worktree leaves the other alone · 🔴 Critical

**Goal.** A drop reaches only the database the running worktree's state block names.

**Steps**

1. Drop from the feature worktree. Run this from `../playground-feature`.

   ```sh
   pnpm db:drop
   ```

   - [ ] The message names the branch database, not `playground_dev`

2. Ask the server what is left.

   ```sh
   $DB_CMD "select datname from pg_database where datname like 'playground%' order by datname;"
   ```

   - [ ] One row, `playground_dev`

3. Go back to the first worktree and read its status.

   ```sh
   cd ../playground && pnpm db:status
   ```

   - [ ] The report still names `playground_dev` and says it is reachable

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop/.dev/playground && git worktree remove ../playground-feature --force && docker compose down -v
```

## Scenario 3: playground with a database in place

**Setup.** Run once, for every case in this scenario.

1. Rebuild the playground, add the driver, and create a database on the container.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres --yes && pnpm install && pnpm db:setup
```

- [ ] Setup complete

### TC-3.1: `--server` and `--reset` on the same server · 🟡 Normal

**Goal.** A backend change needs `--reset`, and `--reset` replaces the database in place.

**Steps**

1. Ask for the server backend without `--reset`.

   ```sh
   pnpm db:setup --server
   ```

   - [ ] The command refuses, names the current database and backend, and prints the exact command to run instead

2. Run the command it named.

   ```sh
   pnpm db:setup --reset --server
   ```

   - [ ] The output says it is replacing the database, then reports `Backend   the server DATABASE_URL names`

3. Read the state block.

   ```sh
   head -5 apps/api/.dev.vars
   ```

   - [ ] The block now records `backend=server`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

### TC-3.2: The refusals read clearly · 🟡 Normal

**Goal.** Each refusal says what is wrong and what to do next, and never prints a password.

**Steps**

1. Pass two backend flags.

   ```sh
   cd packages/db && node scripts/setup.ts --docker --neon
   ```

   - [ ] One line, naming the three flags and saying to pass one

2. Pass a flag the command does not take.

   ```sh
   node scripts/setup.ts --wat
   ```

   - [ ] One line, naming the unknown flag and listing the flags it does take

3. Point `DATABASE_URL` at a database these scripts did not make, then try to drop it.

   ```sh
   cp ../../apps/api/.dev.vars /tmp/qa-devvars.bak && printf 'DATABASE_URL=postgres://user:secret@prod.example.com:5432/production\n' > ../../apps/api/.dev.vars && node scripts/drop.ts
   ```

   - [ ] The command drops nothing and says there is no development database
   - [ ] No output anywhere carries the password `secret`

4. Put the real file back.

   ```sh
   cp /tmp/qa-devvars.bak ../../apps/api/.dev.vars && cd ../..
   ```

   - [ ] The env file is back

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after every case above, before moving to Scenario 4.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop/.dev/playground && pnpm db:drop && docker compose down -v
```

## Scenario 4: playground reaching neon.new

Skip this scenario with no network.

**Setup.** Run once, for every case in this scenario.

1. Rebuild the playground and add the driver.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres --yes && pnpm install
```

- [ ] Setup complete

### TC-4.1: `--neon` creates, reports and drops · 🟢 Low

**Goal.** The neon backend creates a temporary database, reports its expiry, and drops it without touching the project.

**Steps**

1. Create the database on neon.new.

   ```sh
   pnpm db:setup --neon
   ```

   - [ ] The summary names neon.new, a `.neon.tech` host, the PostgreSQL 17 note, an expiry and a claim URL
   - [ ] No Docker container starts

2. Read the report.

   ```sh
   pnpm db:status
   ```

   - [ ] The report shows a time left, in hours and minutes

3. Drop it.

   ```sh
   pnpm db:drop
   ```

   - [ ] The message says the database went, and names neon.new

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after the case above, before moving to Scenario 5.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:destroy
```

## Scenario 5: fresh playground, d1 driver added

**Setup.** Run once, for every case in this scenario.

1. Rebuild the playground with the other driver, and give it a table.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:reset && cd .dev/playground && ./saasaloy add database-d1 --yes && pnpm install && printf 'import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";\n\nexport const widgets = sqliteTable("widgets", {\n  id: integer("id").primaryKey({ autoIncrement: true }),\n  name: text("name").notNull(),\n});\n' > packages/db/src/schema/widgets.ts && pnpm --filter @repo/db db:generate
```

- [ ] Setup complete

### TC-5.1: The three commands on D1 · 🔴 Critical

**Goal.** The same three command names work on D1, and `db:drop` deletes the local state only.

**Steps**

1. Confirm no root `compose.yaml` came with this driver.

   ```sh
   ls compose.yaml
   ```

   - [ ] The file does not exist; only the Postgres driver writes it

2. Prepare the database.

   ```sh
   pnpm db:setup
   ```

   - [ ] wrangler shows the migration applied, and the last line names `apps/api/.wrangler/state`

3. Read the report.

   ```sh
   pnpm db:status
   ```

   - [ ] The report names the state directory, and wrangler says there is nothing left to apply

4. Drop the local database.

   ```sh
   pnpm db:drop && ls apps/api/.wrangler/state
   ```

   - [ ] The message names the directory it deleted
   - [ ] `v3` remains but holds no `d1` directory

5. Run the drop a second time.

   ```sh
   pnpm db:drop
   ```

   - [ ] The command deletes nothing, says so, and points at `apps/api/.wrangler/state`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after the case above, before moving to Scenario 6.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:destroy
```

## Scenario 6: playground with the postgres driver

**Setup.** Run once, for every case in this scenario.

1. Rebuild the playground and add the driver. Do not run `db:setup`.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:reset && cd .dev/playground && ./saasaloy add database-postgres --yes
```

- [ ] Setup complete

### TC-6.1: `remove database-postgres` takes `compose.yaml` back · 🟡 Normal

**Goal.** The `@root` file is a managed file, so `remove` deletes it and warns about what it cannot reverse.

**Steps**

1. Confirm the alias and the file the add wrote.

   ```sh
   cat saasaloy.json && ls compose.yaml
   ```

   - [ ] `saasaloy.json` records `"@root": "."`
   - [ ] `compose.yaml` exists at the repo root, not under `packages/db`

2. Remove the driver.

   ```sh
   ./saasaloy remove database-postgres --yes
   ```

   - [ ] The output lists `compose.yaml` among the files it deleted
   - [ ] The warning names the script keys it leaves behind

3. Confirm the root file is gone.

   ```sh
   ls compose.yaml
   ```

   - [ ] The file does not exist

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after the case above, before moving to Scenario 7.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:destroy
```

## Scenario 7: the documents, read only

**Setup.** Run once, for every case in this scenario.

1. Return to the worktree root.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop
```

- [ ] Setup complete

### TC-7.1: The skills and the ADR match the commands · 🟢 Low

**Goal.** A developer who reads the documents gets the behaviour the scenarios above showed.

**Steps**

1. Read the Postgres driver skill's lifecycle section.

   ```sh
   sed -n '/## The lifecycle commands/,/## Hyperdrive/p' modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md
   ```

   - [ ] The section matches what the commands did
     - the three commands and the branch rule read the way Scenario 1 and Scenario 2 behaved
     - the backend table lists docker, server and neon, and says docker is the default
     - the example state block matches the file `db:setup` wrote
     - the `db:drop` paragraph says it drops a database and never a server

2. Read the D1 driver skill's lifecycle section.

   ```sh
   sed -n '/## The lifecycle commands/,/## Switching drivers/p' modules/database-d1/skills/saasaloy-database-d1/SKILL.md
   ```

   - [ ] The section says the commands are wrappers, and explains why D1 needs no backend and no state block

3. Read the decision record.

   ```sh
   cat docs/adr/0039-adr-the-db-lifecycle-commands-belong-to-the-drivers-2026-09-20.md
   ```

   - [ ] The record answers the two questions a reader will have
     - why the commands live in the drivers and not in a `db` capability
     - why a backend is not a provider

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after the case above.

```sh
cd /home/dev/worktrees/saasaloy/issue-152-add-db-setup-db-status-and-db-drop && pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Repository gates:

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm verify:pins
```

Driver payload tests, run on their own:

```sh
node --import ./scripts/ts-resolve-hook.ts --test "modules/database-postgres/files/**/*.test.ts"
```

Playground checks, run against a generated project before this plan was written:

```sh
pnpm play:init && cd .dev/playground && ./saasaloy add database-postgres --yes && pnpm install && pnpm typecheck
```

```sh
cd .dev/playground/packages/db && npx tsc --noEmit --listFiles | grep -c "packages/db/scripts"
```

Results:

- ✅ `pnpm lint` → all four passes clean, `modules/*/files/**` included.
- ✅ `pnpm typecheck` → clean.
- ✅ `pnpm test` → 1295 vitest tests, 584 module tests, 160 script tests, 0 failures.
- ✅ `pnpm verify:pins` → 2 pin rules agree across their manifests.
- ✅ Postgres payload tests → 44 tests over `branch-name.ts`, `state.ts` and `env-file.ts`, 0 failures.
- ✅ Playground typecheck → `@repo/db` compiles with `scripts/` in the program; the `--listFiles` count returned 11.
- ✅ Postgres docker backend → `db:setup` created `playground_dev`, applied one migration, `db:status` reported `Applied 1`, `db:drop` removed the database and left the container up.
- ✅ Postgres server backend → `db:setup --server` created the branch database on the same host, `db:status` reported it reachable, `db:drop` removed it.
- ✅ Postgres neon backend → `db:setup --neon` created a neon.new database, `db:status` reported `71h 59m left`, `db:drop` removed the database.
- ✅ Branch naming → `db:setup` on `issue-152-lifecycle` created `playground_dev_issue_152_99d87b` and left `playground_dev` alone.
- ✅ `@root` alias → `saasaloy add database-postgres` wrote `compose.yaml` at the playground root and recorded `"@root": "."` in `saasaloy.json`.
- ✅ D1 wrappers → `db:setup` applied the migration through wrangler, `db:status` exited 0, `db:drop` removed `apps/api/.wrangler/state/v3/d1` and the second run reported nothing to drop.
- ❌ `pnpm deps:check` → red, 70 outdated dependencies. This is the repo's standing dependency backlog and predates this change. It is not a regression from this work.

## Not covered / needs human judgment

- **Two worktrees against one shared server.** The agent ran both branches inside one checkout by switching branch. Scenario 2 is the real arrangement, with two worktrees, and only a human has set that up here.
- **`saasaloy remove database-postgres` on disk.** The unit tests cover deleting a repo-root managed file; nobody has watched `remove` do it in a generated project. Scenario 6 covers it.
- **A real shared Postgres.** The `server` backend was exercised against the local container, which is the same code path but not the same network. A VPN or tunnel failure produces an error message nobody has read yet.
- **Windows and macOS.** Every run was on Linux. The path handling and `docker compose` invocation are untested elsewhere.
- **Concurrency.** Two `db:setup` runs at the same moment are untested. `CREATE DATABASE` is guarded by an existence check, not by a lock.
- **Performance and accessibility.** Not applicable. These are command-line scripts with no UI and no data volume of their own.
- **Compatibility of the container image.** `postgres:18` was the only image tried. An older server is untested.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
