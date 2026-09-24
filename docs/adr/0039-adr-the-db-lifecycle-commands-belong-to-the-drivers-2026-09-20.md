# 0039 — The db lifecycle commands belong to the drivers

A generated project could create a migration and apply one. It could not create the database, report what was applied, or throw one away. `db:setup`, `db:status` and `db:drop` fill that gap. They ship in `database-d1` and `database-postgres`, not in a new `db` capability and not in the `database` core, and the thing each Postgres command runs against is called a **backend**, not a provider. Settled while planning issue [#152](https://github.com/mimukit/saasaloy/issues/152) (`docs/plans/0057-plan-db-lifecycle-scripts-2026-09-20.md`).

## Status

accepted. Applies [ADR 0037](0037-adr-an-alternate-implementation-that-adds-one-file-is-a-provider-2026-09-08.md)'s three-question test to a new surface and adds a fourth term, the backend, beside "provider" and "driver". It changes nothing in [ADR 0026](0026-adr-database-driver-split-2026-08-28.md) or [ADR 0033](0033-adr-transient-state-capabilities-take-providers-2026-09-08.md).

## The commands belong to the drivers

ADR 0037 question 1 decides it on its own: the project owns the schema and the migrations, so this is driver work. Two rejected shapes make the same point from the other side.

- **A `modules/db` capability with `requiresOneOf`.** Its entire body would be a branch over the two drivers: `wrangler` on one side, `postgres` on the other, with no shared line between them except the three command names. A module that is a switch statement is two modules wearing one name, and it would give `db:*` two owners in the script map.
- **The commands in the `database` core, branching at runtime.** The core declares neither `wrangler` nor `postgres` and must not, because it is the one package both drivers scaffold into. Putting either import there breaks the split ADR 0026 drew.

The cost of the shape we chose is duplication: both drivers patch the same six script keys, and only one driver is ever installed, so only one set is ever on disk. `client.ts` already works that way.

A third rejected shape is worth recording because it sounds cheaper than it is. **A `saasaloy db setup` CLI command** would need no module change at all — and would make a generated project depend on the Saasaloy CLI to prepare its own database. A generated project has to work for a developer who never installs the tool.

## A backend is not a provider

On Postgres the developer picks where the database runs: a local Docker container, a Postgres server the existing `DATABASE_URL` names, or a temporary neon.new database. Those are **backends**. A flag picks one on first run, the state block at the top of `apps/api/.dev.vars` remembers it, and `--reset` switches.

"Provider" already means something exact in this repo: a module in the registry, registered through a `plugin-array` patch, selected inside the Worker by a `<CAP>_PROVIDER` env var, normalizing its vendor's errors onto the capability's codes. A backend has none of those properties.

- It adds **no selection point to the registry**. Nothing is installed or removed when a developer moves from Docker to a server.
- **Nothing at runtime reads it.** These scripts run under Node on a developer's machine, never in the Worker, so the `<CAP>_PROVIDER` rule does not reach them. Giving the choice an env var would put a development-only switch in the file that configures production.
- It is **one developer's choice, not the project's**. Two developers on one repo may sit on different backends in the same week, which is exactly what the per-checkout state block records.

So the word stays separate, and `scripts/backends/` keeps the two apart on disk as well.

## The branch-named database

`db:setup` on the default branch creates the plain `<project>_dev`. On any other branch it creates `<project>_dev_<branch>`.

The reason is not tidiness. A branch that adds a migration must not apply it to a database other developers read: once it does, everyone is running schema that is not on `main`, and the person who did it cannot tell. A database per branch makes the unmerged migration land where only its author sees it. The rule costs one file (`scripts/lib/branch-name.ts`) and is free on the driver where local state is already per-worktree.

`database-d1` therefore ships the three names as thin wrappers, with no backends, no state block and no branch naming: `apps/api/.wrangler/state` is gitignored, so it is already one database per worktree.

## Safety is a refusal, not a prompt

`db:drop` ships no confirmation and no `--yes`. It refuses instead.

- `db:drop` drops what the state block names and nothing else. A `DATABASE_URL` no block vouches for infers no state, so a hand-set production string is never a drop target — and `--server` reads that same URL as the server to create on, which is why the unknown URL is left alone rather than refused.
- `assertManagedDatabase` guards every `CREATE DATABASE` and `DROP DATABASE`, so only `<project>_dev` and `<project>_dev_<branch>` names reach the server, and every name that passes is `[a-z0-9_]` only.
- It drops a **database**, never a server. No container is stopped, no neon.new project and no Postgres instance is deleted. `docker compose down -v` stays a separate, manual step.

A prompt would be worse on both counts. It stops an unattended run, and it trains a developer to confirm without reading.

## Consequences

- `@root` is now a real alias. `database-postgres` registers it and writes `compose.yaml` at the repo root, because `docker compose up -d` with no `-f` is the command people type. AGENTS.md carries the rule for using it, and two modules writing one root file is a plan-time collision.
- Both drivers patch six script keys, three in `packages/db/package.json` and three in the root `package.json`, so `pnpm db:setup` works from the repo root.
- `saasaloy remove <driver>` still leaves patched script keys behind, and now also the root `compose.yaml`. Both driver skills say so until the remover handles it.
- `db:prune`, `db:seed` and an `env` capability are deferred. The env-file reader is inlined per driver until the third caller for it exists.
