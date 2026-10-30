---
name: saasaloy-feature
description: Build one product entity end to end across the stack, in order, from the Drizzle table to the customer screen, the admin list and the route test, then prove it with pnpm check. Use when the owner says "add projects", "build the books feature", "add an entity", "make a CRUD for X", when the app's home still shows the empty state that points here, and when saasaloy-build reaches its feature stage.
---

# saasaloy-feature — one entity, every layer, one gate

A product feature in this project crosses seven workspaces. Each layer has a skill that owns its detail, and this skill owns only the order and the hand-offs between them. Follow the order: each step reads what the step before it wrote, so a route written before its validator, or a screen written before its client, gets written twice.

The examples use a `books` entity with the word `book`. Put your entity's plural in place of `books` and its singular in place of `book`.

## Before you start

1. **Name the entity.** Take it from `docs/product-brief.md`: the one thing the product's user makes, tracks or reads. Pick one. The table name is plural snake_case (`books`, `reading_sessions`), and the Drizzle export key is the camelCase plural (`books`, `readingSessions`).
2. **Check the modules.** Run `saasaloy list --installed --json`. The steps below need `database` with a driver, `validators`, `api`, `auth` and `app`. `admin` is optional: skip step 9 without it. Add a missing module with `saasaloy add <module> --yes`.
3. **Check the testing mode.** Read the `<!-- saasaloy:testing -->` block in `AGENTS.md`. With `off`, write no test file and skip step 10, unless the owner asked for tests. With `tests-after`, write the tests after the code. With `tdd`, write the route test of step 10 before the route of step 6, and watch it fail.
4. **Decide who owns a row.** Most entities belong to one user: give the table a `user_id` column that references `users.id`, and scope every query by the session's user. With `multitenant` installed, scope by the active organization instead. `saasaloy-multitenant` says how.

## The steps

| # | Layer | What you write | The skill with the detail |
|---|-------|----------------|---------------------------|
| 1 | Table | `packages/db/src/schema/books.ts` | `saasaloy-database`, "Add a table", "Column order", "Table names" |
| 2 | Migration | `db:generate`, then apply it | `saasaloy-database`, "Migrations"; the driver skill for the apply command |
| 3 | Seed slice | `packages/db/src/seed/slices/books.ts` | `saasaloy-database`, "Seed data" |
| 4 | Repository | `packages/db/src/repositories/books.ts` | `saasaloy-database`, "The repository layer" |
| 5 | Validator | `packages/validators/src/books.ts` | `saasaloy-validators`, "Where a schema lives" |
| 6 | Route | `apps/api/src/routes/books.ts`, mounted in the route chain | `saasaloy-api`, "Add a route", "Errors" |
| 7 | `hc` client | the typed call from `apps/app/src/lib/api.ts` | `saasaloy-api`, "The typed client"; `saasaloy-app`, "Call the api" |
| 8 | `app` screen | a list and a form in `apps/app/src/routes/` | `saasaloy-app`, "Add a screen", "Protect a screen" |
| 9 | `admin` list | a read-only list in `apps/admin/src/routes/` | `saasaloy-admin`, "Add a screen" |
| 10 | Route test | `apps/api/src/routes/books.test.ts` | `saasaloy-testing`, "A route test" |
| 11 | Gate | `pnpm lint:fix`, `pnpm format`, `pnpm check` | this skill, [The gate](#the-gate) |

### 1. Table

One file, one table, no edit anywhere else: the schema barrel and drizzle-kit both glob `src/schema/*.ts`. Keep the column order the database skill gives. Add an index on every foreign key, named after its table (`books_user_id_idx`).

### 2. Migration

Run `pnpm --filter @repo/db db:generate`. Read the generated SQL before you apply it: it must create the new table and touch no other table. Then apply it locally with the driver's command: `pnpm --filter @repo/db db:migrate:local` on D1. On Postgres, `saasaloy-database-postgres` names it.

### 3. Seed slice

One row for each state the screen shows differently, keyed by slug. Point the rows at the seed users with `seedId("users", "<slug>")`, so a signed-in seed user sees rows on the first load. Run `pnpm db:seed` twice. The two runs must print the same counts.

### 4. Repository

Thin functions that take the `db` and the owner's id and return rows: `listBooks(db, userId)`, `createBook(db, userId, input)`. Every function filters by the owner. A function that reads by id alone leaks another user's row.

### 5. Validator

The request body schema for create and update, in `@repo/validators`, never inline in the route. The route and the `hc` client both import it, so the screen's form and the route check the same rules. A table is not a request schema: leave out `id`, `user_id` and the timestamps.

### 6. Route

A Hono route that reads the session, answers `401` with none, validates the body with the schema from step 5, and calls the repository from step 4. Return the one error envelope the api skill describes. Mount it in the route chain so its type reaches the `hc` client.

### 7. `hc` client

Call the route through the typed client, never through `fetch` with a hand-written URL. Run `pnpm typecheck` here: a wrong path or body shape fails now, not in the browser.

### 8. `app` screen

A list screen and a create form, inside the shell, behind the session guard. Add the screen to the app's nav. Words go in `packages/ui/src/content/`, never in the component. Replace the home's empty state, which points at this skill, with a link to the new screen.

### 9. `admin` list

A read-only list of every row, for staff. It uses the shell's data table block. It calls an admin route that checks the admin role, not the customer route from step 6.

### 10. Route test

Copy the shape of `apps/api/src/routes/auth.test.ts`. Cover the four cases `saasaloy-testing` names: success, `401` with no session, `403` or `404` for another user's row, and `400` for a bad body.

## The gate

Run, in order and from the project root:

```sh
pnpm lint:fix
pnpm format
pnpm check
```

`pnpm check` runs `typecheck`, `lint`, `test` and `build`, and stops at the first failure. The feature is done when it passes. Then start `pnpm dev`, sign in at `http://localhost:3002/sign-in` as a seed user, open the new screen, and read the dev server's terminal for errors. Stop the dev server when you are done.

## Unattended run

When `docs/product-brief.md` has `autonomy: afk` in its frontmatter, ask nothing. Pick the entity from the brief yourself, and write your pick and the reason in `docs/build-log.md`. A new table, a migration and a new dependency are allowed without asking in this mode; `AGENTS.md` "Unattended work" has the full list. When a step fails and you cannot fix it, write the step and the error under `## Blocked` in the log and stop.

## Failure modes

- **`db:generate` reports no changes.** The schema file is not in `packages/db/src/schema/`, or it sits in a subfolder. The folder is flat.
- **Every call to the route answers `404`.** The route is not mounted in the chain, or it is mounted under another path. Compare with a route the `auth` module ships.
- **`hc` shows the route as `unknown`.** The route was mounted with a separate `app.route()` call, outside the chain whose type the client reads.
- **The screen shows no rows for a signed-in seed user.** The seed slice points at another user, or the repository filters by the wrong id.
- **`completeness.test.ts` fails naming the table.** The table has no seed slice. Add one, or `rows: {}` for a table that stays empty.
- **The browser blocks the request with CORS.** See `saasaloy-app`, "Failure modes".

## Next

Run `saasaloy-e2e` to cover the flow in a browser when `e2e` is installed, or `saasaloy-build` to continue an unattended build.
