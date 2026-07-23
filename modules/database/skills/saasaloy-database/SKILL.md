---
name: saasaloy-database
description: Runbook for the database capability — Drizzle ORM on Cloudflare D1 in packages/db. Use when adding or changing tables, writing repositories, running or generating migrations, reading the DB from a route (c.env.DB), or wiring the D1 binding. Covers the schema-barrel drop convention, the thin repository pattern, the three manual migration scripts, and the placeholder-id → remote flow.
---

# database — Drizzle ORM on Cloudflare D1

`packages/db` (`@repo/db`) is the data layer: [Drizzle ORM](https://orm.drizzle.team) over
**Cloudflare D1** (SQLite at the edge). It's consumed by `apps/api` — the D1 binding lives on the
Worker, so the api entry reads it as `c.env.DB` and hands it to `getDb`. Its two defining
conventions are the **schema barrel** (drop a table file, it's picked up everywhere) and a **thin
repository layer** (raw queries live in one place, not sprawled through routes). Migrations are
**fully manual** — three explicit scripts, never autopush/automigrate.

## Add a table (the core convention)

Create `src/schema/<name>.ts` that exports Drizzle table(s):

```ts
// packages/db/src/schema/waitlist.ts
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const waitlist = sqliteTable("waitlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

That's the whole step — no edit anywhere else. Two mechanisms both react to the drop:

- **Runtime:** `src/schema.ts` (the barrel) merges every `src/schema/*.ts` into one `schema`
  object via Vite's `import.meta.glob`, which the api Worker's Vite bundles. `getDb` passes it to
  Drizzle, so `db.query.waitlist` and relational queries work.
- **Migrations:** `drizzle.config.ts` points drizzle-kit at the same `./src/schema/*.ts` glob, so
  `db:generate` sees the new table and emits SQL for it.

> **Why the barrel is `src/schema.ts`, not `src/schema/index.ts`:** drizzle-kit loads schema files
> with esbuild (Node), which can't run `import.meta.glob` (Vite-only). Keeping the barrel *beside*
> `src/schema/` — not inside it — keeps it out of drizzle-kit's glob. Don't move it in.
> Keep `src/schema/` **flat**: one level of `*.ts` table files.

## Read the DB from a route: `c.env.DB`, never `process.env`

The D1 binding arrives on the Worker's `env`, threaded through Hono as `c.env.DB`. Compose
`DbBindings` into the route's Hono generic so it's typed with no patch to api's entry:

```ts
// apps/api/src/routes/waitlist.ts
import { Hono } from "hono";
import { getDb, type DbBindings } from "@db/client";
import { listWaitlist } from "@db/repositories/waitlist";

const waitlist = new Hono<{ Bindings: DbBindings }>();

waitlist.get("/", async (c) => c.json(await listWaitlist(getDb(c.env.DB))));

export default waitlist;
```

Never reach for `process.env` — it doesn't exist on Workers.

## The repository layer: thin functions, not an ORM wrapper

Keep raw queries out of routes. A repository is a plain function taking a `db`, living in
`src/repositories/<name>.ts`. Unlike `schema/`, repositories are **not** auto-registered — import
the one you need directly. Import the **table itself** from its schema file (fully typed), not off
the runtime barrel — the barrel's merged `schema` is intentionally loose (it exists only to hand
Drizzle its relational metadata in `getDb`):

```ts
// packages/db/src/repositories/waitlist.ts
import { waitlist } from "@db/schema/waitlist";
import type { getDb } from "@db/client";

export function listWaitlist(db: ReturnType<typeof getDb>) {
  return db.select().from(waitlist);
}
```

## Migrations: three manual scripts (never autopush)

Migrations are deliberately hand-driven. Run from `packages/db`:

```sh
pnpm --filter @repo/db db:generate       # diff schema → emit SQL under migrations/
pnpm --filter @repo/db db:migrate:local  # apply pending migrations to LOCAL D1
pnpm --filter @repo/db db:migrate:prod   # apply pending migrations to REMOTE (production) D1
```

- `db:generate` (`drizzle-kit generate`) only reads the schema and writes SQL — no DB connection.
  Review the emitted SQL, commit it alongside the schema change.
- `db:migrate:local` / `:prod` run `wrangler d1 migrations apply DB` against the binding declared
  in `apps/api/wrangler.jsonc` (reached via `--config`). Local also passes `--persist-to` so the
  migrated SQLite is the same one `vite dev` serves from.
- There is **no** `drizzle-kit push` and **no** auto-migrate on boot. Applying a migration is
  always an explicit command you run.

## The D1 binding and the placeholder id

`add database` patches `apps/api/wrangler.jsonc` with the binding:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "app-db", "database_id": "local", "migrations_dir": "../../packages/db/migrations" }
]
```

Local dev **ignores `database_id`** — `"local"` is a placeholder and everything works against the
miniflare SQLite. For **remote** (`db:migrate:prod` / production), create the real database and
paste its id:

```sh
wrangler d1 create app-db        # prints the real database_id
# → replace "local" in apps/api/wrangler.jsonc with the printed id
```

## Boundaries to honor

- **Drop `src/schema/<name>.ts` to add a table** — never hand-edit the barrel or drizzle.config.ts.
- **Keep the barrel at `src/schema.ts`** and `src/schema/` flat — see the esbuild note above.
- **Queries live in `src/repositories/`**, imported by routes; routes don't build SQL inline.
- **`c.env.DB` for the binding, never `process.env`.**
- **Migrations are manual** — generate, review, then apply local/prod explicitly.
- **Remote application is not this module's job to automate.** `db:migrate:prod` exists for manual
  use; centralized production deploy belongs to the future **`infra`** capability.
