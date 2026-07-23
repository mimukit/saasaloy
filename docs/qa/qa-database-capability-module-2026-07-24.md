# QA Plan: `database` capability module

_Generated 2026-07-24 · covers the uncommitted `database` module + applier patch-wiring (issue #9)_

## Summary
- `saasaloy add database` scaffolds `packages/db` (Drizzle + D1), pulls `api` first, and patches the D1 binding into `apps/api/wrangler.jsonc`; a dropped `src/schema/*.ts` is auto-exported and its migration generates + applies against local D1.
- "Working" means: the workspace lands and links, the binding is wired, and a route reading `c.env.DB` round-trips a row after a generated migration is applied locally.

## Preconditions
- Branch `issue-9-database-capability-module`, with the uncommitted changes in the working tree.
- The applier is exercised against the **local** registry (`SAASALOY_REGISTRY_DIR=<repo>/modules`) via the playground shim — no network registry needed.
- A **fresh** playground so nothing from prior runs masks a real result. Build the CLI, then create it (this leaves it uninstalled on purpose):

```sh
pnpm --filter saasaloy build
pnpm run play:reset
```

- The automated section below already ran `add database` into `.dev/playground`; for the manual cases, **reset first** (above) so you start from a clean, unlinked workspace, then install deps:

```sh
cd .dev/playground
./saasaloy add database --yes
pnpm install
```

- `pnpm install` fetches `drizzle-orm` / `drizzle-kit` / `wrangler` / `vite`; the workspace pins them exactly and `minimumReleaseAge` (3 days) can quarantine a too-new version — see TC-6.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | `pnpm install` links both workspaces and `@repo/db` typechecks | 🔴 Critical |
| TC-2 | Drop a table → `db:generate` emits reviewable SQL | 🔴 Critical |
| TC-3 | `db:migrate:local` + route round-trips a row via `c.env.DB` | 🔴 Critical |
| TC-4 | Barrel auto-exports a second dropped table (no edits) | 🟡 Normal |
| TC-5 | Re-add `database` does not clobber the patched binding | 🟡 Normal |
| TC-6 | Version pins resolve under the release-age cooldown | 🟡 Normal |
| TC-7 | Repository pattern typechecks against a directly-imported table | 🟡 Normal |
| TC-8 | Remote flow reads correctly (`wrangler d1 create` → prod script) | 🟢 Low |

## Test cases

### TC-1 — `pnpm install` links both workspaces and `@repo/db` typechecks  ·  🔴 Critical
**Steps**
1. From a fresh `add database` (see Preconditions), run:

```sh
pnpm install
pnpm --filter @repo/db typecheck
```

**Expected**
- `pnpm install` completes; `packages/db` and `apps/api` are linked as workspaces (no `@repo/*` unresolved errors).
- `tsc --noEmit` in `packages/db` passes — importantly, the barrel's `import.meta.glob` in `src/schema.ts` resolves (the `vite/client` type is found).
- `D1Database` in `src/client.ts` resolves from `@cloudflare/workers-types`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Drop a table → `db:generate` emits reviewable SQL  ·  🔴 Critical
**Steps**
1. Create `packages/db/src/schema/waitlist.ts`:

```ts
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const waitlist = sqliteTable("waitlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

2. Generate the migration:

```sh
pnpm --filter @repo/db db:generate
```

**Expected**
- A new SQL file appears under `packages/db/migrations/`.
- The SQL contains `CREATE TABLE ... waitlist` with the three columns.
- No error about `import.meta.glob` — i.e. drizzle-kit read `src/schema/*.ts` and did **not** try to load the `src/schema.ts` barrel.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — `db:migrate:local` + route round-trips a row via `c.env.DB`  ·  🔴 Critical
**Steps**
1. Apply the migration to local D1:

```sh
pnpm --filter @repo/db db:migrate:local
```

2. Add a temporary route `apps/api/src/routes/waitlist.ts` that writes then reads a row via `getDb(c.env.DB)` (per the `saasaloy-database` skill).
3. Start the Worker and hit the route:

```sh
pnpm --filter @repo/api dev
curl -X POST http://localhost:5173/waitlist -d '{"email":"a@b.com"}'
curl http://localhost:5173/waitlist
```

**Expected**
- `db:migrate:local` reports the migration applied (no "no migrations to apply").
- The POST succeeds and the GET returns the inserted row.
- **Critically:** the row persists — i.e. the SQLite `db:migrate:local` wrote to (`--persist-to ../../apps/api/.wrangler/state`) is the **same** store `vite dev` reads. If the GET is empty, the `--persist-to` path is misaligned with `@cloudflare/vite-plugin` (the plan's known open question — fallback: move the migrate scripts into `apps/api`).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — Barrel auto-exports a second dropped table (no edits)  ·  🟡 Normal
**Steps**
1. Drop a second `packages/db/src/schema/feedback.ts` (any table).
2. Without editing `src/schema.ts` or `drizzle.config.ts`:

```sh
pnpm --filter @repo/db db:generate
```

3. Rebuild/refresh the Worker and confirm both tables are queryable.

**Expected**
- The new migration includes `feedback` too.
- Nothing in `src/schema.ts` or `drizzle.config.ts` was touched — the drop alone fed both the runtime barrel and drizzle-kit.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Re-add `database` does not clobber the patched binding  ·  🟡 Normal
**Steps**
1. After a successful `add database`, run it again:

```sh
./saasaloy add database --yes --force
```

2. Inspect `apps/api/wrangler.jsonc`.

**Expected**
- `apps/api/wrangler.jsonc` still has exactly **one** `d1_databases` entry (no duplicate), with the original comment intact.
- Because a patched file isn't manifest-tracked, `wrangler.jsonc` may be reported as `drift → merge` in the plan — confirm that this **holds it back rather than overwriting** the binding (the patch is re-applied idempotently on top). This is the known #27 gap; it must not destroy the binding.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — Version pins resolve under the release-age cooldown  ·  🟡 Normal
**Steps**
1. On a clean install (TC-1), watch the `pnpm install` output for any pin that can't be satisfied.

**Expected**
- `drizzle-orm@0.44.5`, `drizzle-kit@0.31.5`, `wrangler@4.113.0`, `vite@8.1.5`, `@cloudflare/workers-types@5.20260723.1` all install.
- No `engineStrict` failure and no version quarantined by `minimumReleaseAge` that blocks the install. If one is blocked or missing, bump the pin in `modules/database/files/package.json` (pins were chosen at build time and flagged for confirmation here).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — Repository pattern typechecks against a directly-imported table  ·  🟡 Normal
**Steps**
1. Add `packages/db/src/repositories/waitlist.ts` importing the table **directly** (not off the barrel), per the skill:

```ts
import { waitlist } from "@db/schema/waitlist";
import type { getDb } from "@db/client";

export function listWaitlist(db: ReturnType<typeof getDb>) {
  return db.select().from(waitlist);
}
```

2. Typecheck:

```sh
pnpm --filter @repo/db typecheck
```

**Expected**
- Passes — `db.select().from(waitlist)` is fully typed because the table is imported from its own file (the merged barrel is intentionally loose and is only for `getDb`'s runtime `schema`).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — Remote flow reads correctly  ·  🟢 Low
**Steps**
1. Read the `saasaloy-database` skill's remote section and the `db:migrate:prod` script.
2. (Optional, needs a real Cloudflare account) `wrangler d1 create app-db`, paste the id into `apps/api/wrangler.jsonc`, run `db:migrate:prod`.

**Expected**
- The documented flow is coherent: placeholder `database_id: "local"` works for local; remote needs a real id from `wrangler d1 create`.
- No claim that production application is automated — it's manual, and centralized deploy is deferred to a future `infra` module.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `./saasaloy add api` alone still scaffolds `apps/api` and its `routes/health.ts` (the `database` change didn't disturb the api capability).
- [ ] `apps/api` still builds/serves the `/health` route after the wrangler.jsonc patch.
- [ ] Skill symlinks for **both** `saasaloy-api` and `saasaloy-database` are created under `.claude/skills/` pointing into `.agents/skills/`.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run (grouped where related):

```sh
pnpm test
pnpm typecheck
pnpm lint
# descriptor + example validation against the retyped schema (ad-hoc ajv)
# real end-to-end apply into a throwaway playground:
pnpm --filter saasaloy build
node packages/cli/dist/index.js init .dev/playground --force --no-install
SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js add database --dry-run --yes
SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js add database --yes
SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js add database --yes --force
```

- ✅ `pnpm test` → **63 passed** (incl. 8 new patch tests: buildPlan apply/unchanged/missing, executePlan writes-not-tracked/idempotent/conflict, schema accept/reject-missing-file/reject-legacy-object).
- ✅ `pnpm typecheck` → clean (`tsc --noEmit`).
- ✅ `pnpm lint` → no lint task defined in the package (nothing to run).
- ✅ Schema validation → `database`, `api`, and the example descriptor all **VALID** against the array-typed `patches` schema.
- ✅ `add database --dry-run` → resolved `api → database`, planned **15 files** across `apps/api` + `packages/db`, registered `@api` + `@db`, planned both skill links, and previewed the **Config patches** section listing `apps/api/wrangler.jsonc — wrangler-binding`.
- ✅ `add database` (real) → applied 15 files and the patch; `apps/api/wrangler.jsonc` gained the `d1_databases` binding (`DB` / `app-db` / `database_id:"local"` / `migrations_dir:"../../packages/db/migrations"`) **with the file's existing comment preserved** (jsonc-parser, not a reserialize).
- ✅ `add database --yes --force` (re-apply) → `apps/api/wrangler.jsonc` still has exactly **one** `d1_databases` block — patch is idempotent, no duplication.
- ✅ Scaffold shape on disk → `packages/db/{package.json,tsconfig.json,drizzle.config.ts,src/client.ts,src/schema.ts,src/schema/.gitkeep,src/repositories/.gitkeep}` all present; barrel is the `src/schema.ts` sibling (not `src/schema/index.ts`), keeping it out of drizzle-kit's glob.

## Not covered / needs human judgment
- **`pnpm install` of the scaffold deps** — the agent ran with `--no-install`, so drizzle/wrangler/vite were never fetched; TC-1/TC-6 need a human to confirm the exact pins resolve under the cooldown.
- **`db:generate` / `db:migrate:local` actually running** — needs drizzle-kit + wrangler installed; TC-2/TC-3.
- **The `--persist-to` ↔ `@cloudflare/vite-plugin` alignment** (TC-3) — the one empirical the plan flagged; only a real migrate + `vite dev` round-trip proves it, and a human must judge the fallback if it fails.
- **`--remote` / production D1** — needs a real Cloudflare account; deferred to `infra` (#29). TC-8 is doc-review only.
- **Drizzle version-pin currency** — pins were chosen at build time without a live registry check.
