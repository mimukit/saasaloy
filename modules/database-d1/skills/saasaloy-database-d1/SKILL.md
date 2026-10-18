---
name: saasaloy-database-d1
description: Runbook for the database-d1 driver — Cloudflare D1 (SQLite at the edge) behind packages/db. Use when reading the DB from a route (withDb(c, …)), wiring or fixing the d1_databases binding, removing the old "local" placeholder database_id, applying migrations with db:migrate:local and db:migrate:prod, preparing, reporting on and dropping the local database with db:setup, db:status and db:drop, seeding it with db:seed, or writing route tests against a local test database with testDatabase(). The tables, the repositories and db:generate belong to the core skill, saasaloy-database.
---

# database-d1 — the Cloudflare D1 driver

`database-d1` is the **driver** half of the data layer. The `database` core owns the tables, the
schema barrel, the repository layer and `db:generate`; this module owns everything that knows the
database is [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge).

It installs six things:

| What                            | Where it lands                             |
| ------------------------------- | ------------------------------------------ |
| the D1 client (`getDb`)         | `packages/db/src/client.ts`                 |
| the `sqlite` drizzle-kit config | `packages/db/drizzle.config.ts`             |
| the `d1_databases` binding      | `apps/api/wrangler.jsonc` (patch)           |
| `db:migrate:local` / `:prod`    | `packages/db/package.json` scripts (patch)  |
| the lifecycle wrappers          | `packages/db/scripts/`                      |
| `db:setup` / `db:status` / `db:drop` | `packages/db/package.json` + root `package.json` |

It also rewrites `packages/db/tsconfig.json` to put `@cloudflare/workers-types` back in
`compilerOptions.types`, and patches `wrangler`, `@cloudflare/workers-types` and `@types/node` into
that workspace's `devDependencies`. `D1Database` is a Workers global, so the core cannot carry that
type without forcing Workers types on a project that runs Postgres.

Read `saasaloy-database` first for how to add a table or write a repository. Nothing below changes
those steps.

## Read the DB from a route: `withDb(c, …)`

The D1 binding arrives on the Worker's `env`, threaded through Hono as `c.env.DB`. Compose
`DbBindings` into the route's Hono generic so it's typed with no patch to api's entry, then wrap
the handler's body in `withDb`:

```ts
// apps/api/src/routes/waitlist.ts
import { Hono } from "hono";
import { withDb, type DbBindings } from "@repo/db/client";
import { listWaitlist } from "@repo/db/repositories/waitlist";

const waitlist = new Hono<{ Bindings: DbBindings }>();

waitlist.get("/", (c) => withDb(c, async (db) => c.json(await listWaitlist(db))));

export default waitlist;
```

`getDb(c.env)` reads the binding off `env` and wraps it in a Drizzle instance carrying the whole
schema barrel, so `db.query.<table>` and relational queries work. `DbBindings` is
`{ DB: D1Database }`.

**`withDb` does nothing extra on D1, and that is the point.** A D1 binding is a stub the runtime
owns, so there is no connection to open and nothing to close; this driver's `withDb` calls `getDb`
and runs your callback. `database-postgres` exports the same four names — `getDb`, `Db`,
`DbRequestContext`, `withDb` — with the same signatures, and there the wrapper opens a real socket
per request and closes it on `c.executionCtx.waitUntil`. One route body is therefore correct under
both drivers, which is what lets a feature module like `waitlist` ship one route file instead of
two. Read the db through bare `getDb` instead and the route leaks a socket the day the project
switches driver.

Reach for `getDb(c.env)` directly only where there is no request context to hand over — a scheduled
handler, a script.

Never reach for `process.env` — it doesn't exist on Workers. Bindings live on the runtime, and
`c.env` is the only way to them.

## Tables are SQLite

D1 is SQLite, so table files import from `drizzle-orm/sqlite-core`:

