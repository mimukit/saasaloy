# QA Plan: Parallel route tests, one database per worker

_Generated 2026-11-16 · against `cd4b2791` (clean; rebased onto `origin/main` as `a99c9f01`, docs-only base commits) · covers the `api` worker count and the `database-postgres` worker copies, `db:prune` and `db:drop`_

## Summary

- The api route test files run in parallel, and each Vitest worker uses its own copy of the seeded Postgres test database.
- "Working" means every route test passes at the computed worker count, at `API_TEST_WORKERS=1`, and on every backend, and no copy outlives its test database.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `hotfix-parallel-route-tests` at `cd4b2791`.
- Target: a project scaffolded in `.dev/playground` with `database-postgres`, `auth` and `admin`, and testing mode `tests-after`.
- The CLI comes from this checkout. `pnpm play:init` builds it.
- No screenshots: the change has no UI.

Scaffold the playground with:

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy testing tests-after && ./saasaloy add database-postgres auth admin --yes && pnpm install
```

Set the database client once. Every query below runs through it. A function works in bash and in zsh; a `$DB_CMD` variable does not split into words in zsh.

```sh
db_cmd() { docker compose exec -T postgres psql -U postgres -At "$@"; }
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Docker backend, seeded test database | Root run makes one unmapped copy per worker | 🔴 Critical |
| TC-1.2 | 1: Docker backend, seeded test database | Five runs in a row pass, copies start fresh | 🔴 Critical |
| TC-1.3 | 1: Docker backend, seeded test database | `API_TEST_WORKERS=1` runs serially with no copies | 🔴 Critical |
| TC-1.4 | 1: Docker backend, seeded test database | `API_TEST_WORKERS` sets the count, a bad value is ignored | 🟡 Normal |
| TC-1.5 | 1: Docker backend, seeded test database | `db:prune` keeps live copies and drops an orphan | 🔴 Critical |
| TC-1.6 | 1: Docker backend, seeded test database | `db:drop` drops the copies | 🟡 Normal |
| TC-2.1 | 2: neon.new backend | No copies on neon, every worker shares one database | 🔴 Critical |
| TC-3.1 | 3: Shared Postgres server (`--server`) | Copies work on a server other projects use | 🟡 Normal |
| TC-4.1 | 4: Repository checkout | The skills and the config comment describe the copies | 🟢 Low |

## Scenario 1: Docker backend, seeded test database · run by the agent on `.dev/playground` at `cd4b2791`

**Setup.** Run once, for every case in this scenario.

1. Create the development database in a local container.

```sh
pnpm db:setup --docker
```

2. Generate the first migration.

```sh
pnpm --filter @repo/db db:generate
```

3. Write the env source, then each service's `.env`. Leave `AUTH_COOKIE_PREFIX` and `COOKIE_DOMAIN` out: the auth tests expect unprefixed cookie names.

```sh
{ grep DATABASE_URL apps/api/.env; echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"; printf 'BETTER_AUTH_URL=http://localhost:4000\nCORS_ORIGINS=http://localhost:3000\nLOGGER_PROVIDER=console\nLOG_LEVEL=info\nDEV_HOST=localhost\nPUBLIC_SITE_URL=http://localhost:3000\nPUBLIC_API_URL=http://localhost:4000\n'; } > packages/env/.env && pnpm env:setup
```

- [x] Setup complete

### TC-1.1: Root run makes one unmapped copy per worker  ·  🔴 Critical

**Goal.** A full `vitest run` passes, and each api worker runs on its own copy.

**Steps**

1. Run every project from the repo root.

   ```sh
   pnpm exec vitest run
   ```

   - [x] All test files pass
2. List the test database and its copies, with the mapping comment and use.

   ```sh
   db_cmd -c "select d.datname, shobj_description(d.oid,'pg_database') is not null as mapped, s.xact_rollback > 0 as used from pg_database d join pg_stat_database s on s.datname = d.datname where d.datname like 'playground_dev_test%' order by 1;"
   ```

   - [x] Four copies `_w1` to `_w4` exist, none mapped, and each one has rolled-back transactions

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** The box has 8 CPUs and a 28 GiB cgroup limit, so the count is 4.

```text
 Test Files  23 passed (23)
playground_dev_test|t|t
playground_dev_test_w1|f|t
playground_dev_test_w2|f|t
playground_dev_test_w3|f|t
playground_dev_test_w4|f|t
```

### TC-1.2: Five runs in a row pass, copies start fresh  ·  🔴 Critical

