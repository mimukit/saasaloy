# Plan — `database` capability module

*Drafted 2026-07-24. Hardened via grillkit 2026-07-24.*

## Context

`database` is the second Phase-1 **capability module** in the Saasaloy registry (issue #9), the
sibling of `api` (#8). It scaffolds `packages/db` — **Drizzle + D1 (SQLite)** — and establishes the
**schema-barrel convention** that every downstream feature (`waitlist`, `feedback`, `billing`, …)
extends by dropping a `schema/*.ts` file, plus a **thin repository layer** so raw SQL doesn't sprawl
through app code (build-spec §2.2). It also patches the D1 binding into `apps/api/wrangler.jsonc`.

This plan authors the module **artifact** — `modules/database/registry-item.json`, its `files/` tree,
and its `skills/saasaloy-database/` runbook — per the `create-module` skill and build-spec §2.2 (repo
layer), §2.3 (Drizzle + D1), §2.7 (schema barrel), §3.1 (`packages/db`). **Unlike when `api` was
authored, the applier now applies `scaffolds[]`**, so `saasaloy add database` really lands
`packages/db`. `database` is also the **first module with a real `patches` entry**, so this plan
**wires the patch engine (#7) into the applier's `executePlan`** — patches stop being deferred and are
actually applied. Blockers #6 (applier) and #7 (patch engine) are both closed; #9 is unblocked.

Success = a schema-valid `database` descriptor whose scaffolded `packages/db` exposes tables through
the barrel, whose `saasaloy add database` patches the D1 binding into `apps/api/wrangler.jsonc`, and
whose three manual migration scripts generate SQL and apply it to **local** D1 — exercised end to end
through the git-ignored `.dev/` playground.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Tier | **Capability** (`saasaloy:capability`) — scaffolds `packages/db` and carries `scaffolds[]` + `patches`. |
| Identity | Package `@repo/db`; scaffold registers alias `@db → packages/db/src` into `saasaloy.json`. |
| Stack | **Drizzle ORM + D1 (SQLite)** (build-spec §2.3). Postgres is a later explicit migration, never a toggle. |
| `dependsOn` | **`["api"]`.** Revises the `api`-plan's "peer, neither needs the other" framing — the D1 binding patch targets `apps/api/wrangler.jsonc`, which must exist first. `add database` pulls `api` → then patches it. (ADR.) |
| Schema barrel — mechanism | **Two drop-friendly mechanisms, no per-feature patch.** Runtime: `src/schema/index.ts` uses `import.meta.glob('./*.ts', { eager: true })` merged into one `schema` object (empty-safe); it is bundled by the api Worker's Vite — the only runtime where a D1 binding exists. Migrations: `drizzle.config.ts` `schema: './src/schema/*.ts'` (drizzle-kit's native glob). Dropping `schema/x.ts` feeds both. |
| Barrel typing | The glob barrel needs `vite/client` types so `tsc --noEmit` understands `import.meta.glob`. |
| Base contents (on disk) | `src/client.ts` (`getDb(d1)` → `drizzle(d1, { schema })`), the glob barrel `src/schema/index.ts`, `src/repositories/` (`.gitkeep`), `drizzle.config.ts`, `package.json`, `tsconfig.json`. **No sample table/migration** — a throwaway table would pollute every consumer; the convention is proven in `.dev/` by dropping one, and for real by `waitlist` later. |
| Runtime binding type | `@db` **exports `DbBindings = { DB: D1Database }`.** A feature route types `new Hono<{ Bindings: DbBindings }>()` and reads `c.env.DB` — so **no code-level patch to api's entry** is needed; only the structural `wrangler.jsonc` patch. |
| Repository layer | A **documented convention**, not an auto-glob extension point — a repository is a thin function taking `db`, imported directly by the route that uses it (no auto-registration needed, unlike `routes/`). Base ships an empty `src/repositories/`; concrete repositories arrive with features. |
| Migrations — control | **Fully manual, three explicit scripts, never autopush/automigrate.** All live in `packages/db` (self-contained): `db:generate` = `drizzle-kit generate`; `db:migrate:local` / `db:migrate:prod` = `wrangler d1 migrations apply DB --local` / `--remote`, reaching into api via `--config ../../apps/api/wrangler.jsonc` (+ `--persist-to ../../apps/api/.wrangler/state` locally so writes share the sqlite `vite dev` reads). |
| Migrations — build-time caveat | `--persist-to` must match the `@cloudflare/vite-plugin` local sqlite dir or a route write won't round-trip; **fallback** = move the migrate scripts into `apps/api`. Verified when standing up `.dev/`. |
| D1 binding patch | `database` patches `apps/api/wrangler.jsonc`: `d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "local" (placeholder), migrations_dir: "../../packages/db/migrations" }]`. Local dev ignores `database_id`; the skill tells users to `wrangler d1 create` + paste the real id for `--remote`. |
| `patches` serialization | **Flat array with a `file` field** per op: `[{ "file": "apps/api/wrangler.jsonc", "kind": "wrangler-binding", "bindingType": "d1_databases", "entry": {…} }]`. Maps to the engine's `applyPatch(source, patch, filename)`. Retype schema `patches` **object → array**; flip `modules/api/registry-item.json` `"patches": {}` → `"patches": []`. (ADR.) |
| Applier change | `executePlan` **applies** patches (was deferred): for each op, read `file`, call `applyPatch`, write the result; `--dry-run`/`--diff` render the engine's diff; idempotent per the engine. |
| `dependencies[]` | **Empty** — a capability owns the `package.json` it scaffolds and declares deps there (ADR 0013). Pinned at build time: `drizzle-orm` (runtime), `drizzle-kit` / `wrangler` / `@cloudflare/workers-types` (dev), `@repo/tsconfig` (`workspace:*`), `typescript`. |
| `envVars` | **Empty** — D1 is a binding, not a secret. |
| Agent context | Ships `skills/saasaloy-database/SKILL.md` (barrel convention, repo pattern, the three manual scripts, `c.env.DB`/`DbBindings`, placeholder-id → remote flow), listed in `agent.skills`, `saasaloy-`-prefixed (ADR 0014). |
| Acceptance / DoD | **Local** is the DoD: `saasaloy add database` in `.dev/` scaffolds `packages/db` + patches the D1 binding; a dropped `schema/*.ts` is exported via the barrel; `db:generate` emits SQL and `db:migrate:local` applies it; a route reading `c.env.DB` round-trips a row. `db:migrate:prod` (`--remote`) ships but is **not** proven here (needs a real CF account — deferred, mirroring `api`'s deferred edge deploy). |

## Approach

### Phase 1 — Descriptor (`modules/database/registry-item.json`)
- `name: "database"`, `type: "saasaloy:capability"`, `dependsOn: ["api"]`, empty `dependencies`/`envVars`.
- One `scaffolds[]` entry: `workspace: "packages/db"`, `aliases: { "@db": "packages/db/src" }`, files below.
- `patches[]` (array): the single `wrangler-binding` op targeting `apps/api/wrangler.jsonc`.
- `agent.skills: ["skills/saasaloy-database"]`.
- Validate through `validateRegistryItem`; **retype the schema's `patches` object → array** of
  `{ file, kind, … }` ops (tighten from the current freeform `additionalProperties: true`).

### Phase 2 — Applier: apply patches (was deferred)
- `executePlan` resolves each patch's `file`, reads it, calls `applyPatch(source, { kind, … }, file)`,
  writes the result; `--dry-run`/`--diff` surface the engine's diff. Idempotent (engine guarantees).
- Replace the `Object.keys(item.patches).length` deferral check with the array form; drop `database`
  from `deferredPatches`. Flip `modules/api/registry-item.json` `"patches": {}` → `[]`.
- Patched files are **not** manifest-tracked as managed copies (a patch mutates a file another module
  owns) — clean `remove` of a patch is a known gap (see below).

### Phase 3 — Scaffold files (`modules/database/files/`)
- `src/client.ts` — `getDb(d1)` → `drizzle(d1, { schema })`; export `DbBindings = { DB: D1Database }`.
- `src/schema/index.ts` — empty-safe `import.meta.glob` barrel merged into one `schema` object.
- `src/repositories/.gitkeep` — the convention folder, empty in base.
- `drizzle.config.ts` (dialect `sqlite`, `schema: './src/schema/*.ts'`, `out: './migrations'`),
  `package.json` (deps per the convention; the three `db:*` scripts), `tsconfig.json`
  (extends `@repo/tsconfig`, `vite/client` types for the barrel).

### Phase 4 — Skill runbook (`modules/database/skills/saasaloy-database/SKILL.md`)
- The schema-barrel convention (drop `schema/x.ts`) and its dual mechanism; the repository pattern
  (thin fn taking `db`); the three manual migration scripts + local/prod; `c.env.DB` + `DbBindings`
  (never `process.env`); the placeholder `database_id` → `wrangler d1 create` for remote; a pointer
  that remote deploy is the future `infra` module's job.

### Phase 5 — Exercise in `.dev/`
- `saasaloy add api && saasaloy add database` (dep order), confirm the D1 binding is patched into
  `apps/api/wrangler.jsonc` and `@db` is registered. Drop a `schema/waitlist.ts`, `db:generate` →
  SQL, `db:migrate:local` → applied, a temporary route reading `c.env.DB` round-trips a row on
  `vite dev`. **Verify `--persist-to` shares state with the vite-plugin**; if not, apply the fallback.

## Open questions

Thin spots (none block `database`; logged for the owners):

- **Local-state alignment.** Exact `--persist-to` path vs. what `@cloudflare/vite-plugin` uses for
  the local D1 sqlite — settle when standing up `.dev/`; fallback is migrate-scripts-in-`apps/api`.
- **Patch removal.** A patched `wrangler.jsonc` isn't a clean copy, so `saasaloy remove` can't undo it
  by hash. Reverse-patching belongs to `remove` (#27), not here.
- **`--remote` end-to-end.** Proving `db:migrate:prod` against real D1 needs a CF account + created DB;
  deferred to `infra` (#29) / end-to-end QA.
- **Toolchain version pins.** Exact `drizzle-orm` / `drizzle-kit` / `wrangler` / `@cloudflare/workers-types`
  versions — settled at build time against current.
- **Barrel edge cases.** Nested `schema/` dirs and name collisions — v1 is flat-folder; document the rule.

## Non-goals

- **Postgres / multi-cloud** — cut per build-spec §2.2/§2.3; D1 only.
- **A sample table/migration in base** — the barrel + repo conventions are proven in `.dev/` and by
  `waitlist`, not shipped as junk in every consumer.
- **Any feature module** (`waitlist`, …) or its `schema/*.ts` + repositories — they `dependsOn: ["database"]` and land later.
- **Remote/edge deploy + `wrangler d1 create`** — the `db:migrate:prod` script ships, but real remote
  application is the future `infra` capability's job (#29), not this module's.
- **Reverse-patching / `remove`** — owned by #27.
</content>
</invoke>
