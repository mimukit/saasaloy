---
name: saasaloy-testing
description: Pick the test a change needs and write it the way this project's testing mode asks. Use when the AGENTS.md testing block says tests-after or tdd, when adding or changing a route, a pure function, a provider, a table or a user-visible flow, when the owner asks "which test do I write", "how do I test this route", "turn TDD on", or when deciding whether a change needs a test at all.
---

# saasaloy-testing — which test a change needs

This project records one testing mode in `saasaloy.json`, under `testing.mode`. Read it before you write code. An absent key reads as `off`.

| Mode | What it asks of you |
| --- | --- |
| `off` | The project ships no module tests, and `saasaloy add` writes none. Write a test only when the owner asks for one. |
| `tests-after` | Every change ships with its test, written once the code works. Run `pnpm test` before you hand the change over. It must pass. |
| `tdd` | Write the test first, one behaviour at a time, in the loop below. Run `pnpm test` before you hand the change over. |

The marked block under "Testing Instructions" in the root `AGENTS.md` states the same mode. Change the mode with `saasaloy testing <off|tests-after|tdd>`, never by editing either file. The command rewrites `saasaloy.json` and the block together. `saasaloy testing` with no argument prints the mode.

Turning testing on also brings in the tests the installed modules ship, such as `apps/api/src/routes/auth.test.ts`. Turning it off deletes nothing.

## The TDD loop

1. Write one failing test for the next behaviour. The table below says which kind.
2. Run that one file, and see it fail for the reason you stated. A test that fails on an import error has not tested anything yet.
3. Write the code that makes it pass, and no more.
4. Run the file again, and see it pass.

Write no code that a failing test did not ask for. Run one file while you work (`pnpm vitest run <path>`), and the whole `pnpm test` once at the end.

## Which test a change needs

| The change | Its test | Where it goes |
| --- | --- | --- |
| Pure logic: a parser, a price rule, a formatter | A unit test | `<name>.test.ts` beside the file |
| An api route | A route test with `testDatabase()`, four cases | `apps/api/src/routes/<route>.test.ts` |
| A provider behind a capability | The capability's contract suite | Not shipped yet, see below |
| A new table | A seed slice | `packages/db/src/seed/slices/<table>.ts` |
| A user-visible flow | A Playwright spec | `packages/e2e/specs/<feature>-<journey>.spec.ts`, once `e2e` is installed |

Every Vitest file is a `*.test.ts` beside its code. The root `vitest.config.ts` collects it, so a workspace needs no `test` script of its own.

### A unit test

Test the function through its inputs and outputs. Import it, call it, assert on what it returns. Mock nothing the function owns. A function that needs a database or a request is a route, not a unit.

### A route test

Copy `apps/api/src/routes/auth.test.ts`, which the `auth` module ships. It shows the whole shape:

- `const database = testDatabase();` from `@repo/db/testing`, once at the top of the file.
- `app.request(path, init, database.env)` to call the route, with `app` imported from `../index`.
- `database.db` to look behind the route at the rows it wrote.
- A seeded user signed in through `/auth/sign-in/email` for a session cookie. Every seed user signs in with `saasaloy-dev-password`, and `seedId("users", "<slug>")` from `@repo/db/seed/id` gives its id.

Each test starts from the seed, and nothing a test writes reaches the next one. Cover four cases for every route:

1. Success: the right caller gets the right answer, and the rows changed as they should.
2. `401` with no session cookie.
3. `403` for the wrong tenant or the wrong role: a signed-in user who must not see or change this record.
4. One `400` for bad input.

A public route has no `401` or `403` case. Say so in a comment, and keep the other two.

The test database needs the database driver's setup. Read the `saasaloy-database-d1` or `saasaloy-database-postgres` skill, "Route tests", when `testDatabase()` refuses to start.

### A provider

Each capability with providers (`email`, `sms`, `queue`, `kv`, `storage`, `payment`, `logger`) is to get a contract suite: one shared set of tests that every provider of that capability must pass. The contract suites are not shipped yet. Until they arrive, test a new provider with unit tests on its own mapping: the vendor error codes it turns into the capability's error codes, and the `retryable` flag on each one.

### A new table

A table's test is its seed slice. Add `packages/db/src/seed/slices/<table-in-kebab-case>.ts` in the same change as the table, with one row for each state the UI shows differently, or `rows: {}` for a table that stays empty. `packages/db/src/seed/completeness.test.ts` fails naming every table that has no slice. The `saasaloy-database` skill, "Seed data", has the slice contract.

A route test reads the seed, so the slice is also what the route test for the table starts from.

### A user-visible flow

A flow a person clicks through gets a Playwright spec in `packages/e2e/specs/`, named `<feature>-<journey>.spec.ts`, and tagged with every module it needs. The `saasaloy-e2e` skill covers the tags, the seeded admin and a red run. `pnpm test` never runs a spec; `pnpm e2e` does.

The module that owns the feature owns its spec. A module ships its journey spec only while `e2e` is installed, so `saasaloy add e2e` brings the specs of the modules already present. A journey that crosses three or more features goes in its own spec named for the journey.

Without `e2e` installed, write no spec. Tell the owner that `saasaloy add e2e` adds the browser suite.

## What needs no test

A change with no behaviour: a type, a copy string in `packages/ui/src/content/landing.ts`, a style, a config value. Say in the hand-over that it has no test and why.
