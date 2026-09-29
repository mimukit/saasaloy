---
name: saasaloy-database-postgres
description: Runbook for the database-postgres driver — Postgres over postgres.js behind packages/db. Use when reading the DB from a route (withDb(c, …)), setting DATABASE_URL in .dev.vars or as a production Workers secret, applying migrations with db:migrate, creating or dropping a development database with db:setup / db:status / db:drop and its docker, server and neon backends, opting into a Hyperdrive binding, or switching a project between this driver and database-d1. The tables, the repositories and db:generate belong to the core skill, saasaloy-database.
---

# database-postgres — the Postgres driver

`database-postgres` is the **driver** half of the data layer. The `database` core owns the tables,
the schema barrel, the repository layer and `db:generate`; this module owns everything that knows
the database is Postgres, reached over [postgres.js](https://github.com/porsager/postgres) through
`drizzle-orm/postgres-js`.

It installs seven things:

| What                                      | Where it lands                                       |
| ----------------------------------------- | ---------------------------------------------------- |
| the Postgres client (`getDb`)             | `packages/db/src/client.ts`                          |
| the `postgresql` drizzle-kit config       | `packages/db/drizzle.config.ts`                      |
| the `nodejs_compat` flag                  | `apps/api/wrangler.jsonc` (patch)                    |
| `db:migrate`                              | `packages/db/package.json` script (patch)            |
| the lifecycle scripts                     | `packages/db/scripts/`                               |
| `db:setup` / `db:status` / `db:drop`      | `packages/db/package.json` + root `package.json`     |
| the development container                 | `compose.yaml` at the repo root                      |

It also rewrites `packages/db/tsconfig.json` to put `node` in `compilerOptions.types`, because
`drizzle.config.ts` reads `process.env`, and patches `postgres` plus `@types/node` into that
workspace. `nodejs_compat` is not optional: postgres.js opens a TCP socket through `node:net`, and
without the flag the Worker fails to start.

Read `saasaloy-database` first for how to add a table or write a repository. Nothing below changes
those steps.

## The connection string: `DATABASE_URL`, or Hyperdrive

`getDb` takes the Worker's whole `env` and resolves one connection string from it:

```ts
export function resolveConnectionString(env: DbBindings): string {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  // throws when neither is set
}
```

`DATABASE_URL` is the default and the only one a fresh install needs. `HYPERDRIVE` wins when it is
there, so adding the binding switches a project onto the pooled path with no code change. Neither
one is read from `process.env`: a Worker has no process, and both arrive on `c.env`.

### Local dev: `apps/api/.dev.vars`

Wrangler reads `.dev.vars` beside the Worker and puts each key on `env`. Write the local URL there:

```sh
# apps/api/.dev.vars
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/app"
```

The base template's `.gitignore` already lists `.dev.vars`, so the file stays out of git. It also
carries a `!.dev.vars.example` exception, so commit an `apps/api/.dev.vars.example` with the key and
no value if you want it documented for the next person.

`drizzle.config.ts` loads that same file when `DATABASE_URL` is absent from the shell environment,
so `db:migrate` and a `vite dev` Worker agree on one URL with no second place to edit. An explicit
`DATABASE_URL=… pnpm …` still wins over the file.

You rarely write that line by hand. `pnpm db:setup` creates the database, writes `DATABASE_URL` and
records what it did in the state block above it. See "The lifecycle commands" below.

### Production: a Workers secret

`.dev.vars` is local-only and never deploys. In production `DATABASE_URL` is a **secret**, because
it carries the password:

```sh
wrangler secret put DATABASE_URL --config apps/api/wrangler.jsonc
# paste the connection string at the prompt
```

Never put it in `vars` in `wrangler.jsonc` — that block is plaintext and lands in git. Rotate by
running `wrangler secret put` again; the new value takes effect on the next deploy.

### TLS: the connection string decides

**postgres.js defaults `ssl` to `false`.** A `DATABASE_URL` that says nothing about TLS connects in
cleartext, password included, which is fine over loopback to a local container and wrong to a
database anywhere else. `getDb` passes no `ssl` option on purpose, so the string is the one place
that decides:

```sh
DATABASE_URL="postgres://user:pass@db.example.com:5432/app?sslmode=verify-full"
```

`sslmode=verify-full` checks the certificate chain and the hostname. `sslmode=require` encrypts
without verifying either, so it stops a passive listener and not an active one; take it only when
the provider's certificate cannot verify. `?sslrootcert=system` is postgres.js's alias for
`verify-full` against the runtime's own root store. Workers cannot load a custom CA, so a database
whose certificate is not publicly rooted needs Hyperdrive rather than a `ca` option.

Two cases take no `sslmode` at all. **Hyperdrive** hands you a `connectionString` pointing at
Cloudflare's local proxy, which is not a TLS endpoint; Cloudflare secures the hop to the real
database itself. **The local container** above serves no TLS. Both fail to connect if you force a
mode on them, which is why this is a property of each URL and not a default in the client.

## Read the DB from a route: `withDb(c, …)`

Compose `DbBindings` into the route's Hono generic so `c.env` is typed with no patch to api's entry,
then wrap the handler's body in `withDb`:

```ts
// apps/api/src/routes/waitlist.ts
import { Hono } from "hono";
import { withDb, type DbBindings } from "@repo/db/client";
import { listWaitlist } from "@repo/db/repositories/waitlist";

const waitlist = new Hono<{ Bindings: DbBindings }>();

waitlist.get("/", (c) => withDb(c, async (db) => c.json(await listWaitlist(db))));

export default waitlist;
```

`withDb` opens the connection, runs your callback, and closes the socket on
`c.executionCtx.waitUntil` afterwards. That last part is why it exists. This driver opens a real TCP
socket per request, and a handler that forgets to close it leaks one for the rest of the isolate's
life — a per-route obligation nobody remembers on the fiftieth route. Two rules the D1 driver does
not have, both of which `withDb` keeps for you:

- **One connection per request, never one per module.** A Workers isolate outlives the request that
  created it, but an open socket does not. Reusing one client across requests throws
  `Cannot perform I/O on behalf of a different request`.
- **Close it when the response is done.** `db.$client` is the underlying postgres.js instance and
  `end()` runs the moment it is called, not when the promise settles.

`database-d1` exports the same four names with the same signatures — `getDb`, `Db`,
`DbRequestContext`, `withDb` — and its `withDb` is a pass-through, because a D1 binding holds no
socket. So the route body above is byte-identical under both drivers, which is what lets a feature
module like `waitlist` ship one route file rather than one per dialect. Only the table declarations
differ, and those the feature module ships per dialect.

The one rule `withDb` cannot keep for you: **read everything you need inside the callback.** `end()`
starts as soon as the callback settles and postgres.js rejects every query issued after it, so
returning the `db`, a lazy query builder, or an unawaited promise out of the callback gives the
caller a connection that is already closing.

`getDb(c.env)` is still exported and still the thing `withDb` calls. Reach for it directly only
where there is no request context to hand over — a scheduled handler, a script — and then close the
connection yourself:

```ts
const db = getDb(env);
try {
  await backfill(db);
} finally {
  await db.$client.end();
}
```

Either way the schema barrel reaches Drizzle, so `db.query.<table>` and relational queries work.

## Tables are Postgres

Table files import from `drizzle-orm/pg-core`:

```ts
// packages/db/src/schema/waitlist.ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const waitlistEntries = pgTable("waitlist_entries", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

`drizzle.config.ts` sets `dialect: "postgresql"` to match. That pairing is the reason the config
lives here and not in the core: a schema written against `pg-core` does not port to D1's SQLite by
itself.

## Applying migrations

The core generates the SQL; this driver applies it, with `drizzle-kit migrate` against the
`DATABASE_URL` above:

```sh
pnpm --filter @repo/db db:generate   # core: diff schema → emit SQL under migrations/
pnpm --filter @repo/db db:migrate    # apply pending migrations
```

There is one script, not a `:local` / `:prod` pair, because the URL alone picks the target. Point it
at production by exporting the production URL for that one command:

```sh
DATABASE_URL="postgres://…" pnpm --filter @repo/db db:migrate
```

`drizzle-kit migrate` records what it applied in a `drizzle.__drizzle_migrations` table, so
re-running it is a no-op. There is no `drizzle-kit push` script and nothing migrates on boot.
Generate, review the SQL, commit it beside the schema change, then apply it as a command you run.
Automating the production run belongs to the future **`infra`** capability, not here.

## The lifecycle commands: `db:setup`, `db:status`, `db:drop`

Three commands create, report on and drop the development database. They live in
`packages/db/scripts/` and run from the repo root:

```sh
pnpm db:setup    # create the database if needed, then apply every pending migration
pnpm db:status   # backend, database, host, applied and pending migrations
pnpm db:drop     # drop the database and clear DATABASE_URL
```

`db:setup` is safe to re-run. It creates nothing that is already there, and a failed migrate leaves
the state block in place so the next run continues rather than making a second database.

### One database per branch

On `main` the database is the plain `<project>_dev`. On any other branch it is
`<project>_dev_<branch>`, and an `issue-<N>-…` branch collapses to `<project>_dev_issue_<N>_<hash>`,
because the title says nothing the number does not.

The reason is the shared server. A branch that adds a migration must not apply it to a database
other developers read: they then run schema that is not on `main` and nobody can see why. A database
per branch keeps the unmerged migration where only its author meets it. Run `pnpm db:drop` when you
are done with a branch, or the databases pile up.

### Backends: `--docker`, `--server`, `--neon`

A **backend** is where the Postgres runs. It is not a provider: nothing is installed or removed when
you change it, and nothing at runtime reads it (ADR 0039).

| Flag       | What it uses                                                       |
| ---------- | ------------------------------------------------------------------ |
| `--docker` | the container the root `compose.yaml` defines, started for you      |
| `--server` | the server the `DATABASE_URL` in `apps/api/.dev.vars` already names |
| `--neon`   | a temporary neon.new database, created over HTTP                    |

`docker` is the default, because a fresh project has no server. The flag is needed on the first run
only: the state block remembers the choice, and `--reset` is required to change it.

```sh
pnpm db:setup --server            # first run on a shared server
pnpm db:setup                     # later runs read the state block
pnpm db:setup --reset --docker    # replace it with a container database
```

`--neon` carries two quirks worth knowing. neon.new runs PostgreSQL 17, which has no `uuidv7()`, so
`db:setup` creates a SQL shim for it before the migrations run; and Node's dual-stack connect times
out against neon hosts on some networks, so the scripts force IPv4. The project deletes itself a few
days after it is created, and `db:status` prints how long is left.

### The state block

`db:setup` writes a run of comment lines at the top of `apps/api/.dev.vars`:

```sh
# db:setup state: written by pnpm db:setup, edit with care
# backend=docker
# database=app_dev_issue_152_9f2c1a
# created=2026-09-20T09:00:00.000Z
# end db:setup state

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/app_dev_issue_152_9f2c1a"
```

Wrangler and `process.loadEnvFile` skip a comment, so the record rides along in the file that
already holds the URL. A file that carries a `DATABASE_URL` but no block gets one inferred, when the
URL names a database this project manages or a neon.new host. Any other URL infers nothing and is
left alone, which is both how `--server` reads the server you already use and how a production
string in that file never becomes a drop target: `db:drop` drops what the block names and nothing
else.

### `db:drop` refuses; it does not ask

There is no confirmation prompt and no `--yes`. `db:drop` refuses a `DATABASE_URL` the state block
does not vouch for, and every `CREATE DATABASE` and `DROP DATABASE` passes a guard that accepts only
`<project>_dev` and `<project>_dev_<branch>` names.

It drops a **database, never a server**. No container is stopped and no neon.new project is deleted.
Throwing the container away is a separate, manual step:

```sh
docker compose down -v   # stops the container and deletes its volume
```

## Hyperdrive: the opt-in

[Hyperdrive](https://developers.cloudflare.com/hyperdrive/) is Cloudflare's connection pooler and
read cache in front of an existing Postgres. It is worth adding once per-request connection setup
starts to show in latency, or once the database's connection limit becomes the ceiling. It is not
installed by default, because it needs a Cloudflare account and a paid database that is already
reachable, and the driver works without it.

Adding it is three steps and no code change:

```sh
wrangler hyperdrive create app-db --connection-string="postgres://…"
# prints the hyperdrive id
```

Add the binding to `apps/api/wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "<the printed id>"
  }
]
```

Then deploy. `resolveConnectionString` finds `env.HYPERDRIVE.connectionString` and prefers it; the
`DATABASE_URL` secret can stay as it is. `binding: "HYPERDRIVE"` is the name `DbBindings` expects —
rename it and the client falls back to `DATABASE_URL` without saying so.

Two things Hyperdrive does not change. `wrangler dev` connects directly to the origin database for
the binding rather than through the pool, so local behavior is unchanged. And `db:migrate` runs
under Node against `DATABASE_URL`, not through the binding, so migrations always speak to the origin
database.

## `auth` and `waitlist` install here

Both ship their table declarations in two variants, one per dialect, and the descriptor's `onlyWith`
condition picks the `pg-core` file on this driver and filters the SQLite one out before the plan is
built. `saasaloy add auth --dry-run` prints which source it chose. Their route files are single
files under both drivers, because `withDb(c, …)` has the same signature here and on `database-d1`.

`auth` carries one extra rule this driver forces: its Better Auth singleton is module-scope and its
database client is not. Every `auth.api.*` call runs inside `withAuthScope(c, …)`, which is what
keeps one request's socket from reaching the next request on the same isolate. Read
`saasaloy-auth` before writing a protected route, and see ADR 0029.

Until 2026-08-31 both modules declared `dependsOn: ["database-d1"]` and `add` refused them here by
name. That stopgap is gone; ADR 0026's amendment records the retraction.

## Switching drivers

`database-postgres` and `database-d1` declare each other in `conflictsWith`, so `add` refuses the
second one instead of letting two clients fight over `src/client.ts`. To switch:

```sh
saasaloy remove database-postgres
saasaloy add database-d1
```

`remove` deletes the two files this module owns, `src/client.ts` and `drizzle.config.ts`. It also
deletes `packages/db/tsconfig.json`, which is **not** this module's file: the core `database`
scaffolds it too, `add database-postgres` overwrote the core's copy, and `remove` now takes the
whole file away without restoring the core's version.

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

`remove` takes the `nodejs_compat` flag back out of `apps/api/wrangler.jsonc`. It warns about the
leftovers it cannot reverse: the `db:migrate` script, the three `db:setup` / `db:status` / `db:drop`
scripts in both `packages/db/package.json` and the root `package.json`, the root `compose.yaml`, and
the `postgres` and `@types/node` dependencies. Delete those by hand — and run `pnpm db:drop` before
`remove`, while the scripts that can still reach the database are there. Your `src/schema/*.ts`
files stay put and are still `pg-core` — port them to `sqlite-core` yourself.

**A driver switch takes the dependent feature modules with it.** `auth` and `waitlist` pick their
schema variant at install time, and the unchosen one is filtered before the plan is built, so
neither notices that the driver under it changed. Remove and add each of them too:

```sh
saasaloy remove waitlist
saasaloy remove auth
saasaloy remove database-postgres
saasaloy add database-d1
saasaloy add auth
saasaloy add waitlist
```

There is no data migration in either direction; see ADR 0026.

## Boundaries to honor

- **`c.env` for the connection, never `process.env`** in `src/` — a Worker has no process.
  `drizzle.config.ts` is the one exception, and it runs under Node.
- **`withDb(c, …)` in a route.** It opens one connection per request and closes it afterwards. A
  shared client across requests is a runtime error, not a slow path, and a client nobody closes is a
  leaked socket. Bare `getDb` is for code with no request context, and then you close it yourself.
- **`DATABASE_URL` is a secret in production.** `wrangler secret put`, never `vars`.
- **Tables import `drizzle-orm/pg-core`**, matching `dialect: "postgresql"` in `drizzle.config.ts`.
  Never hand-edit that config.
- **Migrations are manual** — generate, review, then apply with `db:migrate`.
- **Hyperdrive is opt-in and code-free.** Add the binding; change nothing in `src/`.
- **One driver per project.** Adding `database-d1` beside this one is refused, by design.
