# Plan: dialect-neutral auth and waitlist payloads (#99)
Grilled: 2026-08-31

## Context

ADR 0023 split the database capability into a dialect-agnostic core (`modules/database`) and two driver modules (`database-d1`, `database-postgres`), and claimed downstream modules need no driver branch. The shipped payloads contradict that claim. `auth` and `waitlist` are D1-bound in three ways: their schema files import `drizzle-orm/sqlite-core`, `auth` hardcodes `drizzleAdapter(getDb(authEnv.DB), { provider: "sqlite" })` and a `D1Database` env type, and their skills document only D1 commands. Issue #98 declares a `dependsOn: ["database-d1"]` stopgap so `add` refuses the broken Postgres combination. This plan is the end state issue #99 tracks: both modules install cleanly against either driver, the stopgap goes away, and ADR 0023's amendment points at the fixed contract.

Success means `saasaloy add auth` and `saasaloy add waitlist` produce a working, type-checking app under `database-d1` and under `database-postgres`, verified in `.dev`.

**Blocked by #98.** The `requiresOneOf` mechanism, the stopgap, and the Postgres `withDb` helper land there first. Nothing from #98 is on main today, so every phase below assumes #98 merged.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Payload shape | Conditional files. The descriptor gains a small per-file condition keyed on the installed driver; each module ships a sqlite and a pg variant of only the dialect-bound files (schemas, auth adapter config). One module per capability, no abstraction layer. Rejected: per-driver feature modules (doubles module count, duplicates neutral files); a `defineTable` neutral schema layer (fights Drizzle's per-dialect design). |
| `getDb` contract | Both drivers export `getDb(env: DbBindings)`. `database-d1` changes to take the whole env and read `env.DB` internally, matching Postgres. Feature routes call `getDb(c.env)` under either driver and stop branching. |
| Why not a repository layer | Drizzle's query builder is already dialect-neutral at call time; a repository only relocates the branch. The coupling lives in the table declarations (`sqliteTable` vs `pgTable`), which the feature module owns. Conditional files scope the branch to those declarations. |
| Skills | Neutralize `auth` and `waitlist` skills. They name no migration or wrangler commands and defer to the installed driver's skill for `db:migrate` specifics. No skill variants, no new skill mechanism. |
| Stopgap | Removed. `auth` and `waitlist` revert to `dependsOn: ["api", "database", ...]`; the driver guarantee comes from `database`'s `requiresOneOf` (#98) plus the conditional-file selection. |
| Condition semantics | `onlyWith: "<module-name>"` on a `files[]` entry: the file installs only when that module is in the resolved install set (this run's graph plus modules already installed per config/lock). Literal module names, no capability-group concept. |
| No matching variant | Hard error at plan time in `buildPlan`, naming the target and the candidate conditions, same exit path as conflicts. `requiresOneOf` should make this unreachable; the error is the backstop. |
| Driver switch | Documented, not tooled: switching drivers means removing and re-adding dependent feature modules too. One paragraph in the ADR amendment plus a line in both driver skills. The unchosen variant is filtered before planning, so lock and drift detection only ever see installed files; no mechanism change. |
| Cleanup contract | Both drivers export the same `withDb(env, fn)`-style helper; D1's is a pass-through. Route files stay single-source. The exact signature is settled in #98; this plan consumes it. |
| Auth config split | One neutral `auth.ts` plus a tiny per-driver `files/src/db-provider.ts` variant (selected via `onlyWith`) exporting the `"sqlite" \| "pg"` provider string and the env shape. No full `auth.ts` variants, no runtime dialect detection. |
| Pg schema details | `waitlist.id` uses `generatedAlwaysAsIdentity()`, not `serial`. Timestamp defaults are idiomatic per dialect: `defaultNow()` on pg, the existing `unixepoch('subsecond') * 1000` default on sqlite. Parity is semantic (millisecond timestamps), not textual. |
| Workers types under Postgres | `modules/auth`'s `tsconfig.json` and `@cloudflare/workers-types` devDependency stay unconditional; the app targets Workers either way. Conditional dependencies are out of scope for the Phase 1 mechanism. |
| Issue shape | All five phases stay under issue #99 as one unit of work; no separate CLI-mechanism issue. |

## Approach

Reuses: the existing descriptor pipeline (`packages/cli/src/lib/resolve.ts`, `conflicts.ts`, `applier.ts`), the lock/config machinery that already records installed modules, the `database` core's glob-merged `src/schema.ts` (dialect-agnostic, untouched), the driver modules' existing `client.ts` payloads, and #98's `requiresOneOf` and Postgres `withDb` helper.

### Phase 1: descriptor condition mechanism

- Add the optional `onlyWith: "<module-name>"` condition to `registry-item.schema.json` `files[]` entries: the file installs only when the named module is in the resolved install set (this run's graph plus already-installed modules from config/lock).
- Implement selection in `buildPlan` (`packages/cli/src/lib/applier.ts`): filter `files[]` by condition before planning writes. Two variant entries for the same `target` with disjoint conditions must be legal. A target whose entries are all conditional and none match is a hard plan-time error naming the target and candidates.
- Unit tests: variant selection under each driver, the no-match error, `plan`/`diff` output shows which variant was chosen.

### Phase 2: normalize the D1 client contract

- Change `modules/database-d1/files/src/client.ts` to `getDb(env: DbBindings)` reading `env.DB` internally; keep `DbBindings { DB: D1Database }`.
- Align the cleanup contract with #98's Postgres `withDb` helper so a single route body works on both drivers (D1 side is a no-op).
- Update the `database`, `database-d1`, and `database-postgres` skills for the one call shape.

### Phase 3: waitlist goes neutral

- Split `modules/waitlist/files/db/schema/waitlist.ts` into sqlite and pg variants (pg: identity/serial id, `timestamp` column) selected via `onlyWith`.
- Rewrite `files/api/routes/waitlist.ts` as one neutral file: `getDb(c.env)`, driver-neutral cleanup per Phase 2. `.onConflictDoNothing()` already works on both dialects.
- Neutralize the waitlist skill's migration references.

### Phase 4: auth goes neutral

- Split `modules/auth/files/db/schema/auth.ts` into sqlite and pg variants; the pg variant replaces the `unixepoch('subsecond')` default and `integer` timestamp mappings with Better Auth's pg-adapter mapping.
- Split or parameterize `files/src/auth.ts` so `provider: "sqlite" | "pg"` and the env typing follow the driver; drop the bare `D1Database` reference and, where possible, the `@cloudflare/workers-types` coupling under Postgres.
- Neutralize the auth skill's D1 command references.

### Phase 5: remove the stopgap, amend the ADR, verify

- Revert `auth` and `waitlist` `dependsOn` to their pre-stopgap values; delete the `dependsOn: ["database-d1"]` entries #98 added.
- Update ADR 0023's amendment: retract "no branch needed" fully, document the conditional-file end state and the normalized `getDb(env)` contract.
- Manual QA in `.dev`: scaffold, add each driver, add `auth` + `waitlist`, typecheck, migrate, exercise the waitlist route and an auth flow. Both drivers.
- Close the loop on issue #99's checklist.

## Open questions

None. The 2026-08-31 grill settled all of them; see the decisions table. One implementation-time lookup remains: confirm Better Auth's exact pg drizzle-adapter type mapping when writing the pg schema variant (a fact to read from Better Auth docs, not a decision).

## Non-goals

- No repository layer in `@repo/db`; routes keep using the Drizzle query builder directly.
- No data migration between drivers; switching stays remove-then-add per ADR 0023.
- No third driver and no runtime driver selection; the choice stays install-time.
- No changes to the email/sms/logger provider pattern; drivers remain a distinct shape per `create-provider`'s boundary.
- #98's own scope (stopgap, `requiresOneOf`, driver prompt, Postgres `withDb`) is not re-planned here.
