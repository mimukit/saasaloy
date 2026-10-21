# Plan: seed system (`db:seed`) and a route test harness on a real database

Grilled: 2026-10-20

## Context

A saasaloy project has no way to fill its development database. ADR 0042 and plan 0057 (lines 100-103) defer `db:seed`, and no issue was ever filed for it. Each project writes its own seed, and the first one that did (`unishopr-reborn/packages/db/src/seed/`) grew into a 3,200-line `fixtures.ts` and a 750-line `run.ts` that change together on every table. Its refactor survey (`unishopr-reborn/docs/refactor/0001-…`, candidate 6) asks for declared per-table seed slices so that a new table is one file, not three edits.

The api module also ships no tests and no test runner. A project that wants route tests against a real database has to invent the setup, the seeding and the isolation between tests.

primeshopr is waiting on both. Its plan 0018 Phase 0 is this seed system, and its test decision (Vitest against a test database, seed once per run, roll back per test) needs the harness. It is switching to `database-postgres`, but saasaloy keeps driver parity, so D1 gets the same seed.

Success: on a fresh project with either driver, `pnpm db:seed` fills every table from per-table slice files, a second run prints the same counts, the guard refuses a database the project does not own, a test fails when a table has no slice, and `pnpm test` runs route tests against a seeded test database.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Unit of seed data | A **seed slice**: one file per table in `packages/db/src/seed/slices/`, holding the typed rows (`$inferInsert`) keyed by slug, plus an optional `key` (the conflict columns). Adding a table means adding one slice. |
| Row identity | The engine derives each row's id from the table name and the slug, a UUIDv5-style hash (`seedId("users", "superadmin")`). A reference to another seed row is the same pure call, so no `.returning()` and no slug-to-id map exists. The upsert conflicts on those ids, so no table needs a `seed:` marker column. |
| Conflict key | One rule for every table. The conflict target is the table's primary key, read from `getTableConfig`. A generated primary key (`waitlist_entries` and the feature-flag tables use `GENERATED ALWAYS AS IDENTITY`) needs the slice to name a unique key instead (`key: ["email"]`, `key: ["flagKey", "tenantId"]`), and no other slice may reference those rows by slug. A composite key such as `billing_events` (`provider`, `provider_event_id`) needs nothing extra. `seedId` applies only where a slice wants a text id that other slices reference. |
| Rerun semantics | Upsert, not delete-then-insert: every row is an `insert … onConflictDoUpdate` on its conflict key, on both dialects. A rerun resets each seed row to its slice values, and a hand-made row that references a seed row (a session, an org a dev made as the superadmin, whose `members` foreign key has no cascade) stays valid. |
| A row removed from a slice | Stays in the database. The engine keeps no state between runs, so it cannot see seed rows from an earlier run. `pnpm db:setup --reset` is the documented fix. |
| Driver parity | Postgres and D1. Because every id is known before the first write, the engine builds the whole upsert plan up front. Postgres runs it in one transaction, D1 runs it as one `db.batch`, which D1 executes atomically. |
| Where the code lives | The `database` core scaffolds the driver-neutral engine (`packages/db/src/seed/`). Each driver ships its own `scripts/seed.ts` runner and guard, as ADR 0042 puts lifecycle commands in the drivers. |
| Slice discovery | `import.meta.glob("./slices/*.ts")`, the same mechanism as the schema barrel (`modules/database/files/src/schema.ts`). The runner loads the seed entry through Vite 8's `runnerImport` (vite `8.3.1`, already a `packages/db` devDependency), so the glob works outside the Worker build. `runnerImport` forces `configFile: false`, so `packages/db` needs no `vite.config.ts`, and it externalizes `drizzle-orm` and `postgres` so they load natively. The glob must be `eager: true`: `runnerImport` closes its runner before it returns, and a lazy loader called afterwards throws. No registry patch and no hand-kept list. |
| Insert order | Read from Drizzle's foreign-key metadata (`getTableConfig` for each dialect). A cycle stops the run with the tables named. A slice may add an extra `after` edge for an order the keys do not show. |
| Postgres guard | Reuses `assertManagedDatabase` from `database-postgres/files/scripts/lib/branch-name.ts`: the target must be `<prefix>` or `<prefix>_<x>`. The test database is `<prefix>_test`. `NODE_ENV=production` is refused before any connection opens. |
| D1 guard | The runner opens local D1 only, through wrangler's `getPlatformProxy` with `configPath` set to `apps/api/wrangler.jsonc`, `persist.path` set to the absolute `apps/api/.wrangler/state/v3` (that option takes the `v3` directory itself, unlike `--persist-to`), and `remoteBindings: false` (it defaults to `true`). It refuses `--remote` and `NODE_ENV=production`. |
| D1 while the api runs | Local D1 runs in WAL mode, so a seed beside an idle `vite dev` succeeds. A request that writes at the same moment makes the batch fail with `SQLITE_BUSY` and write nothing. The runner retries 3 times with a short backoff, then exits 1 with a message to stop the api or run the command again. |
| `db:setup` and seeding | Separate. `db:setup` (with or without `--reset`) never writes data, and it prints a hint to run `pnpm db:seed`. |
| Completeness | A Vitest test the `database` core scaffolds compares the schema barrel's tables with the slices and fails with the names of tables that have none. |
| Module slices | Every module that ships a table ships a slice with real example rows. `auth` ships a superadmin and a plain user with a documented dev password, stored as a precomputed Better Auth hash so the seed does not load Better Auth. One slice file serves both drivers, because each schema twin pair keeps the same export names and property names. A module adds a `.pg.ts`/`.sqlite.ts` slice twin only where a column's insert type differs. |
| Size of module example data | One row for each state the UI shows differently (one subscription per normalized status, one flag per `type`), with no number cap. This rule is the review test for a module slice. |
| Test runner | Vitest, exact-pinned in the base template's root `devDependencies` with a root `vitest.config.ts` over `apps/*` and `packages/*`. This is plan 0059's Phase 1, moved here because the harness needs it first. |
| Where route tests run | Node, not workerd. A test calls `app.request(path, init, env)`, and the harness's `testEnv()` builds the db bindings for each driver (`DATABASE_URL` for Postgres, the D1 binding from `getPlatformProxy` for D1). `@cloudflare/vitest-pool-workers` is rejected: a postgres.js transaction the test holds would cross request contexts and fail with "Cannot perform I/O on behalf of a different request". |
| The `getDb` test seam | A symbol key on `env`. `packages/db/src/testing.ts` exports `TEST_DB`, and `testEnv()` sets `env[TEST_DB] = tx`. `getDb` returns that value when the key is present, and `withDb` skips its close. No global state exists, and the override lives only on the `env` of one test. A route's own `db.transaction()` on that `tx` becomes a Postgres savepoint. |
| Isolation between tests | Postgres: each test runs inside a transaction that a Vitest fixture rolls back, and `getDb` returns that transaction through the `TEST_DB` seam while the fixture holds it. D1 has no interactive transactions, so the D1 harness reseeds local D1 once per test file. |
| Seeding in the playground | Plan 0066 seeds through the HTTP API from `modules/<name>/seed.ts`. Once this plan ships, `play:up` and `play:restore --db` call `pnpm db:seed` and that per-module seed file is dropped. |

