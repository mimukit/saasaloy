---
name: saasaloy-database
description: Runbook for the database capability — the driver-neutral Drizzle ORM data layer in packages/db. Use when adding or changing tables, writing repositories, generating migrations, or choosing between the database-d1 and database-postgres drivers. Covers the schema-barrel drop convention, the thin repository pattern, and db:generate. The connection, the dialect and the migrate commands belong to the driver skills, saasaloy-database-d1 and saasaloy-database-postgres.
---

# database — the driver-neutral data layer

`packages/db` (`@repo/db`) is the data layer's **core**: [Drizzle ORM](https://orm.drizzle.team)
tables, a **schema barrel**, a **thin repository layer**, and one script, `db:generate`. It holds
nothing that knows which database is behind it. There is no client here, no dialect, no connection
string and no migrate command.

Those live in a **driver module**, one per database, mirroring the `email` capability and its
providers:

| Driver module       | Database                    | Skill                          |
| ------------------- | --------------------------- | ------------------------------ |
| `database-d1`       | Cloudflare D1 (SQLite)      | `saasaloy-database-d1`         |
| `database-postgres` | Postgres, over postgres.js  | `saasaloy-database-postgres`   |

Install **exactly one**, and you cannot skip the step. Two descriptor fields enforce that from both
sides. Each driver names the other in `conflictsWith`, so `add` refuses a second one rather than
letting two clients fight over `src/client.ts`. And this core declares
`requiresOneOf: ["database-d1", "database-postgres"]`, so `add` will not leave a project holding the
core alone, whose `@repo/db/client` import resolves to a file no module ever wrote.

On a terminal, `add database` asks which one:

```sh
$ saasaloy add database
◆  database needs one of these — pick one
│  ● database-d1
│  ○ database-postgres
```

Name the driver instead and the prompt never appears — the driver's own `dependsOn` pulls the core
in, and the core's requirement is met by the driver arriving in the same run:

```sh
saasaloy add database-d1        # or: saasaloy add database-postgres
```

With `--yes`, or in a pipeline with no terminal, there is nothing to ask, so `add` refuses and names
both options. That is a refusal by design, not a failure:

```
Cannot add database — unmet requirement:
  database needs one of: database-d1, database-postgres, and none is installed. Run `saasaloy add database-d1` first, or pick another from that list.
```

Read the driver's skill for anything the tables themselves don't decide: how the connection reaches
a request handler, which bindings or environment variables it needs, and how a generated migration
is applied.

## D1 is the default, and both feature modules run on either driver

`auth` and `waitlist` ship their table declarations twice, once against `sqlite-core` and once
against `pg-core`, and the descriptor's `onlyWith` condition installs the pair that matches the
driver already in the project. Their route files are single files, because `withDb(c, …)` has the
same signature under both. `saasaloy add auth --dry-run` prints which schema source it chose.

Both modules declared `dependsOn: ["database-d1"]` until 2026-08-31, as a stopgap while the
payloads were still SQLite-only. That is gone; ADR 0026's amendment records the retraction, and ADR
0029 records the request-scoped client `auth` needs to hold on Postgres. Everything below this line
works the same on either driver.

## Add a table (the core convention)

Create `src/schema/<name>.ts` that exports Drizzle table(s). Import the table builder for the
dialect your driver uses (`drizzle-orm/sqlite-core` or `drizzle-orm/pg-core`); the driver skill
names it.

