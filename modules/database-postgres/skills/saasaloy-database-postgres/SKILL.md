---
name: saasaloy-database-postgres
description: Runbook for the database-postgres driver — Postgres over postgres.js behind packages/db. Use when reading the DB from a route (withDb(c, …)), setting DATABASE_URL in packages/env/.env.example or as a production Workers secret, applying migrations with db:migrate, dumping and migrating the production database with db:prod:dump and db:prod:migrate, setting up the read-only production role with db:prod:readonly-grants (its password, rotation and the ~/.config/<project>/prod-readonly.env file, plus the Workers Observability token for logs:prod), querying production with db:prod:query, creating the first superadmin with db:prod:superadmin, creating or dropping a development database with db:setup / db:status / db:drop and its docker, server and neon backends, seeding it with db:seed, writing route tests against the test database with testDatabase(), opting into a Hyperdrive binding, or switching a project between this driver and database-d1. The tables, the repositories and db:generate belong to the core skill, saasaloy-database.
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

### Local dev: `apps/api/.env`

`saasaloy add database-postgres` puts `DATABASE_URL` in `packages/env/.env.example`, the project's
one key list. Fill it in and distribute it:

```sh
saasaloy env        # prompts for each unset key, writes packages/env/.env
pnpm env:setup      # writes apps/api/.env from the key list and that file
```

Wrangler reads `apps/api/.env` beside the Worker and puts each key on `env`. Both files are
gitignored; the example is tracked, and its local default is the line above.

`DATABASE_URL` is a **checkout-owned key** (`CHECKOUT_OWNED_KEYS` in `packages/env/src/services.ts`),
so a per-branch value you set survives every later `pnpm env:setup`.

`drizzle.config.ts` loads that same file when `DATABASE_URL` is absent from the shell environment,
so `db:migrate` and a `vite dev` Worker agree on one URL with no second place to edit. An explicit
`DATABASE_URL=… pnpm …` still wins over the file.

You rarely write that line by hand. `pnpm db:setup` creates the database, writes `DATABASE_URL` and
records what it did in the state block in `apps/api/.env.db`. See "The lifecycle commands" below.

### Production: a Workers secret

`apps/api/.env` is local-only and never deploys. In production `DATABASE_URL` is a **secret**, because
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

`db:migrate` acts on the development database `apps/api/.env` names. Production has its own commands:

```sh
pnpm db:prod:dump              # pg_dump the production database into the backup folder
pnpm db:prod:migrate           # dump first, then drizzle-kit migrate, then the read-only grants
pnpm db:prod:readonly-grants   # create the read-only role and match its grants to the column classes
pnpm db:prod:query "<sql>"     # read production as the read-only role, masked
pnpm db:prod:superadmin --email <address>   # the first superadmin (with auth only)
```

`drizzle-kit migrate` records what it applied in a `drizzle.__drizzle_migrations` table, so
re-running it is a no-op. There is no `drizzle-kit push` script and nothing migrates on boot.
Generate, review the SQL, commit it beside the schema change, then apply it as a command you run.

### Production: `db:prod:dump` and `db:prod:migrate`

Both run `node scripts/prod.ts` through `env-deploy --run api`, so `DATABASE_URL` is the production value from the value source (`packages/env/.env.prod` with the `local` source) and stays in memory. It is `--run api` because `DATABASE_URL` is an `api` key. Before anything connects, the script checks the target:

- The database must be named `<project>_production`: `databasePrefix` with `_dev` replaced by `_production`, so `acme_shop_dev` becomes `acme_shop_production`. Any other name, `<project>_prod` included, is refused.
- The host must differ from the development server that `apps/api/.env` names.

A refused target stops the command with nothing dumped or migrated.

`db:prod:dump` runs `pg_dump --format=custom` into a new `<project>_production-<UTC time>.dump` file, mode 0600, in `~/<project>-backups/` (mode 0700), or in `DB_DUMP_DIR` when it is set. The folder sits outside the repository, so `git add .` and `git clean` never reach a file of production rows. `pg_dump` runs from the `postgres:<major>` image the root `compose.yaml` names, through Docker, so its major version matches the server. Set `PG_DUMP=local` to use the `pg_dump` on `PATH` instead.

`db:prod:migrate` takes that dump first and stops when it fails or comes out empty. Then it runs `drizzle-kit migrate`. When the migration fails, the message names the dump that holds the database as it was before.

**A deploy migrates only when you ask.** `pnpm deploy:production` stops at its migration gate when a file in `packages/db/migrations/` changed since the last deploy tag, and names the files. Read the SQL, then run `pnpm deploy:production --migrate`, which runs `db:prod:migrate` once before any Worker uploads. The `saasaloy-deploy` skill covers the gate, and `docs/runbook-deploy.md` holds this project's restore steps.