**Goal.** Repeated runs stay green, and each run copies the seed again.

**Steps**

1. Put a marker table into the first copy.

   ```sh
   db_cmd -d playground_dev_test_w1 -c "create table qa_marker (id int);"
   ```

2. Run the api project five times.

   ```sh
   for i in 1 2 3 4 5; do pnpm exec vitest run --project @repo/api 2>&1 | grep -E "Tests |Duration"; done
   ```

   - [x] Every run passes 78 of 78
3. Look for the marker table.

   ```sh
   db_cmd -d playground_dev_test_w1 -c "select to_regclass('qa_marker') is null as marker_gone;"
   ```

   - [x] The query prints `t`: the run replaced the copy

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Each run took 5.29 s to 5.45 s.

### TC-1.3: `API_TEST_WORKERS=1` runs serially with no copies  ·  🔴 Critical

**Goal.** The override restores the serial run on the test database itself.

**Steps**

1. Drop the four copies, so a new copy is easy to see.

   ```sh
   for n in 1 2 3 4; do db_cmd -c "drop database playground_dev_test_w$n with (force);"; done
   ```

2. Run the api project on one worker.

   ```sh
   API_TEST_WORKERS=1 pnpm exec vitest run --project @repo/api
   ```

   - [x] All 78 tests pass
3. Count the copies.

   ```sh
   db_cmd -c "select count(*) from pg_database where datname like 'playground_dev_test_w%';"
   ```

   - [x] The count is `0`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** The serial run took 14.35 s, against about 5.4 s at 4 workers.

### TC-1.4: `API_TEST_WORKERS` sets the count, a bad value is ignored  ·  🟡 Normal

**Goal.** A whole number sets the count, and any other value falls back to the computed count.

**Steps**

1. Run on two workers, then list the copies.

   ```sh
   API_TEST_WORKERS=2 pnpm exec vitest run --project @repo/api && db_cmd -c "select string_agg(datname, ',' order by datname) from pg_database where datname like 'playground_dev_test_w%';"
   ```

   - [x] The tests pass, and only `_w1` and `_w2` exist
2. Run with a value that is not a count, then list the copies.

   ```sh
   API_TEST_WORKERS=abc pnpm exec vitest run --project @repo/api && db_cmd -c "select string_agg(datname, ',' order by datname) from pg_database where datname like 'playground_dev_test_w%';"
   ```

   - [x] The tests pass, and `_w1` to `_w4` exist

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Both runs passed 78 of 78.

### TC-1.5: `db:prune` keeps live copies and drops an orphan  ·  🔴 Critical

**Goal.** A copy follows its base: kept while the base stays, dropped when the base is gone.

**Steps**

1. Create a copy whose base test database does not exist.

   ```sh
   db_cmd -c "create database playground_dev_gone_test_w2;"
   ```

2. Prune.

   ```sh
   pnpm db:prune --apply
   ```

   - [x] The orphan is dropped, and `_w1` to `_w4` stay as `base kept`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

```text
  prune  playground_dev_gone_test_w2  7673 kB
  keep   playground_dev (branch main)  default
  keep   playground_dev_test (branch main)  default
  keep   playground_dev_test_w1  base kept
  keep   playground_dev_test_w2  base kept
  keep   playground_dev_test_w3  base kept
  keep   playground_dev_test_w4  base kept
Dropped playground_dev_gone_test_w2.
```

### TC-1.6: `db:drop` drops the copies  ·  🟡 Normal

**Goal.** `db:drop` leaves no copy of the test database behind.

**Steps**

1. Drop the development database.

   ```sh
   pnpm db:drop
   ```

   - [x] The message names the test database and its 4 worker copies
2. Count the project's databases.

   ```sh
   db_cmd -c "select count(*) from pg_database where datname like 'playground%';"
   ```

   - [x] The count is `0`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** `Dropped playground_dev and playground_dev_test with its 4 worker copies on a local Docker container, ...`

**Reset.** Run after every case above, before moving to Scenario 2. The agent ran it.

```sh
docker compose down -v
```

## Scenario 2: neon.new backend

**Setup.** Run once, for every case in this scenario. This creates a neon.new project that deletes itself after a few days.

1. Drop any docker database, then create one on neon.new.

```sh
pnpm db:drop; pnpm db:setup --neon
```

- [ ] Setup complete

### TC-2.1: No copies on neon, every worker shares one database  ·  🔴 Critical

