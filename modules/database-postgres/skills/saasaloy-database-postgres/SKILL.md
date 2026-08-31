---
name: saasaloy-database-postgres
description: Runbook for the database-postgres driver — Postgres over postgres.js behind packages/db. Use when reading the DB from a route (withDb(c, …)), setting DATABASE_URL in .dev.vars or as a production Workers secret, applying migrations with db:migrate, opting into a Hyperdrive binding, or working out why `add auth` is refused on a Postgres project. The tables, the repositories and db:generate belong to the core skill, saasaloy-database.
---

# database-postgres — the Postgres driver

`database-postgres` is the **driver** half of the data layer. The `database` core owns the tables,
the schema barrel, the repository layer and `db:generate`; this module owns everything that knows
the database is Postgres, reached over [postgres.js](https://github.com/porsager/postgres) through
`drizzle-orm/postgres-js`.

It installs four things:

| What                                 | Where it lands                            |
| ------------------------------------ | ----------------------------------------- |
| the Postgres client (`getDb`)        | `packages/db/src/client.ts`               |
| the `postgresql` drizzle-kit config  | `packages/db/drizzle.config.ts`           |
| the `nodejs_compat` flag             | `apps/api/wrangler.jsonc` (patch)         |
| `db:migrate`                         | `packages/db/package.json` script (patch) |

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

Any Postgres works for local dev. A container is the shortest path:

```sh
docker run -d --name app-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18
```

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

export const waitlist = pgTable("waitlist", {
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

## `auth` and `waitlist` are D1-only today

Both modules ship SQLite payloads: their tables use `sqliteTable` from `drizzle-orm/sqlite-core`, and
`auth`'s Better Auth config passes `provider: "sqlite"` to the Drizzle adapter. Neither works on this
driver.

Neither names a driver in `dependsOn`. Both depend on the `database` capability, so `add auth` on a
Postgres project installs and nothing refuses it. The project then fails at `pnpm typecheck`:

```
$ pnpm typecheck
packages/db/src/schema/auth.ts: Type '"sqlite"' is not assignable ...
```

An earlier release pinned `dependsOn: ["database-d1"]` so `add` refused these two by name. The pin
came out under [#91](https://github.com/mimukit/saasaloy/issues/91), because on a clean project it
also chose D1 for the user without asking. Dialect-neutral payloads are the end state, tracked in
[#99](https://github.com/mimukit/saasaloy/issues/99); ADR 0026's 2026-09-01 retraction records the
change. Until they land, a Postgres project writes its own tables against `drizzle-orm/pg-core` and
its own routes, which is what the rest of this skill covers.

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
leftovers it cannot reverse: the `db:migrate` script plus the `postgres` and `@types/node`
dependencies in `packages/db/package.json`. Delete those by hand. Your `src/schema/*.ts` files stay
put and are still `pg-core` — port them to `sqlite-core` yourself.

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