After the migration, `db:prod:migrate` brings the read-only role's grants up to the column classes, as `pnpm db:prod:readonly-grants` does (see "The read-only role" below). A failed grant step prints `The read-only grants failed (...). The migration stands, and the role keeps its old grants. Run pnpm db:prod:readonly-grants.` and does not change the migrate result. The old grants stay, so a column the migration added stays unreadable to the role until the grants run again.

## The read-only role: `db:prod:readonly-grants` and `db:prod:query`

An agent that debugs production reads it as `<project>_ro`, a login role that the server keeps read-only, never as the owner role in `packages/env/.env.prod`. The role name is `databasePrefix` with `_dev` replaced by `_ro`, so `acme_shop_dev` gives `acme_shop_ro`. The `saasaloy-prod-debug` skill is the agent's runbook; this section is the owner's setup.

### What `pnpm db:prod:readonly-grants` does

It runs `node scripts/readonly-grants.ts` under `env-deploy --run api`, with the same target check as `db:prod:dump`: `<project>_production` on a server other than the dev one. Then, in one transaction, it:

- creates `<project>_ro` with `LOGIN` when it is missing, and never gives it a password;
- sets `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`, and the role defaults `default_transaction_read_only = on`, `statement_timeout = '15s'` and `idle_in_transaction_session_timeout = '30s'`;
- sets `log_statement = 'all'` on the role only when the connecting role is a superuser, so the server log records each statement the role runs. Otherwise it prints `Skipped log_statement: ...` and the role runs without that audit log. A managed host's owner role is often not a superuser;
- grants `CONNECT` on the database and `USAGE` on `public`;
- for each live table in `public`, runs `REVOKE ALL` and then `GRANT SELECT (<columns>)` on its `pii` and `plain` columns only.

The classes come from `packages/db/src/column-classes/`; the `saasaloy-database` skill has the rule. There is no table-level grant and no `ALTER DEFAULT PRIVILEGES`, so a `secret` column, a column with no class and a table with no class file get nothing. A classified column the database does not have yet is skipped. The output has one line per table (`accounts: 9 column(s) readable, 4 secret withheld`) and names every unclassified column. Running it again is safe: each run makes the grants match the classes exactly, so a column moved to `secret` loses its grant.

Creating and altering the role needs `CREATEROLE` on the connecting role. Without it the command fails with the server's error, and nothing in the transaction lands.

### One-time setup

1. Run the grants once:
   ```sh
   pnpm db:prod:readonly-grants
   ```
2. Give the role a password, in a SQL console open on `<project>_production` as the owner. The command prints this line with the real role name:
   ```sql
   ALTER ROLE "<project>_ro" PASSWORD '<a new password>';
   ```
3. Write the URL file the command names, `~/.config/<project>/prod-readonly.env`, with mode 0600. It holds one key, `PROD_READONLY_DATABASE_URL`. Percent-encode any special character in the password, and add the `sslmode` the "TLS" section above asks for:
   ```sh
   mkdir -p ~/.config/<project> && chmod 700 ~/.config/<project>
   ( umask 077; echo 'PROD_READONLY_DATABASE_URL=postgres://<project>_ro:<password>@<host>:5432/<project>_production?sslmode=verify-full' > ~/.config/<project>/prod-readonly.env )
   chmod 600 ~/.config/<project>/prod-readonly.env
   ```
   Never put this key in `packages/env/.env`, `.env.prod` or `.env.example`: no service reads it.
4. For `pnpm logs:prod`, create a Cloudflare API token with one permission, Account > Workers Observability > Read, in the dashboard under My Profile > API Tokens > Create Token > Custom token. Write it with the account id to `~/.config/<project>/cloudflare-logs.env`, mode 0600:
   ```sh
   CLOUDFLARE_LOGS_API_TOKEN=<the token>
   CLOUDFLARE_ACCOUNT_ID=<the account id>
   ```
   `<project>` there is the root `package.json` name as `databasePrefix` slugs it, so both files share one folder. Never use the deploy token: it can deploy.
5. Check both:
   ```sh
   pnpm db:prod:query "select count(*) from users"
   pnpm logs:prod --since 1h
   ```

### Rotate or lock the role

Rotate the password with the same `ALTER ROLE ... PASSWORD` statement, then edit the URL file. To lock the role out, run `ALTER ROLE "<project>_ro" PASSWORD NULL`. Do not use `NOLOGIN`: the next `db:prod:readonly-grants` or `db:prod:migrate` sets `LOGIN` again, and it never touches the password.

### `pnpm db:prod:query`

