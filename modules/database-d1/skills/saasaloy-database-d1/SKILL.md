---
name: saasaloy-database-d1
description: Runbook for the database-d1 driver — Cloudflare D1 (SQLite at the edge) behind packages/db. Use when reading the DB from a route (c.env.DB), wiring or fixing the d1_databases binding, replacing the placeholder database_id with a real one, or applying migrations with db:migrate:local and db:migrate:prod. The tables, the repositories and db:generate belong to the core skill, saasaloy-database.
---

# database-d1 — the Cloudflare D1 driver

`database-d1` is the **driver** half of the data layer. The `database` core owns the tables, the
schema barrel, the repository layer and `db:generate`; this module owns everything that knows the
database is [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge).

It installs four things:

| What                            | Where it lands                             |
| ------------------------------- | ------------------------------------------ |
| the D1 client (`getDb`)         | `packages/db/src/client.ts`                 |
| the `sqlite` drizzle-kit config | `packages/db/drizzle.config.ts`             |
| the `d1_databases` binding      | `apps/api/wrangler.jsonc` (patch)           |
| `db:migrate:local` / `:prod`    | `packages/db/package.json` scripts (patch)  |

It also rewrites `packages/db/tsconfig.json` to put `@cloudflare/workers-types` back in
`compilerOptions.types`, and patches `wrangler` and `@cloudflare/workers-types` into that
workspace's `devDependencies`. `D1Database` is a Workers global, so the core cannot carry that type
without forcing Workers types on a project that runs Postgres.

Read `saasaloy-database` first for how to add a table or write a repository. Nothing below changes
those steps.

## Read the DB from a route: `c.env.DB`, never `process.env`

The D1 binding arrives on the Worker's `env`, threaded through Hono as `c.env.DB`. Compose
`DbBindings` into the route's Hono generic so it's typed with no patch to api's entry:

```ts
// apps/api/src/routes/waitlist.ts
import { Hono } from "hono";
import { getDb, type DbBindings } from "@repo/db/client";
import { listWaitlist } from "@repo/db/repositories/waitlist";

const waitlist = new Hono<{ Bindings: DbBindings }>();

waitlist.get("/", async (c) => c.json(await listWaitlist(getDb(c.env.DB))));

export default waitlist;
```

`getDb(d1)` wraps the binding in a Drizzle instance carrying the whole schema barrel, so
`db.query.<table>` and relational queries work. `DbBindings` is `{ DB: D1Database }`.

Never reach for `process.env` — it doesn't exist on Workers. Bindings live on the runtime, and
`c.env` is the only way to them.

## Tables are SQLite

D1 is SQLite, so table files import from `drizzle-orm/sqlite-core`:

```ts
// packages/db/src/schema/waitlist.ts
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const waitlist = sqliteTable("waitlist", {
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
    "database_id": "local",
    "migrations_dir": "../../packages/db/migrations"
  }
]
```

`binding: "DB"` is the name that shows up as `c.env.DB`. `migrations_dir` points wrangler at the
SQL the core's `db:generate` emits.

**`database_id` ships as the placeholder string `"local"`.** Local dev ignores it: `vite dev` and
`wrangler dev` both serve from a miniflare SQLite file under `apps/api/.wrangler/state`, so a
fresh clone runs with no Cloudflare account at all. The placeholder only has to be replaced before
you touch **remote** — that is, before `db:migrate:prod` or a deploy:

```sh
wrangler d1 create app-db        # prints the real database_id
# → replace "local" in apps/api/wrangler.jsonc with the printed id
```

The id is not a secret; commit it. `wrangler d1 create` is a one-time step per environment, and
running it again on an existing name fails rather than clobbering anything.

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

`db:migrate:prod` needs the real `database_id` and a wrangler login. There is no
`drizzle-kit push` and no auto-migrate on boot. Applying a migration is always a command you run.

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
two `db:migrate:*` scripts plus the `wrangler` devDependency in `packages/db/package.json`. Delete
those by hand. Your `src/schema/*.ts` files stay put and are still SQLite — port them to `pg-core`
yourself.

## Boundaries to honor

- **`c.env.DB` for the binding, never `process.env`.**
- **Tables import `drizzle-orm/sqlite-core`**, matching `dialect: "sqlite"` in `drizzle.config.ts`.
  Never hand-edit that config.
- **Replace `database_id` before going remote**, and only then. Local dev needs no Cloudflare
  account.
- **Migrations are manual** — generate, review, then apply local or prod explicitly.
- **Remote application is not this module's job to automate.** `db:migrate:prod` exists for manual
  use; centralized production deploy belongs to the future **`infra`** capability.
- **One driver per project.** Adding `database-postgres` beside this one is refused, by design.
