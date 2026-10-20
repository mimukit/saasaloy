# Plan: seed system (`db:seed`) and a route test harness on a real database

## Context

A saasaloy project has no way to fill its development database. ADR 0042 and plan 0057 (lines 100-103) defer `db:seed`, and no issue was ever filed for it. Each project writes its own seed, and the first one that did (`unishopr-reborn/packages/db/src/seed/`) grew into a 3,200-line `fixtures.ts` and a 750-line `run.ts` that change together on every table. Its refactor survey (`unishopr-reborn/docs/refactor/0001-…`, candidate 6) asks for declared per-table seed slices so that a new table is one file, not three edits.

The api module also ships no tests and no test runner. A project that wants route tests against a real database has to invent the setup, the seeding and the isolation between tests.

primeshopr is waiting on both. Its plan 0018 Phase 0 is this seed system, and its test decision (Vitest against a test database, seed once per run, roll back per test) needs the harness. It is switching to `database-postgres`, but saasaloy keeps driver parity, so D1 gets the same seed.

Success: on a fresh project with either driver, `pnpm db:seed` fills every table from per-table slice files, a second run prints the same counts, the guard refuses a database the project does not own, a test fails when a table has no slice, and `pnpm test` runs route tests against a seeded test database.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Unit of seed data | A **seed slice**: one file per table in `packages/db/src/seed/slices/`, holding the typed rows (`$inferInsert`) keyed by slug, plus an optional extra delete predicate. Adding a table means adding one slice. |
| Row identity | The engine derives each row's id from the table name and the slug, a UUIDv5-style hash (`seedId("users", "superadmin")`). A reference to another seed row is the same pure call, so no `.returning()` and no slug-to-id map exists. Delete is by those ids, so no table needs a `seed:` marker column. |
| Tables with an integer identity id | `waitlist_entries` and the feature-flag tables use `GENERATED ALWAYS AS IDENTITY`. Their slices name a natural unique key (the email, the flag key) that the engine deletes by, and no other slice may reference their rows by slug. |
| Driver parity | Postgres and D1. Because every id is known before the first write, the engine builds the whole delete-then-insert plan up front. Postgres runs it in one transaction, D1 runs it as one `db.batch`, which D1 executes atomically. |
| Where the code lives | The `database` core scaffolds the driver-neutral engine (`packages/db/src/seed/`). Each driver ships its own `scripts/seed.ts` runner and guard, as ADR 0042 puts lifecycle commands in the drivers. |
| Slice discovery | `import.meta.glob("./slices/*.ts")`, the same mechanism as the schema barrel (`modules/database/files/src/schema.ts`). The runner loads the seed entry through Vite 8's `runnerImport`, so the glob works outside the Worker build. No registry patch and no hand-kept list. |
| Insert order | Read from Drizzle's foreign-key metadata (`getTableConfig` for each dialect). Deletes run in reverse order. A cycle stops the run with the tables named. A slice may add an extra `after` edge for an order the keys do not show. |
| Postgres guard | Reuses `assertManagedDatabase` from `database-postgres/files/scripts/lib/branch-name.ts`: the target must be `<prefix>` or `<prefix>_<x>`. The test database is `<prefix>_test`. `NODE_ENV=production` is refused before any connection opens. |
| D1 guard | The runner opens local D1 only, through wrangler's `getPlatformProxy`. It refuses `--remote` and `NODE_ENV=production`. |
| Completeness | A Vitest test the `database` core scaffolds compares the schema barrel's tables with the slices and fails with the names of tables that have none. |
| Module slices | Every module that ships a table ships a slice with real example rows. `auth` ships a superadmin and a plain user with a documented dev password, stored as a precomputed Better Auth hash so the seed does not load Better Auth. One slice file serves both drivers, because each schema twin pair keeps the same export names and property names. A module adds a `.pg.ts`/`.sqlite.ts` slice twin only where a column's insert type differs. |
| Test runner | Vitest, exact-pinned in the base template's root `devDependencies` with a root `vitest.config.ts` over `apps/*` and `packages/*`. This is plan 0059's Phase 1, moved here because the harness needs it first. |
| Isolation between tests | Postgres: each test runs inside a transaction that a Vitest fixture rolls back, and `getDb` returns that transaction while the fixture holds it. D1 has no interactive transactions, so the D1 harness reseeds local D1 once per test file. |
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