`node scripts/query.ts`, with no `env-deploy`: it reads `PROD_READONLY_DATABASE_URL` from `~/.config/<project>/prod-readonly.env` and nothing else. It refuses to start when the file is missing, has a mode wider than 0600, or holds a URL that is not `<project>_production` as `<project>_ro` on a server other than the dev one. After it connects, it checks `current_user` and `default_transaction_read_only` before the first statement. Each refusal ends with `Nothing ran.`

```sh
pnpm db:prod:query "select id, role, created_at from users order by created_at desc limit 5"
pnpm db:prod:query --auth-trace ana@example.com
pnpm db:prod:query --max-rows 1000 < query.sql
```

It runs one statement per call through the extended protocol, in `begin read only`, and rolls back. It prints at most 200 rows (`--max-rows` takes 1 to 5000), masks each output column whose name some table classes `pii`, and never prints the URL. The `saasaloy-prod-debug` skill covers the masker, `--auth-trace` and what the role cannot read.

## The first superadmin: `db:prod:superadmin`

No sign-up promotes an account: every sign-up gets `user`, the first one included. On this driver production gets its first superadmin from this command. It ships only when `auth` is installed, because it writes the auth tables. Run it once before the first `pnpm deploy:production`, so the admin app has an owner the moment the api answers:

```sh
pnpm db:prod:superadmin --email you@example.com [--name "Your Name"] [--keep-password]
```

It runs `node scripts/superadmin.ts` under `env-deploy --run api`, with the same production target check as the other `db:prod:*` commands. It also accepts this project's own development databases, so you can try it before launch: from `packages/db`, run `node scripts/superadmin.ts --email ...` with `DATABASE_URL` exported. Every other database is refused before a connection opens.

- `--email` is required, and it is trimmed and lowercased. A `.test` or `.invalid` address is refused.
- At a terminal it asks for the password twice, without echo. From a pipe, such as a password manager, it reads the first line once. The password needs 12 to 128 characters and no leading or trailing space, the same rule as sign-up.
- It hashes the password the way Better Auth does (scrypt, `<salt>:<key>` in hex), and prints neither the password nor the hash.
- In one transaction it creates the `users` row and its `credential` account, or promotes an existing account: it sets the role from `config.auth.superadminRole`, marks the email verified, and lifts a ban. Setting a password on an existing account ends all its sessions.
- `--keep-password` promotes without a prompt, and refuses an account that has no password yet.
- It ends with the other accounts that hold the role. Check that each one should.

Then sign in on the admin app with that email. D1 has no such command: the `saasaloy-auth` skill has the D1 steps.

## The lifecycle commands: `db:setup`, `db:status`, `db:drop`

Three commands create, report on and drop the development database. They live in
`packages/db/scripts/` and run from the repo root:

```sh
pnpm db:setup    # create the database if needed, then apply every pending migration
pnpm db:status   # backend, database, host, applied and pending migrations
pnpm db:drop     # drop the database, clear DATABASE_URL, delete the state block
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
you change it, and nothing at runtime reads it (ADR 0042).

| Flag       | What it uses                                                   |
| ---------- | -------------------------------------------------------------- |
| `--docker` | the container the root `compose.yaml` defines, started for you |
| `--server` | the server the `DATABASE_URL` in `apps/api/.env` already names |
| `--neon`   | a temporary neon.new database, created over HTTP               |

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

`db:setup` writes a run of comment lines to `apps/api/.env.db`, and `DATABASE_URL` to
`apps/api/.env`:

```sh
# apps/api/.env.db
# db:setup state: written by pnpm db:setup, edit with care
# backend=docker
# database=app_dev_issue_152_9f2c1a
# created=2026-09-20T09:00:00.000Z
# end db:setup state