## Approach

Port the shape unishopr proved (a guard, a runner, typed fixtures) with the refactor its survey asked for applied from the start, and change one thing that makes D1 parity cheap: the ids come from the slugs. The engine is pure (plan building, ordering, id derivation) and the drivers own only the connection, the guard and the write.

What it reuses:

- The schema barrel's glob convention (`modules/database/files/src/schema.ts`) for slice discovery.
- `database-postgres/files/scripts/lib/` (`context.ts`, `branch-name.ts`, `env-file.ts`, `url.ts`) for the env file, the database name and the managed-name check.
- The D1 driver's script layout (`database-d1/files/scripts/`) and its `package-json-script` patches for `db:seed` at the root and in `packages/db`.
- The `onlyWith` mechanism the schema twins use, for the rare slice twin.
- `scripts/table-names.test.ts` as the model for a repo test that reads every module's schema files.
- Plan 0059 Phase 1 for the Vitest layout.

Rejected, one line each: delete-then-insert (a hand-made row that references a seed row through a foreign key with no cascade blocks every rerun); the unishopr marker column with `.returning()` (it needs interactive transactions, which D1 lacks); seeding through the HTTP API (plan 0066's idea, which cannot reach a table without a route, so no completeness check); a `plugin-array` registry of slices (a second list to keep in step with the files, when the glob already exists).

### Phase 1: Vitest in the base template (#207) (built 2026-10-20)

- Add `vitest` exact-pinned to the template root `devDependencies`, a root `vitest.config.ts` with `projects` over `apps/*` and `packages/*`, and point the root `test` script at it.
- Turn on oxlint's `vitest` preset in the template's `oxlint.config.mjs`.
- Mark plan 0059 Phase 1 as moved here.

Done when: `saasaloy init` in `.dev` followed by `pnpm test` runs Vitest, finds no tests, and exits 0, and `pnpm deps:check` lists the new pin.

### Phase 2: Seed engine in the `database` core (#207) (built 2026-10-20)

- Scaffold `packages/db/src/seed/`: `slice.ts` (`defineSlice`, the slice type), `id.ts` (`seedId`), `order.ts` (foreign-key order, cycle error), `plan.ts` (the upsert plan from slices and schema, with the conflict key resolved for each table), `index.ts` (the glob over `slices/*.ts`), and an empty `slices/` folder.
- Scaffold `packages/db/src/seed/completeness.test.ts`.
- Add `./seed/*` to `packages/db/package.json` exports.
- Repo tests (`node:test`) for `seedId` stability, ordering, the cycle error, conflict-key resolution (single text id, generated id with a `key`, composite key, generated id without a `key` as an error) and plan building over both dialects.

Done when: `pnpm test:modules` passes with the engine tests, and on a fresh `.dev` project with `database` and either driver, `pnpm test` runs the completeness test and it passes with zero tables.

### Phase 3: Postgres runner (#207) (built 2026-10-20)

- `database-postgres/files/scripts/seed.ts`: load the seed entry through `runnerImport`, run the guard, open one postgres.js connection, run the plan in one transaction, print a count per table and the database name.
- `db:seed` in `packages/db` and at the root. `db:setup` prints a hint to run it and never seeds, `--reset` included.
- Repo tests for the guard.

Done when: on a fresh `.dev` project with `database-postgres`, `pnpm db:setup` then `pnpm db:seed` seeds one hand-written example slice and prints its count, a second run prints the same count and the row count in the table is unchanged, a seed row edited by hand is back to its slice values after the rerun, a row inserted by hand survives the rerun, `DATABASE_URL` naming `postgres` makes `db:seed` exit 1 with no write, and `NODE_ENV=production pnpm db:seed` exits 1 before it connects.

### Phase 4: D1 runner (#207) (built 2026-10-20)

- `database-d1/files/scripts/seed.ts`: the same entry through `runnerImport`, local D1 through `getPlatformProxy` (absolute `persist.path`, `remoteBindings: false`), the plan as one `db.batch` with the `SQLITE_BUSY` retry, the same output.
- `db:seed` scripts as in Phase 3.

Done when: the Phase 3 checks pass on a fresh `.dev` project with `database-d1` (with `--remote` in place of the `postgres` database name for the refusal check), and `db:seed` succeeds while `pnpm dev` runs the api with no request in flight.

### Phase 5: Module slices (#207) (built 2026-10-20)

- Ship a slice with real rows from `auth` (`users`, `accounts`; `sessions` and `verifications` ship empty slices), `billing`, `waitlist`, `feature-flags`, `api-keys`, `teams` and `multitenant`, each landing at `@db/seed/slices/<table>.ts`, with one row for each state the UI shows differently.
- Document the dev password the `auth` slice uses, and print it at the end of `db:seed` when the `users` slice ran.
- A repo test that fails when a module ships a `files/db/schema/*` file and no slice for each table in it.

Done when: on a `.dev` project with every module that has a table, on each driver, `pnpm db:seed` prints a count for every table, the completeness test passes, the repo test passes, and the seeded superadmin signs in to the admin app with the documented password.

### Phase 6: Postgres route test harness (#207) (built 2026-10-20)

- In `database-postgres`: `packages/db/src/testing.ts` with `TEST_DB` and `testEnv()`; the `TEST_DB` branch in `getDb` and `withDb` of both drivers' `client.ts`; a Vitest `globalSetup` for `apps/api` that creates `<prefix>_test` through the existing backend code when it is missing, migrates it and seeds it once per run, reading `TEST_DATABASE_URL` or deriving it from `DATABASE_URL`.
- A `test` fixture that opens a transaction, hands it to `getDb` through `env[TEST_DB]`, and rolls it back after the test.
- One example route test in `apps/api`, calling `app.request` in Node, that reads a seeded row through a route and writes one, and a second test that proves the write is gone.

Done when: on a fresh `.dev` project with `database-postgres` and `auth`, `pnpm test` creates `<prefix>_test` on the first run, both example tests pass, a second `pnpm test` passes without reseeding, and `psql` shows the seeded row count unchanged after the run.

### Phase 7: D1 route test harness (#207) (built 2026-10-20)

- In `database-d1`: the same `globalSetup` shape on local D1 under a separate persist directory (opened through `getPlatformProxy` in Node, so `testEnv()` hands the routes that D1 binding), and a per-file hook that reruns the seed plan.
- The same two example tests.

Done when: the Phase 6 example tests pass on a fresh `.dev` project with `database-d1`, and the dev database under `apps/api/.wrangler/state` is untouched by the run.

### Phase 8: Docs and the term (#207) (built 2026-10-20)

- A "Seed data" section in the `saasaloy-database` skill (the slice contract, `seedId`, the conflict-key rule, upsert reruns, the removed-row rule and its `db:setup --reset` fix, the one-row-per-UI-state rule, the "a table change updates its slice" rule) and runbook sections in both driver skills (guard, `db:seed`, `SQLITE_BUSY` on D1, the test harness).
- Add **seed slice** to `CONTEXT.md`.
- Update plan 0057's follow-up list, plan 0059 (Phase 1 moved) and plan 0066 (seeding through `db:seed`).

Done when: each skill names `pnpm db:seed` and the slice path, `CONTEXT.md` defines "seed slice", and plans 0057, 0059 and 0066 link to this plan.

## Open questions

None. The 2026-10-20 grill settled all six earlier questions: rerun semantics, the `getDb` seam, D1 beside a running api, the `vite.config.ts` need, the size of module data and `db:setup --reset`.

## Non-goals

- Seeding production or any remote database.
- Random or generated data (faker). Fixtures are hand-written.
- A data migration between drivers.
- Playwright and the e2e module (plan 0059 Phases 2 and on).
- Porting primeshopr's schema or writing its slices. That is primeshopr plan 0018 Phase 1.