Rejected, one line each: the unishopr marker column with `.returning()` (it needs interactive transactions, which D1 lacks); seeding through the HTTP API (plan 0066's idea, which cannot reach a table without a route, so no completeness check); a `plugin-array` registry of slices (a second list to keep in step with the files, when the glob already exists).

### Phase 1: Vitest in the base template (#207)

- Add `vitest` exact-pinned to the template root `devDependencies`, a root `vitest.config.ts` with `projects` over `apps/*` and `packages/*`, and point the root `test` script at it.
- Turn on oxlint's `vitest` preset in the template's `oxlint.config.mjs`.
- Mark plan 0059 Phase 1 as moved here.

Done when: `saasaloy init` in `.dev` followed by `pnpm test` runs Vitest, finds no tests, and exits 0, and `pnpm deps:check` lists the new pin.

### Phase 2: Seed engine in the `database` core (#207)

- Scaffold `packages/db/src/seed/`: `slice.ts` (`defineSlice`, the slice type), `id.ts` (`seedId`), `order.ts` (foreign-key order, cycle error), `plan.ts` (the delete-then-insert plan from slices and schema), `index.ts` (the glob over `slices/*.ts`), and an empty `slices/` folder.
- Scaffold `packages/db/src/seed/completeness.test.ts`.
- Add `./seed/*` to `packages/db/package.json` exports.
- Repo tests (`node:test`) for `seedId` stability, ordering, the cycle error and plan building over both dialects.

Done when: `pnpm test:modules` passes with the engine tests, and on a fresh `.dev` project with `database` and either driver, `pnpm test` runs the completeness test and it passes with zero tables.

### Phase 3: Postgres runner (#207)

- `database-postgres/files/scripts/seed.ts`: load the seed entry through `runnerImport`, run the guard, open one postgres.js connection, run the plan in one transaction, print a count per table and the database name.
- `db:seed` in `packages/db` and at the root. `db:setup` prints a hint to run it.
- Repo tests for the guard.

Done when: on a fresh `.dev` project with `database-postgres`, `pnpm db:setup` then `pnpm db:seed` seeds one hand-written example slice and prints its count, a second run prints the same count and the row count in the table is unchanged, a row inserted by hand survives the rerun, `DATABASE_URL` naming `postgres` makes `db:seed` exit 1 with no write, and `NODE_ENV=production pnpm db:seed` exits 1 before it connects.

### Phase 4: D1 runner (#207)

- `database-d1/files/scripts/seed.ts`: the same entry through `runnerImport`, local D1 through `getPlatformProxy`, the plan as one `db.batch`, the same output.
- `db:seed` scripts as in Phase 3.

Done when: the Phase 3 checks pass on a fresh `.dev` project with `database-d1` (with `--remote` in place of the `postgres` database name for the refusal check).

### Phase 5: Module slices (#207)

- Ship a slice with real rows from `auth` (`users`, `accounts`; `sessions` and `verifications` delete seed rows only), `billing`, `waitlist`, `feature-flags`, `api-keys`, `teams` and `multitenant`, each landing at `@db/seed/slices/<table>.ts`.
- Document the dev password the `auth` slice uses, and print it at the end of `db:seed` when the `users` slice ran.
- A repo test that fails when a module ships a `files/db/schema/*` file and no slice for each table in it.

Done when: on a `.dev` project with every module that has a table, on each driver, `pnpm db:seed` prints a count for every table, the completeness test passes, the repo test passes, and the seeded superadmin signs in to the admin app with the documented password.

### Phase 6: Postgres route test harness

- In `database-postgres`: a Vitest `globalSetup` for `apps/api` that creates `<prefix>_test` through the existing backend code when it is missing, migrates it and seeds it once per run, reading `TEST_DATABASE_URL` or deriving it from `DATABASE_URL`.
- A `test` fixture that opens a transaction, hands it to `getDb` through a test-only seam in `packages/db/src/client.ts`, and rolls it back after the test.
- One example route test in `apps/api` that reads a seeded row through a route and writes one, and a second test that proves the write is gone.

Done when: on a fresh `.dev` project with `database-postgres` and `auth`, `pnpm test` creates `<prefix>_test` on the first run, both example tests pass, a second `pnpm test` passes without reseeding, and `psql` shows the seeded row count unchanged after the run.

### Phase 7: D1 route test harness

- In `database-d1`: the same `globalSetup` shape on local D1 under a separate persist directory, and a per-file hook that reruns the seed plan.
- The same two example tests.

Done when: the Phase 6 example tests pass on a fresh `.dev` project with `database-d1`, and the dev database under `apps/api/.wrangler/state` is untouched by the run.

### Phase 8: Docs and the term (#207)

- A "Seed data" section in the `saasaloy-database` skill (the slice contract, `seedId`, the natural-key rule, the "a table change updates its slice" rule) and runbook sections in both driver skills (guard, `db:seed`, the test harness).
- Add **seed slice** to `CONTEXT.md`.
- Update plan 0057's follow-up list, plan 0059 (Phase 1 moved) and plan 0066 (seeding through `db:seed`).

Done when: each skill names `pnpm db:seed` and the slice path, `CONTEXT.md` defines "seed slice", and plans 0057, 0059 and 0066 link to this plan.

## Open questions

- A row created by hand in dev that references a seed row (a session of the seeded user, an order of a seeded shopper) blocks the delete when its foreign key has no cascade. Does the engine delete dependents it did not insert, refuse with the table named, or leave it to each slice's extra predicate?
- The `getDb` seam: a module-level override that only the test fixture sets, a value on `env`, or `AsyncLocalStorage`. Which one keeps production code free of test branches and still works when a route opens its own nested transaction (a savepoint on Postgres)?
- Can `db:seed` run on local D1 while `wrangler dev` holds the same SQLite file, or must the runner refuse while the api is running?
- Does `runnerImport` load the drizzle-orm and postgres.js imports the slices and runner need without a `vite.config.ts` in `packages/db`, or does the core scaffold a minimal one?
- How large may a module's example data get before it becomes noise in a project that edits it? A cap per slice, or a rule that module rows only cover each status value once?
- Should `db:setup --reset` seed by default, as the unishopr precedent did, or stay separate so `db:setup` never writes data?

## Non-goals

- Seeding production or any remote database.
- Random or generated data (faker). Fixtures are hand-written.
- A data migration between drivers.
- Playwright and the e2e module (plan 0059 Phases 2 and on).
- Porting primeshopr's schema or writing its slices. That is primeshopr plan 0018 Phase 1.