# apps/api/.env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_dev_issue_152_9f2c1a
```

The block has a file of its own because `pnpm env:setup` rebuilds `apps/api/.env` from the key list
and drops every comment it did not write. `DATABASE_URL` survives that rebuild as a checkout-owned
key; the block would not. `.env.*` is gitignored, and no tool loads `.env.db`.

A checkout whose `DATABASE_URL` has no state file gets one inferred, when the URL names a database
this project manages or a neon.new host. Any other URL infers nothing and is left alone, which is
both how `--server` reads the server you already use and how a production string never becomes a
drop target: `db:drop` drops what the block names and nothing else.

The two files can drift apart under a hand edit. When `DATABASE_URL` names another database than
the block records, `db:setup` and `db:drop` refuse and `db:status` prints a `Mismatch` line.
`db:setup --reset` replaces the recorded database and writes both files again.

### `db:drop` refuses; it does not ask

There is no confirmation prompt and no `--yes`. `db:drop` refuses a `DATABASE_URL` the state block
does not vouch for, and every `CREATE DATABASE` and `DROP DATABASE` passes a guard that accepts only
`<project>_dev` and `<project>_dev_<branch>` names.

It drops a **database, never a server**. No container is stopped and no neon.new project is deleted.
Throwing the container away is a separate, manual step:

```sh
docker compose down -v   # stops the container and deletes its volume
```

## Seed data: `db:seed`

`pnpm db:seed` fills this checkout's development database with the rows in `packages/db/src/seed/slices/`, one file per table. The slice contract (slugs, `seedId`, the conflict key) is in the `saasaloy-database` skill, "Seed data". This section is what the Postgres runner does with it.

```sh
pnpm db:setup   # create and migrate the database; it never writes rows
pnpm db:seed    # upsert every slice row, print a count per table
```

It writes the whole seed in one transaction, so either every row lands or none does. A rerun prints the same counts and resets each seed row to its slice values; rows you made by hand stay. To drop rows a slice no longer has, run `pnpm db:setup --reset`, then `pnpm db:seed`.

The guard runs before any connection opens:

- `NODE_ENV=production` is refused first.
- The target is `DATABASE_URL` from the environment, or the one in `apps/api/.env`. Its database must be `<project>_dev` or `<project>_dev_<x>`, the names `db:setup` makes, so `DATABASE_URL=…/postgres pnpm db:seed` exits `1` and writes nothing.
- A `DATABASE_URL` from the environment must name the same server (`host:port`) as the one in `apps/api/.env`. A shell variable aimed at a remote database with the right name is refused, and so is one set while `apps/api/.env` has none.

## Route tests

The api's tests run in Node with Vitest, against a test database of their own: the checkout's development database plus `_test`, such as `<project>_dev_test` on the default branch and `<project>_dev_issue_207_<hash>_test` on a branch. Two worktrees never share one. `pnpm test` from the repo root runs them.

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

`auth` ships a worked example at `apps/api/src/routes/auth.test.ts`: it signs a seed user in, and a second test proves the session it wrote is gone.

How it fits together:

- **Global setup.** `apps/api/test/setup/database.ts` re-exports `setup` from `packages/db/scripts/test-setup.ts`, and the api's `vitest.config.ts` runs every file in that folder once per run. It creates the test database when it is missing (with the same server code `db:setup` uses, starting the container first on the docker backend), applies every migration and runs the seed. When migrating fails, because the migration files were regenerated, it drops the test database, creates it again and migrates once more. `TEST_DATABASE_URL` may move the test database to another server, but the setup refuses any database name other than the checkout's own `<database>_test`, because a failed migration drops the database it names.
- **One transaction per test.** `testDatabase()` registers an `aroundEach` hook that opens a transaction, runs the test inside it and rolls it back. `database.env` carries that transaction under the `TEST_DB` symbol key, `getDb` returns it instead of opening a connection, and `withDb` leaves it open. A route's own `db.transaction()` becomes a savepoint. `database.db` is the same transaction, to set a row up or to look behind a route.
- **Node, not workerd.** The test calls `app.request(path, init, env)` directly. `@cloudflare/vitest-pool-workers` is not used: a postgres.js transaction the test holds would cross request contexts, which workerd refuses.

Read `database.env` and `database.db` inside a test, never at module scope: the transaction exists only while a test runs.

`apps/api` does not depend on `drizzle-orm`, so a test file cannot import `eq` or another operator from it. Import the table from `@repo/db/schema/<file>` and a seed row's id from `@repo/db/seed/id` (`seedId("users", "superadmin")`), select the rows with `database.db.select().from(table)` and filter them in the test. Or put the query in a repository under `packages/db/src/repositories/` and import that.

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

`auth` carries one extra rule this driver forces: its two Better Auth instances (`auth` and `adminAuth`) are module-scope singletons and their database client is not. Every `api.*` call on either instance runs inside `withAuthScope(c, …)`, which is what
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
- **`db:seed` writes only to a database `db:setup` named**, never with `NODE_ENV=production`.
- **An agent reads production only through `pnpm db:prod:query`**, as `<project>_ro`. Never through `env-deploy --run api` or the owner URL. The `saasaloy-prod-debug` skill is the runbook.
- **The read-only URL lives in `~/.config/<project>/prod-readonly.env`, mode 0600**, never in `packages/env/`.
- **Route tests use `testDatabase()`**, so each one rolls back. Never point a test at the development database.
- **Hyperdrive is opt-in and code-free.** Add the binding; change nothing in `src/`.
- **One driver per project.** Adding `database-d1` beside this one is refused, by design.

## Next

Run `saasaloy-database` to add a table, a repository function and a seed slice. Run `saasaloy-prod-debug` to answer a question about production data.