```ts
// packages/db/src/schema/waitlist.ts
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const waitlistEntries = sqliteTable("waitlist_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

`drizzle.config.ts` sets `dialect: "sqlite"` to match. That pairing is the reason the config lives
here and not in the core: a schema written against `sqlite-core` does not port to Postgres by
itself.

## The `d1_databases` binding and the placeholder id

`add database-d1` patches `apps/api/wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "app-db",
    "migrations_dir": "../../packages/db/migrations"
  }
]
```

`binding: "DB"` is the name that shows up as `c.env.DB`. `migrations_dir` points wrangler at the
SQL the core's `db:generate` emits.

**There is no `database_id`, and you do not need one.** Local dev serves from a miniflare SQLite
file under `apps/api/.wrangler/state`, keyed by the binding, so a fresh clone runs with no
Cloudflare account at all. In production the database is found by its `database_name`:
`db:migrate:prod` creates it on the first deploy when the account has none by that name, and
`wrangler deploy` then connects the binding to it. A later deploy reuses the same database.

A project made before this change carries `"database_id": "local"`. Delete that line, or replace
it with the real id from `wrangler d1 info app-db`. Wrangler sends any id it finds, so `"local"`
breaks every remote command. A real id is not a secret; commit it if you add one.

## Applying migrations

The core generates the SQL; this driver applies it. Both migrate commands run
`wrangler d1 migrations apply DB` against the binding above, reached with `--config`:

```sh
pnpm --filter @repo/db db:generate       # core: diff schema → emit SQL under migrations/
pnpm --filter @repo/db db:migrate:local  # apply pending migrations to LOCAL D1
pnpm --filter @repo/db db:migrate:prod   # apply pending migrations to REMOTE (production) D1
```

`db:migrate:local` also passes `--persist-to ../../apps/api/.wrangler/state`, so the migrated
SQLite is the same file `vite dev` serves from. Without it wrangler would migrate a different
local database than the one your app reads.

`db:migrate:prod` runs `node scripts/migrate-prod.ts` through `env-deploy --run deploy`, so it
gets the Cloudflare credentials from the value source, the same ones `pnpm deploy:production`
uses. The script creates the database when the account has none by that name, then applies the
pending migrations. `pnpm deploy:production` runs it for you before the api Worker uploads,
because the base `turbo.json` makes `deploy` depend on `^db:migrate:prod`. There is no
`drizzle-kit push` and no auto-migrate on boot.

## The lifecycle commands: `db:setup`, `db:status`, `db:drop`

Three commands prepare, report on and throw away the local database. They run from the repo root:

```sh
pnpm db:setup    # apply every pending migration to the local D1 database
pnpm db:status   # what wrangler says is applied and what is pending
pnpm db:drop     # delete apps/api/.wrangler/state/v3/d1
```

On this driver all three are thin wrappers over wrangler, and that is deliberate. D1's local
database is a SQLite file under `apps/api/.wrangler/state`, which `.gitignore` covers, so it is
already one database per worktree. There is nothing to create, no server to reach, no backend to
choose and no state block to keep — all of which the Postgres driver needs and ships. `db:setup` on
this driver is `db:migrate:local` under another name, so that a project reads the same three
commands whichever driver is under it.

`db:status` exits `0` normally and `1` only when wrangler cannot read the database. Pending
migrations are a report, not a failure.

`db:drop` deletes `apps/api/.wrangler/state/v3/d1` and nothing else. It never touches the remote
database: `wrangler d1 delete` is a separate command this script does not run. The path is
wrangler's own layout, so `scripts/drop.ts` checks that the directory exists and resolves under the
project root before `rimraf` sees it. A wrangler upgrade that moves the path turns `db:drop` into a
no-op that says so, rather than a delete somewhere else. If that happens, look under
`apps/api/.wrangler/state` and update the path in `scripts/drop.ts`.

## Seed data: `db:seed`

`pnpm db:seed` fills the local D1 database with the rows in `packages/db/src/seed/slices/`, one file per table. The slice contract (slugs, `seedId`, the conflict key) is in the `saasaloy-database` skill, "Seed data". This section is what the D1 runner does with it.

```sh
pnpm db:setup   # apply every migration; it never writes rows
pnpm db:seed    # upsert every slice row, print a count per table
```

The runner opens the same local database `vite dev` and `db:migrate:local` use, through wrangler's `getPlatformProxy` with `apps/api/wrangler.jsonc`, `persist.path` set to `apps/api/.wrangler/state/v3`, and `remoteBindings: false`. It sends the whole seed as one `db.batch`, which D1 runs atomically. A rerun prints the same counts and resets each seed row to its slice values; rows you made by hand stay. To drop rows a slice no longer has, run `pnpm db:drop`, `pnpm db:setup`, then `pnpm db:seed`.

The guard runs before anything opens: `--remote` is refused, any other flag is refused, and so is `NODE_ENV=production`. There is no way to seed a remote D1 database with this command, on purpose.

**Beside a running api.** Local D1 runs in WAL mode, so `db:seed` works while `pnpm dev` serves the api and no request is in flight. A request that writes at the same moment makes the batch fail with `SQLITE_BUSY`, and nothing is written. The runner sends the batch again up to three times, waiting 250 ms, 500 ms and 1 s, then exits `1` asking you to stop the api or run the command again.

## Route tests

The api's tests run in Node with Vitest, against a local D1 of their own. `pnpm test` from the repo root runs them.

```ts
// apps/api/src/routes/projects.test.ts
import { describe, expect, it } from "vitest";
import { testDatabase } from "@repo/db/testing";
import app from "../index";

const database = testDatabase();

