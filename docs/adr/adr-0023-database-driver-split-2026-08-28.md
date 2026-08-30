# 0023 — The `database` capability splits into a neutral core plus mutually exclusive drivers

`database` becomes three modules. `modules/database` is the driver-neutral core, a `saasaloy:capability` with `dependsOn: ["api"]` that scaffolds `packages/db` with `package.json`, `tsconfig.json`, `src/schema.ts`, `src/schema/` and `src/repositories/`, and keeps only the `db:generate` script plus the `drizzle-orm` and `drizzle-kit` pins. It ships no `client.ts`, no `drizzle.config.ts` and no wrangler binding. Those come from a **driver**: `modules/database-d1` or `modules/database-postgres`, both typed `saasaloy:feature` with `dependsOn: ["database"]`, each naming the other in the descriptor's `conflictsWith` field so a project can only ever hold one. Cloudflare D1 stays the default. Settled while building issue [#85](https://github.com/mimukit/saasaloy/issues/85).

## Status
accepted (the new ADR that [ADR 0001](adr-0001-all-in-on-cloudflare-2026-07-22.md)'s 2026-08-04 amendment requires before its rule may reach a stateful capability). See "Why a stateful capability gets a second implementation" below.

## Considered Options
- **Keep `database` D1-only and ship `database-postgres` as its own capability**, scaffolding its own workspace. Rejected because it duplicates the schema barrel, the repository layer and the `@repo/db` package name, and every downstream module (`auth`, `waitlist`) would then have to know which of the two is installed before it could import anything.
- **One `database` module with a `dialect` flag**, set at install time or read at runtime. Rejected because descriptors have no conditionals, and `drizzle.config.ts` hard-codes `dialect`. The flag would have to become a code branch shipped into every generated project, including the one that never uses the other side of it.
- **Let both drivers install and select at runtime, the way `email` does with `EMAIL_PROVIDER`.** Rejected because the two clients need different npm packages (`postgres` against a D1 binding), different `compatibility_flags`, and different `drizzle.config.ts` dialects. Nothing is left to select at runtime once the build has committed to one of them.

## Consequences
- **The refusal fires in either install order.** `packages/cli/src/lib/conflicts.ts` runs `detectConflicts` in two directions, a forward pass over the descriptors in the resolved graph and a reverse pass over the `conflictsWith` recorded in each installed module's lock entry. `formatConflicts` writes the message, `packages/cli/src/commands/add.ts` returns exit 1, and `--force` does not bypass it, because force means "re-apply this module", not "install it anyway". Both drivers declare the other, so neither can be the one that slips through.
- **`conflictsWith` is currently the only thing preventing a silent file collision.** Both drivers write `packages/db/drizzle.config.ts`, `packages/db/tsconfig.json` and `packages/db/src/client.ts`. The applier does not compare two modules' file targets, so without the declaration the second install would overwrite the first driver's files and leave a project whose `client.ts` and `drizzle.config.ts` disagree. Issue [#91](https://github.com/mimukit/saasaloy/issues/91) asks for a cross-module target collision to become a general applier error, independent of any descriptor field.
- **`packages/db/package.json` key order differs from the pre-split baseline, and that is accepted.** After `add database` and `add database-d1` the file holds the same keys with the same values as the single-module version did, in a different order. The patch engine appends, so `db:migrate:local` and `db:migrate:prod` land after `typecheck`, and `wrangler` and `@cloudflare/workers-types` land after `vite`. Byte-exact key order is unreachable while `package.json` stays core-owned and driver-patched. No patch kind can insert before an existing key, and sorting on insert is ruled out because `apps/api/package.json` keeps its scripts and dependencies deliberately unsorted.
- **Downstream modules import one path either way.** `@db/client` exports `getDb` and `DbBindings` under both drivers, so `auth` and `waitlist` need no branch. The argument differs (`getDb(c.env.DB)` on D1, `getDb(c.env)` on Postgres) and the driver's skill carries it.
- **Each driver owns its own runtime surface.** `database-d1` patches a `d1_databases` `wrangler-binding` into `apps/api/wrangler.jsonc`, adds the `db:migrate:local` and `db:migrate:prod` scripts, and pins `wrangler` and `@cloudflare/workers-types` into `packages/db/package.json`. `database-postgres` declares `DATABASE_URL` in `envVars`, patches `nodejs_compat` into the Worker's `compatibility_flags`, adds a single `db:migrate` script running `drizzle-kit migrate`, and pins `postgres` and `@types/node`. Its `client.ts` reads `HYPERDRIVE?.connectionString ?? DATABASE_URL`, so a project that later binds Hyperdrive changes no code.
- **Switching drivers is `saasaloy remove` then `saasaloy add`, and it moves no data.** There is no migration path and none is promised.

## Why a stateful capability gets a second implementation

ADR 0001's amendment says stateful infrastructure stays single-provider, and that applying the amendment to a stateful capability needs a new ADR. This is that record, and the honest argument is narrower than the amendment's wording suggests.

This is not the swappable adapter layer ADR 0001 cut. There is no `saasaloy migrate db`, no runtime toggle, and no path for moving existing rows. The choice happens once, at install time, on a project that has no data yet, and the CLI refuses the second driver outright rather than letting both sit behind an interface. What ADR 0001 rejected was the promise that a running system could change providers. What this promises is only that a **new** project can start on Postgres instead of D1.

The forcing case is the same shape as `email`'s. A user with an existing Postgres estate, or one whose data does not fit SQLite, is otherwise told "no database", not "database on Cloudflare". Cloudflare and D1 stay the default: a bare `saasaloy add database-d1` is the documented path, and `database-postgres` is the deliberate opt-in.

Still not reopened, and this record does not touch them: no `core` interfaces package, no per-provider deploy targets, no `saasaloy migrate db`.

## Driver, not provider

A driver is a different shape from a provider, so it gets its own word.

A provider module (`email-cloudflare`) is one file dropped into the capability's `providers/` folder plus a `plugin-array` patch that registers it. Several coexist in one project and `EMAIL_PROVIDER` picks between them at runtime. `.agents/skills/create-provider/SKILL.md` states the size test plainly. A provider is "deliberately tiny", and "if yours is growing a second file or a scaffold, you are probably authoring a capability".

A driver breaks that test on purpose. It replaces files the capability would otherwise own (`client.ts`, `drizzle.config.ts`, `tsconfig.json`), it carries scaffolds of its own, and it excludes its siblings instead of sitting beside them. Mutual exclusion is the load-bearing difference. A provider list is additive and read at runtime; a driver set has exactly one member and the CLI enforces that at install time.

## Both drivers ship a skill folder

`create-provider/SKILL.md` says a provider module ships "no skill folder of its own — the capability's skill documents it", and gives the reason: "One skill per capability keeps a consumer from installing five near-identical runbooks." The drivers depart from that. `modules/database-d1/skills/saasaloy-database-d1/SKILL.md` and `modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md` both exist.

The rule's reason does not apply here. Exactly one driver is ever installed, so a consumer receives one runbook, not five. And the two runbooks share almost no content. The D1 skill covers `wrangler d1 create`, the placeholder `database_id` of `"local"`, and the split between `db:migrate:local` and `db:migrate:prod`. The Postgres skill covers `apps/api/.dev.vars`, `wrangler secret put DATABASE_URL`, and the Hyperdrive opt-in. Folding both into the core skill would hand every project a page about a database it does not have.

`modules/database/skills/saasaloy-database/SKILL.md` keeps the neutral conventions, meaning the schema-barrel drop, the repository pattern and `db:generate`, and points at both driver skills for the connection, the dialect and the apply command.

## References
Issue [#85](https://github.com/mimukit/saasaloy/issues/85). Issue #83 delivered the two mechanisms this record depends on, the `package-json-script` patch kind and the `conflictsWith` descriptor field. Prior: [ADR 0001](adr-0001-all-in-on-cloudflare-2026-07-22.md) (the amendment this extends), [ADR 0005](adr-0005-two-tier-convention-based-modules-2026-07-22.md), [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md), [ADR 0018](adr-0018-database-depends-on-api-2026-07-24.md), [ADR 0020](adr-0020-capability-owns-its-vendor-packages-2026-07-24.md). Glossary: `CONTEXT.md` → "Driver module", "Provider module", "Capability module".
