# Plan: database driver split with a Postgres driver

Grilled: 2026-08-27

## Context

The database capability is D1-only. D1 is baked into four places: `files/src/client.ts` (drizzle-orm/d1, `DbBindings`), `files/drizzle.config.ts` (`dialect: "sqlite"`), the `db:migrate:*` scripts (`wrangler d1 migrations apply`), and the `d1_databases` patch on `apps/api/wrangler.jsonc`. The first real project scaffolded from saasaloy needs Postgres (unishopr-reborn, gap item 1 in `unishopr-reborn/docs/misc/saasaloy-base-and-gaps-2026-08-27.md`). The schema barrel and the repository layer are already driver-neutral, so the capability splits the way `email` did: a neutral core plus driver modules. Success means `saasaloy add database-postgres` yields a working `packages/db` on Postgres, and `saasaloy add database-d1` reproduces today's behaviour exactly.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Architecture | Driver split: neutral `database` core + `database-d1` + `database-postgres` driver modules, mirroring `email` + `email-cloudflare`/`email-console`. Avoids duplicating the barrel, repositories, and skill. |
| Postgres connection | `drizzle-orm/postgres-js` (postgres.js). Default is a plain `DATABASE_URL` (Workers secret in prod, `.dev.vars` locally). Hyperdrive is optional: `client.ts` prefers `c.env.HYPERDRIVE.connectionString` when the binding exists, and the SKILL.md documents enabling it; the descriptor patches no Hyperdrive binding. |
| Migration apply | `drizzle-kit generate` stays; apply with `drizzle-kit migrate` against `DATABASE_URL` (read from `.env` by drizzle-kit under Node). Still fully manual, no autopush. |
| Migrate scripts | Drivers add `db:migrate*` scripts via a new `package-json-script` patch kind, a sibling of `package-json-dependency`. No patch kind can touch `scripts` today (`packages/cli/src/lib/patch/index.ts:19`). |
| Driver exclusivity | A new `conflictsWith` descriptor field, checked at `add` time. Verified fact: cross-module file collision is silent last-writer-wins with ownership re-attribution (`applier.ts:152`), so document-only exclusivity would mean silent clobber. |
| Removal | `remove database-<driver>` deletes the driver's files; its patches are warned, not reversed, per the remover's existing convention. Documented in the driver skills. |
| Backwards compatibility | `database` alone no longer works; the SKILL.md and README say to add exactly one driver. No lockfile migration for existing scaffolds. |

## Approach

Reuse the two-tier pattern from `email`: the core owns the workspace scaffold and the neutral files; drivers are `saasaloy:feature` modules with `dependsOn: ["database"]` that add their own files, patches, and scripts. Reuse the `create-provider` skill's descriptor shape where it fits, the existing patch kinds, magicast/jsonc patch machinery (ADR-0010), and the applier test harness.

### Phase 1: applier groundwork (#83)

Add the `package-json-script` patch kind (schema, patch dispatch, fixtures: add, idempotent re-add). Add the `conflictsWith` field to the descriptor schema and an add-time check that refuses installation with a clear message when a conflicting module is installed; fixtures for both directions. Add `.dev.vars` to the base template's `_gitignore` (today a hand-written secrets file is one `git add .` from being committed). Verify: CLI test suite green.

### Phase 2: extract the neutral core (#85)

Slim `modules/database` down to what both drivers share: `package.json` (drizzle-orm, drizzle-kit, `db:generate`, `clean`, `typecheck`; no wrangler scripts, no wrangler devDependencies), `tsconfig.json`, `src/schema.ts` barrel, `src/schema/.gitkeep`, `src/repositories/.gitkeep`. Move `client.ts`, `drizzle.config.ts`, the migrate scripts, and the `d1_databases` patch out of the core descriptor. Rewrite `skills/saasaloy-database/SKILL.md` for the neutral conventions (barrel, repositories, manual migrations) pointing to the driver skills for connection and apply mechanics. Verify: `saasaloy add database` in `.dev` scaffolds a `packages/db` that typechecks with no client.

### Phase 3: `database-d1` driver module (#85)

New `modules/database-d1` (`saasaloy:feature`, `dependsOn: ["database"]`, `conflictsWith: ["database-postgres"]`) carrying today's D1 pieces unchanged: `files/client.ts` → `@db/src/client.ts`, `files/drizzle.config.ts` (sqlite dialect), the `d1_databases` wrangler-binding patch, `package-json-script` patches for `db:migrate:local`/`db:migrate:prod`, and `package-json-dependency` patches for the `wrangler`/`@cloudflare/workers-types` devDependencies. Write `skills/saasaloy-database-d1/SKILL.md` (binding, placeholder `database_id` flow, migrate commands). Verify: `add database` + `add database-d1` in `.dev` reproduces the current single-module result file-for-file, and `add database-postgres` on top is refused.

### Phase 4: `database-postgres` driver module (#85)

New `modules/database-postgres` (`saasaloy:feature`, `dependsOn: ["database"]`, `conflictsWith: ["database-d1"]`). `files/client.ts` uses `drizzle-orm/postgres-js`; `getDb` takes a connection string; the exported bindings type carries `DATABASE_URL: string` and an optional `HYPERDRIVE?: Hyperdrive`, and a small helper resolves `HYPERDRIVE?.connectionString ?? DATABASE_URL`. `files/drizzle.config.ts` sets `dialect: "postgresql"` and `dbCredentials: { url: process.env.DATABASE_URL }` (drizzle-kit runs under Node). Patches: `postgres` dependency, `db:migrate` script running `drizzle-kit migrate`. `envVars` declares `DATABASE_URL`. `skills/saasaloy-database-postgres/SKILL.md` covers `.dev.vars` locally, the Workers secret in prod, and the optional Hyperdrive upgrade (create the binding, code needs no change). Verify in `.dev` against a local Postgres: generate, migrate, and a round-trip query through a repository.

### Phase 5: docs, ADR, and registry hygiene (#85)

Update `modules/README.md` and the root README module table. Run `pnpm deps:verify` after adding the postgres.js pin. Record one ADR for the driver split plus the `conflictsWith` mechanism (it changes the module vocabulary). File a follow-up issue for making cross-module file collisions an error for everyone (out of scope here).

## Non-goals

- No general patch-reversal work in the remover; driver-patch leftovers stay warn-only.
- No migration path for projects already scaffolded with the old single `database` module.
- No Neon/node-postgres drivers; postgres.js only.
- No Hyperdrive binding in the descriptor; opting in is a documented manual step.
- No production deploy automation; `db:migrate` stays a manual command.