describe("GET /projects", () => {
  it("lists the seeded projects", async () => {
    const res = await app.request("/projects", {}, database.env);
    expect(res.status).toBe(200);
  });
});
```

The test file is the same one you would write on Postgres; only the harness behind `@repo/db/testing` differs. `auth` ships a worked example at `apps/api/src/routes/auth.test.ts`.

How it fits together:

- **Global setup.** `apps/api/test/setup/database.ts` re-exports `setup` from `packages/db/scripts/test-setup.ts`, and the api's `vitest.config.ts` runs every file in that folder once per run. It deletes `apps/api/.wrangler/test-state`, opens a fresh local D1 there, applies every migration with Drizzle's D1 migrator and runs the seed. That database is a template; the development one in `apps/api/.wrangler/state` is never opened.
- **One copy per test file.** `testDatabase()` copies the template to a temporary folder and opens its own local D1 on it with `getPlatformProxy`, so test files running in parallel never share a database. The copy is deleted when the file ends.
- **Reset before every test.** D1 has no transaction a test could hold open and roll back. So before each test the copy is emptied, children first, and the seed is written again, in one batch. Every test starts from the seed and sees nothing an earlier test wrote. `database.env` carries the copy as `DB`; `database.db` is a Drizzle client on it.

Read `database.env` and `database.db` inside a test, never at module scope: the database opens in a `beforeAll` hook.

`apps/api` does not depend on `drizzle-orm`, so a test file cannot import `eq` or another operator from it. Import the table from `@repo/db/schema/<file>` and a seed row's id from `@repo/db/seed/id` (`seedId("users", "superadmin")`), select the rows with `database.db.select().from(table)` and filter them in the test. Or put the query in a repository under `packages/db/src/repositories/` and import that.

## Switching drivers

`database-d1` and `database-postgres` declare each other in `conflictsWith`, so `add` refuses the
second one instead of letting two clients fight over `src/client.ts`. To switch:

```sh
saasaloy remove database-d1
saasaloy add database-postgres
```

`remove` deletes the two files this module owns, `src/client.ts` and `drizzle.config.ts`. It also
deletes `packages/db/tsconfig.json`, which is **not** this module's file: the core `database`
scaffolds it too, `add database-d1` overwrote the core's copy, and `remove` now takes the whole
file away without restoring the core's version.

So run the two commands back to back. In between them `packages/db` has no `tsconfig.json` at all,
and `pnpm typecheck` fails at `@repo/db` with tsc printing its option help instead. Adding the
other driver writes the file again and the failure clears. If you need to stop after `remove`,
put the core's copy back by hand:

```json
// packages/db/tsconfig.json
{
  "extends": "@repo/tsconfig/base.json",
  "compilerOptions": {
    "types": ["vite/client"]
  },
  "include": ["src", "drizzle.config.ts"]
}
```

`remove` takes the `d1_databases` block back out of `apps/api/wrangler.jsonc`, unless you edited the
binding, in which case it says so and leaves it. It warns about the leftovers it cannot reverse: the
two `db:migrate:*` scripts, the three `db:setup` / `db:status` / `db:drop` scripts in both
`packages/db/package.json` and the root `package.json`, plus the `wrangler` devDependency. Delete
those by hand. Your `src/schema/*.ts` files stay put and are still SQLite — port them to `pg-core`
yourself.

**A driver switch takes the dependent feature modules with it.** `auth` and `waitlist` pick their
schema variant at install time, and the unchosen one is filtered before the plan is built, so
neither notices that the driver under it changed. Remove and add each of them too:

```sh
saasaloy remove waitlist
saasaloy remove auth
saasaloy remove database-d1
saasaloy add database-postgres
saasaloy add auth
saasaloy add waitlist
```

There is no data migration in either direction; see ADR 0026.

## Boundaries to honor

- **`c.env` for the binding, never `process.env`.** Read it through `withDb(c, …)`, the call shape
  both drivers share, and keep bare `getDb(env)` for code holding no request context.
- **Tables import `drizzle-orm/sqlite-core`**, matching `dialect: "sqlite"` in `drizzle.config.ts`.
  Never hand-edit that config.
- **Leave `database_id` out.** The database is found by `database_name`, locally and remotely.
  Local dev needs no Cloudflare account.
- **Migrations are manual** — generate, review, then apply local or prod explicitly.
- **`db:seed` is local only.** It refuses `--remote` and `NODE_ENV=production`.
- **Route tests use `testDatabase()`**, which works on a copy. Never point a test at `apps/api/.wrangler/state`.
- **Keep migrations backward compatible.** `pnpm deploy:production` applies them before the new
  api Worker uploads, and the old Worker serves requests in between. A migration the old code
  cannot read is an outage until the upload finishes, and a failed upload leaves it that way.
- **One driver per project.** Adding `database-postgres` beside this one is refused, by design.