```ts
// packages/db/src/schema/waitlist.ts
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const waitlist = sqliteTable("waitlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

That's the whole step, with no edit anywhere else. Two mechanisms both react to the drop:

- **Runtime:** `src/schema.ts` (the schema barrel) merges every `src/schema/*.ts` into one `schema`
  object via Vite's `import.meta.glob`, which the api Worker's Vite bundles. The driver's `getDb`
  passes that object to Drizzle, so `db.query.waitlist` and relational queries work.
- **Migrations:** the driver's `drizzle.config.ts` points drizzle-kit at the same
  `./src/schema/*.ts` glob, so `db:generate` sees the new table and emits SQL for it.

> **Why the barrel is `src/schema.ts`, not `src/schema/index.ts`:** drizzle-kit loads schema files
> with esbuild (Node), which can't run `import.meta.glob` (Vite-only). Keeping the barrel *beside*
> `src/schema/`, not inside it, keeps it out of drizzle-kit's glob. Don't move it in.
> Keep `src/schema/` **flat**: one level of `*.ts` table files.

Tables are the one place the dialect leaks into the core. A schema written against one driver's
dialect does not port to the other by itself.

## A table is not a request schema

`src/schema/<name>.ts` describes the column shape a row is stored in. It is not the shape a client
is allowed to send. Request validation belongs in `@repo/validators` (the `validators` capability),
where the schema stays isomorphic and a browser bundle can import it too. A Drizzle table cannot,
because it carries the ORM and the D1 dialect with it.

So a create endpoint reads its input schema from `@repo/validators/<feature>`, and the repository it
calls takes the already-parsed value. Do not derive one from the other with `drizzle-zod`, and do not
put `zod` in `packages/db`.

## The repository layer: thin functions, not an ORM wrapper

Keep raw queries out of routes. A repository is a plain function taking a `db`, living in
`src/repositories/<name>.ts`. Unlike `schema/`, repositories are **not** auto-registered, so import
the one you need directly. Import the **table itself** from its schema file (fully typed), not off
the runtime barrel. The barrel's merged `schema` is intentionally loose; it exists only to hand
Drizzle its relational metadata in `getDb`:

```ts
// packages/db/src/repositories/waitlist.ts
import { waitlist } from "../schema/waitlist";
import type { Db } from "../client";

export function listWaitlist(db: Db) {
  return db.select().from(waitlist);
}
```

`Db` is the driver's Drizzle client type. Both drivers export it under that name, so a repository
signature does not change when the project switches driver.

(A file inside `packages/db` imports its own siblings by relative path. `@repo/db/...` is for
*other* workspaces consuming this package, not for code inside it.)

A repository written against the shared Drizzle query builder works on either driver. One reaching
for driver-specific SQL does not, so keep it on the builder where you can.

## `withDb` and the `@repo/db/client` contract

The core's `package.json` declares the `./client` export, but the file behind it,
`src/client.ts`, is scaffolded by the **driver**. Every consumer imports the same path either way,
and both drivers export the same four names behind it — `getDb`, `Db`, `DbRequestContext` and
`withDb` — with the same signatures:

```ts
// apps/api/src/routes/waitlist.ts
import { withDb, type DbBindings } from "@repo/db/client";
import { listWaitlist } from "@repo/db/repositories/waitlist";

const waitlist = new Hono<{ Bindings: DbBindings }>();

waitlist.get("/", (c) => withDb(c, async (db) => c.json(await listWaitlist(db))));
```

**`withDb(c, …)` is the one call shape for a route**, under either driver. It hands your callback a
client for this request and cleans up after it: on `database-postgres` that closes a real socket on
`c.executionCtx.waitUntil`, and on `database-d1` there is nothing to close, so it runs the callback
and returns. Writing the route this way means it does not change when the project switches driver.

`getDb(c.env)` is the client `withDb` builds, and it takes the whole `env` on both drivers — the
D1 one reads `env.DB`, the Postgres one resolves a connection string. Call it directly only where
there is no request context to hand over, such as a scheduled handler or a script, and then read
the driver skill for what you owe the connection afterwards.

`DbBindings` is the only piece whose *shape* is the driver's business. Compose it into the route's
Hono generic and the driver decides what `c.env` has to carry.

Note the import is `@repo/db/...`, the real package name, via `@repo/db`'s `exports` map, not
`@db/...`. `@db` is only the *file-placement* alias `saasaloy.json` uses to resolve a module's
`files[].target` when copying files onto disk; it isn't wired into TypeScript or Vite as an import
alias. A feature that needs `apps/api` to import from `packages/db` (like `waitlist`) has that
dependency added automatically: this module's `patches` includes a `package-json-dependency` op
that upserts `"@repo/db": "workspace:*"` into `apps/api/package.json` at `add` time.

Installing `database` on its own would leave the `./client` export pointing at a file that isn't
there. `requiresOneOf` is what stops that: `add` will not finish the core without a driver in the
same run or already installed. A project that reaches that state got there by hand — adding the
driver writes `src/client.ts` and the export resolves.

## Migrations: generate here, apply in the driver

Migrations are deliberately hand-driven. The core owns exactly one half of that:

```sh
pnpm --filter @repo/db db:generate       # diff schema → emit SQL under migrations/
```

`db:generate` (`drizzle-kit generate`) only reads the schema and writes SQL. It opens no
connection, so it runs the same way on either driver. Review the emitted SQL and commit it beside
the schema change.

It still needs a driver installed, because the config it reads, `drizzle.config.ts`, ships with the
driver. Run it on a core-only project and drizzle-kit falls back to its own default and reports
`drizzle.config.json file does not exist`, naming a file this project never had. Add a driver
first.

**Applying** a migration is the driver's command, because it needs the connection: see
`saasaloy-database-d1` or `saasaloy-database-postgres` for the one your project has. There is no
`drizzle-kit push` and no auto-migrate on boot in either. Applying a migration is always an
explicit command you run.

## Boundaries to honor

- **Drop `src/schema/<name>.ts` to add a table.** Never hand-edit the barrel.
- **Keep the barrel at `src/schema.ts`** and `src/schema/` flat; see the esbuild note above.
- **Queries live in `src/repositories/`**, imported by routes; routes don't build SQL inline.
- **Column shapes live here; request validation lives in `@repo/validators`.**
- **Keep the core neutral.** A connection, a dialect, a config file or a migrate script added here
  belongs in a driver module instead.
- **Exactly one driver per project.** `requiresOneOf` on this core stops you at zero, `conflictsWith`
  on each driver stops you at two; switching means `saasaloy remove` on the old driver first.
- **`auth` and `waitlist` install under either driver**, and each picks its schema variant when you
  add it. Switching driver later means removing and adding those modules too; see the driver skill.
- **Migrations are manual.** Generate, review, then apply with the driver's command.