**Goal.** The setup skips the copies on neon, so no run fails on "source database is being accessed by other users".

**Steps**

1. Run the api project. Node needs IPv4 first to reach neon on some networks.

   ```sh
   NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection" pnpm exec vitest run --project @repo/api
   ```

   - [ ] No error `55006` appears, and no test fails other than on the 5 s timeout
     - the agent saw 12 timeouts at 4 workers and 11 in a serial run, from the latency to neon.new
2. Read the database list on neon. Get the direct host from `DATABASE_URL` in `apps/api/.env` without `-pooler`.

   ```sh
   psql "$(grep ^DATABASE_URL= apps/api/.env | cut -d= -f2- | sed 's/-pooler\././; s#/[^/?]*?#/postgres?#')" -Atc "select datname from pg_database where datname like '%_test%';"
   ```

   - [ ] Only `playground_dev_test` exists, with no `_w<N>` copy

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
pnpm db:drop
```

## Scenario 3: Shared Postgres server (`--server`)

**Setup.** Run once, for every case in this scenario. You need a Postgres server that other projects use, and a role with `CREATEDB`.

1. Put the server's connection string into `apps/api/.env` as `DATABASE_URL`, then create the database.

```sh
pnpm db:setup --server
```

- [ ] Setup complete

### TC-3.1: Copies work on a server other projects use  ·  🟡 Normal

**Goal.** The copies work on a real shared server and leave other projects' databases alone.

**Steps**

1. Run the api project twice.

   ```sh
   pnpm exec vitest run --project @repo/api && pnpm exec vitest run --project @repo/api
   ```

   - [ ] Both runs pass
     - a PgBouncer in front of the server must not cause error `55006`
2. Preview a prune.

   ```sh
   pnpm db:prune --server
   ```

   - [ ] The copies show `base kept`, and no database of another project is listed for pruning

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
pnpm db:drop
```

## Scenario 4: Repository checkout

**Setup.** None. Open the files in this checkout.

- [ ] Setup complete

### TC-4.1: The skills and the config comment describe the copies  ·  🟢 Low

**Goal.** A developer who reads the docs knows how the copies, the worker count and the override work.

**Steps**

1. Read the "Route tests" section of `modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md`, the worker bullet in `modules/api/skills/saasaloy-api/SKILL.md`, and the comment block in `modules/api/files/vitest.config.ts`.
   - [ ] The three texts agree, and each one reads clearly
     - copy names `<database>_test_w<N>`, fresh on every run
     - `maxWorkers` and `sequence.groupOrder` at the root of `test`
     - `API_TEST_WORKERS`, and `API_TEST_WORKERS=1` for a serial run
     - the neon fallback and the prune rule

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm typecheck
```

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy testing tests-after && ./saasaloy add database-d1 auth admin --yes && pnpm install && pnpm --filter @repo/db db:generate && pnpm env:setup
```

```sh
pnpm exec vitest run
```

```sh
API_TEST_WORKERS=1 pnpm exec vitest run --project @repo/api
```

- ✅ `pnpm typecheck` at `cd4b2791` → passes
- ✅ `pnpm lint` at `cd4b2791` → all four passes clean
- ✅ `pnpm test` at `cd4b2791` → CLI 2,030 of 2,030, modules 1,292 of 1,292, base 147 of 147, tooling 350 of 350, scripts 595 of 595
- ✅ module tests for the new names → `workerDatabaseName`, `isWorkerDatabase` and `workerNumber`, and the `planPrune` worker-copy cases, all inside `test:modules`
- ✅ `database-d1` regression on the playground → root run 256 of 256, and the api project serial run 78 of 78, with the new `maxWorkers` and `groupOrder`
- ✅ worker count on this box → 8 CPUs and a 28 GiB cgroup limit give 4 workers
- ✅ static database facts (Scenario 1) → copies exist as plain databases, unmapped; no migration or table in the change

## Not covered / needs human judgment

- The `testDatabase()` error for a worker number above the copy count. No supported setting makes Vitest hand out such a number, so nothing triggers it.
- A cgroup v1 host. `test/workers.ts` reads only the cgroup v2 limit, and falls back to `os.totalmem()`.
- The primeshopr timings (200 s at 3 workers, 127 s at 5). The playground has 78 api tests, not 1,165.
- `database-d1` speed. The api project now runs at most 4 workers and after the other workspaces. The agent checked that it passes, not how fast it is.
- Compatibility, accessibility and usability: the change has no UI.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
