---
name: saasaloy-feature
description: Build one product entity end to end across the stack, in order, from the Drizzle table to the customer screens, the admin list and the route test, taking its fields, access rule, actions and screens from docs/product-spec.md, then prove it with pnpm check. Use when the owner says "add projects", "build the books feature", "add an entity", "make a CRUD for X", when the app's home still shows the empty state that points here, and when saasaloy-build reaches its feature stage.
---

# saasaloy-feature — one entity, every layer, one gate

A product feature in this project crosses seven workspaces. Each layer has a skill that owns its detail, and this skill owns only the order and the hand-offs between them. Follow the order: each step reads what the step before it wrote, so a route written before its validator, or a screen written before its client, gets written twice.

The examples use a `books` entity with the word `book`. Put your entity's plural in place of `books` and its singular in place of `book`.

## Before you start

1. **Read the entity from the spec.** Open `docs/product-spec.md` and find the entity's `### <n>. <Entity name>` section under `## Entities`. Its table has five rows, fixed by `.agents/skills/saasaloy-setup/product-spec-template.md`: `Table`, `Fields`, `Who may see it`, `Actions` and `Screens`. [Read the spec](#read-the-spec) says how each row becomes code. Build what the rows say, and nothing more. The owner approved these screens at the interview's read-back, so do not add, drop or rename one. With no spec, take the entity from `docs/product-brief.md`: the one thing the product's user makes, tracks or reads, and give it a `text` title, the four screens, and the actions `list`, `create` and `update`. The table name is plural snake_case (`books`, `reading_sessions`), and the Drizzle export key is the camelCase plural (`books`, `readingSessions`).
2. **Check the modules.** Run `saasaloy list --installed --json`. The steps below need `database` with a driver, `validators`, `api`, `auth` and `app`. `admin` is optional: skip step 9 without it. `saasaloy-build` also adds `agent` with `api-keys` and `api-keys-user`, and then every action follows [the four parts an agent needs](#the-four-parts-an-agent-needs). Add a missing module with `saasaloy add <module> --yes`.
3. **Check the testing mode.** Read the `<!-- saasaloy:testing -->` block in `AGENTS.md`. With `off`, write no test file and skip step 10, unless the owner asked for tests. With `tests-after`, write the tests after the code. With `tdd`, write the route test of step 10 before the route of step 6, and watch it fail.
4. **Decide who owns a row**, from the spec's `Who may see it` row. Every table gets a `user_id` column that references `users.id`, the user who made the row. `the owner` scopes every query by the session's user. `every signed-in user reads, the owner writes` lets `list` and the detail read every row, and scopes `update` and each domain verb by the session's user. `the organization` scopes by the active organization, which needs `multitenant`: `saasaloy-multitenant` says how.

## Read the spec

Each row of the entity's table in the spec becomes one part of the code.

### `Fields` becomes the columns, the validator and the form controls

Each field is `` `name` type ``, with `required` when a row cannot exist without it. The name is the column's snake_case name and the camelCase key. A `required` field is `.notNull()` in the table and required in the validator; any other field is nullable and optional. Map each type with this table:

| Spec type | Column | Validator | Form control (`@repo/ui/components/shell/*`) | List cell |
|-----------|--------|-----------|------------------------------------|-----------|
| `text` | text | string, trimmed, not empty when required | `Input` from `input` | the value |
| `long text` | text | string | `Textarea` from `textarea` | leave it out of the list; show it in the detail |
| `number` | integer | integer | `Input` with `type="number"` | the value, `align: "end"` |
| `decimal` | numeric | number | `Input` with `type="number"` and a `step` | the value, `align: "end"` |
| `money` | integer, the smallest currency unit | integer, not below 0 | `Input` with `type="number"`, shown in the main unit | the amount in the brief's currency, `align: "end"` |
| `date` | text `YYYY-MM-DD` | date string | `DatePicker` from `date-picker` | a `Date` |
| `datetime` | a timestamp | date-time string | `DateTimePicker` from `date-picker` | a `Date` |
| `yes/no` | boolean | boolean | `Switch` from `switch` | `Yes` or `No` |
| `one of a, b, c` | text, with the values as a TypeScript union | an enum of the values | `Select` from `select` | `StatusPill` from `status-pill` |
| `link to <table>` | `<singular>_id`, a foreign key to that table, with an index | the id | `Select` of the owner's rows of that table | the linked row's title |

The driver skill, `saasaloy-database-postgres`, names the Drizzle helper for each column kind. Keep the column order of `saasaloy-database`.

### `Actions` becomes the routes

| Action | Route | Repository function |
|--------|-------|---------------------|
| `list` | `GET /books` | `listBooks(db, scope)` |
| `create` | `POST /books` | `createBook(db, scope, input)` |
| `update` | `PATCH /books/:id` | `updateBook(db, scope, id, input)` |
| a domain verb, such as `finish` | `POST /books/:id/finish` | `finishBook(db, scope, id)` |
| `delete`, when the spec names it | `DELETE /books/:id` | `deleteBook(db, scope, id)` |

A domain verb changes the row's state, usually a `one of` field, and answers `409` when the row is in a state the verb cannot leave. Build only the actions the row names.

### Every action is callable by agents

With `agent` installed, each action of the entity is callable through the product's MCP server, and each one has its own scope word, written `resource:action` with the table name as the resource:

| Action | Scope | Statement |
|--------|-------|-----------|
| `list`, and a read of one row | `books:read` | `readOnly: true`, `confirm: false` |
| `create`, `update` and each domain verb | `books:write` | `readOnly: false`, `confirm: false`; `confirm: true` for a verb that moves money |
| `delete` | `books:delete`, its own word | `readOnly: false`, `confirm: true` |

### `Screens` becomes the `app` screens and the `admin` list

Build each screen from the `shell` parts the spec names, and from nothing new:

| Spec part | Import | Where |
|-----------|--------|-------|
| `data-table` | `DataTable` and the type `DataTableColumn` from `@repo/ui/blocks/shell/data-table` | the app list and the admin list |
| `detail-panel` | `DetailPanel` from `@repo/ui/blocks/shell/detail-panel`, inside `PageLayout`'s `detail` from `@repo/ui/containers/shell/page-layout` | the app detail, opened by a row click |
| `form` | `Form` from `@repo/ui/components/shell/form` | the create and update form, in a `Dialog` from `@repo/ui/components/shell/dialog` |
| `field` | `Field`, `FieldLabel`, `FieldDescription` and `FieldError` from `@repo/ui/components/shell/field` | one `Field` for each spec field in the form |

- **The list.** One `DataTable` column for each field the [type table](#fields-becomes-the-columns-the-validator-and-the-form-controls) shows in the list, in the spec's order. The first `text` field is `card: "title"` and `grow: true`. A `one of` field is `card: "trailing"`. `rowId` is the row's id. `PageHeader` from `@repo/ui/blocks/shell/page-header` holds the title, the count and a New button that opens the create form. `EmptyState` from `@repo/ui/blocks/shell/empty-state` fills `emptyState`.
- **The detail.** `DetailPanel` takes the row's title as `title`, each field as an `attributes` item, the `update` action as an Edit button and each domain verb as a button in `footer`. A verb named `delete` asks first with `AlertDialog` from `@repo/ui/components/shell/alert-dialog`.
- **The form.** One `Form` serves create and update. Each field is a `Field` with a `FieldLabel`, its control from the type table, and a `FieldError`, in the spec's order. The validator of step 5 checks the input, so the form and the route reject the same input. Report each result with `toastManager` from `@repo/ui/components/shell/toast`.
- **The admin list.** A read-only `DataTable` of every row, with the owner's email as one column. No form and no verb.

`apps/admin/src/routes/users.tsx` and `apps/admin/src/routes/members.tsx` compose these parts already: read one before the first screen. `saasaloy-shell`, "The primitive set and the page blocks" and "Build a page", has each prop. Signed-in app code imports `@repo/ui/components/shell/*`, never a base `@repo/ui/components/*` primitive: `pnpm lint` fails on one.

## The four parts an agent needs

With `agent` installed, write these four parts for each action, in the same change as the action. `saasaloy-agent`, "Make an entity callable: the four parts", has the statement, the gate for each `Who may see it` rule, and an example. Read it before step 6; do not copy it here.

1. **The screen**, from step 8, so a person can do what an agent does.
2. **The route with its agent statement.** `declare({...})` first after the path, `callable: true`, with `output`, `readOnly`, `confirm` and the `scope` from [the scope table](#every-action-is-callable-by-agents). The gate demands the same pair: `requireUser(c, { books: ["write"] })` for `scope: "books:write"`.
3. **The scope words in the key vocabulary.** Add the entity's words to `API_KEY_SCOPES` in `packages/auth/src/api-key-scopes.ts`: `books: ["read", "write", "delete"]`, with `delete` only when the spec names it. A form that issues keys selects the read and write scopes and leaves each delete scope off until the user ticks it.
4. **The entry in the agent documents.** `/openapi.json`, the api's `/llms.txt` and the MCP tool list are built from the statement, so there is nothing to write by hand. After the gate, read the api's `/llms.txt` and check that each action's tool line names its scope.

Without `agent`, a route still carries a statement, closed or callable, as `saasaloy-api` says.

## The steps

| # | Layer | What you write | The skill with the detail |
|---|-------|----------------|---------------------------|
| 1 | Table | `packages/db/src/schema/books.ts` and `packages/db/src/column-classes/books.ts` | `saasaloy-database`, "Add a table", "Column order", "Table names", "Column classes" |
| 2 | Migration | `db:generate`, then apply it | `saasaloy-database`, "Migrations"; the driver skill for the apply command |
| 3 | Seed slice | `packages/db/src/seed/slices/books.ts` | `saasaloy-database`, "Seed data" |
| 4 | Repository | `packages/db/src/repositories/books.ts` | `saasaloy-database`, "The repository layer" |
| 5 | Validator | `packages/validators/src/books.ts` | `saasaloy-validators`, "Where a schema lives" |
| 6 | Route | `apps/api/src/routes/books.ts` with a statement on each route, mounted in the route chain, and the scope words in `API_KEY_SCOPES` | `saasaloy-api`, "Add a route", "Errors"; `saasaloy-agent`, "Make an entity callable: the four parts" |
| 7 | `hc` client | the typed call from `apps/app/src/lib/api.ts` | `saasaloy-api`, "The typed client"; `saasaloy-app`, "Call the api" |
| 8 | `app` screens | the list, the detail and the form in `apps/app/src/routes/` | `saasaloy-app`, "Add a screen", "Protect a screen"; `saasaloy-shell`, "Build a page" |
| 9 | `admin` list | a read-only list in `apps/admin/src/routes/` | `saasaloy-admin`, "Add a screen" |
| 10 | Route test | `apps/api/src/routes/books.test.ts` | `saasaloy-testing`, "A route test" |
| 11 | Gate | `pnpm lint:fix`, `pnpm format`, `pnpm check` | this skill, [The gate](#the-gate) |

### 1. Table

One file, one table, no edit anywhere else: the schema barrel and drizzle-kit both glob `src/schema/*.ts`. Write one column for each spec field, mapped by the [type table](#fields-becomes-the-columns-the-validator-and-the-form-controls). Keep the column order the database skill gives. Add an index on every foreign key, named after its table (`books_user_id_idx`). Classify every column in `packages/db/src/column-classes/books.ts`: `column-classes.test.ts` fails on a table with no class file.

### 2. Migration

Run `pnpm --filter @repo/db db:generate`. Read the generated SQL before you apply it: it must create the new table and touch no other table. Then apply it locally: `pnpm --filter @repo/db db:migrate`.

### 3. Seed slice

One row for each state the screen shows differently, keyed by slug. Point the rows at the seed users with `seedId("users", "<slug>")`, so a signed-in seed user sees rows on the first load. Run `pnpm db:seed` twice. The two runs must print the same counts.

### 4. Repository

Thin functions that take the `db` and the scope and return rows, one for each action the spec names: `listBooks(db, userId)`, `createBook(db, userId, input)`. Every function filters by the scope that `Who may see it` gives. A function that reads by id alone leaks another user's row.

### 5. Validator

The request body schema for create and update, in `@repo/validators`, never inline in the route. The route and the `hc` client both import it, so the screen's form and the route check the same rules. A table is not a request schema: leave out `id`, `user_id` and the timestamps.

### 6. Route

A Hono route for each action the spec names, as [the actions table](#actions-becomes-the-routes) maps them. Each one opens with its statement, reads the caller, answers `401` with none, validates the body with the schema from step 5, and calls the repository from step 4. With `agent`, the caller gate is `requireUser` with the action's scope, which lets a person's session and a user's key in, and the statement is callable with that scope: see [the four parts an agent needs](#the-four-parts-an-agent-needs). Add the scope words to `API_KEY_SCOPES` in the same step. Return the one error envelope the api skill describes. Mount it in the route chain so its type reaches the `hc` client.

### 7. `hc` client

Call the route through the typed client, never through `fetch` with a hand-written URL. Run `pnpm typecheck` here: a wrong path or body shape fails now, not in the browser.

### 8. `app` screens

The list, the detail and the form that [the screens table](#screens-becomes-the-app-screens-and-the-admin-list) describes, inside the shell, behind the session guard. Add the list to the app's nav. Words go in `packages/ui/src/content/`, never in the component. Replace the home's empty state, which points at this skill, with a link to the first entity's list; later entities only add a nav entry.

### 9. `admin` list

A read-only list of every row, for staff, built from `DataTable`. It calls an admin route that checks the admin role, not the customer route from step 6.

### 10. Route test

Copy the shape of `apps/api/src/routes/auth.test.ts`. Cover the four cases `saasaloy-testing` names for each action: success, `401` with no session, `403` or `404` for another user's row, and `400` for a bad body. A domain verb also gets its `409` case.

## The gate

Run, in order and from the project root:

```sh
pnpm lint:fix
pnpm format
pnpm check
```

`pnpm check` runs `typecheck`, `lint`, `test` and `build`, and stops at the first failure. The feature is done when it passes. Then start `pnpm dev`, sign in at `http://localhost:3002/sign-in` as a seed user, open the new screen, and read the dev server's terminal for errors. With `agent`, also read the api's `/llms.txt` and find one tool line for each action. Stop the dev server when you are done.

## Unattended run

When `docs/product-brief.md` has `autonomy: afk` in its frontmatter, ask nothing. `saasaloy-build` names the entity from the spec. With no spec, pick the entity from the brief yourself, and write your pick and the reason in `docs/build-log.md`. A spec row that cannot be built as written, such as a `link to` a table no entity makes, goes under `## Blocked` with the entity and the row. A new table, a migration and a new dependency are allowed without asking in this mode; `AGENTS.md` "Unattended work" has the full list. When a step fails and you cannot fix it, write the step and the error under `## Blocked` in the log and stop.

## Failure modes

- **`db:generate` reports no changes.** The schema file is not in `packages/db/src/schema/`, or it sits in a subfolder. The folder is flat.
- **Every call to the route answers `404`.** The route is not mounted in the chain, or it is mounted under another path. Compare with a route the `auth` module ships.
- **`hc` shows the route as `unknown`.** The route was mounted with a separate `app.route()` call, outside the chain whose type the client reads.
- **The screen shows no rows for a signed-in seed user.** The seed slice points at another user, or the repository filters by the wrong id.
- **`completeness.test.ts` fails naming the table.** The table has no seed slice. Add one, or `rows: {}` for a table that stays empty.
- **The browser blocks the request with CORS.** See `saasaloy-app`, "Failure modes".
- **`pnpm lint` fails on an import of `@repo/ui/components/<name>`.** A base primitive slipped into app code. Import the `@repo/ui/components/shell/<name>` twin.
- **`column-classes.test.ts` fails naming the table.** The table has no class file, or a column has no class. Add `packages/db/src/column-classes/<table>.ts`.

## Next

Run `saasaloy-e2e` to cover the flow in a browser when `e2e` is installed, or `saasaloy-build` to continue an unattended build.
