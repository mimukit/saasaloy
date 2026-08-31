# Plan: dialect-neutral auth and waitlist payloads (#99)
Grilled: 2026-08-31

## Context

ADR 0026 split the database capability into a dialect-agnostic core (`modules/database`) and two driver modules (`database-d1`, `database-postgres`), and claimed downstream modules need no driver branch. The shipped payloads contradict that claim. `auth` and `waitlist` are D1-bound in three ways: their schema files import `drizzle-orm/sqlite-core`, `auth` hardcodes `drizzleAdapter(getDb(authEnv.DB), { provider: "sqlite" })` and a `D1Database` env type, and their skills document only D1 commands. Issue #98 declares a `dependsOn: ["database-d1"]` stopgap so `add` refuses the broken Postgres combination. This plan is the end state issue #99 tracks: both modules install cleanly against either driver, the stopgap goes away, and ADR 0026's amendment points at the fixed contract.

Success means `saasaloy add auth` and `saasaloy add waitlist` produce a working, type-checking app under `database-d1` and under `database-postgres`, verified in `.dev`.

The driver-split record is **ADR 0026**, not 0023. It was renumbered on 2026-08-31 under #98 because five records shared 0023, and every "ADR 0023" in the first draft of this plan and in issue #99's body meant this one. Both are corrected.

**#98 is merged** (PR [#101](https://github.com/mimukit/saasaloy/pull/101), 2026-08-31). `requiresOneOf`, the `dependsOn: ["database-d1"]` stopgap, the Postgres `withDb` helper and the unified `listModuleFiles` are all on main. Nothing in this plan is blocked.

## The problem the first draft missed

The first draft settled the *type* branch and left the *connection lifetime* branch unsolved, which would have shipped an `auth` that type-checks on Postgres and throws on its second request.

`modules/auth/files/src/auth.ts:45` binds one client at module scope. That is deliberate and documented at `auth.ts:38-44`: the Better Auth plugin-array patch point needs a module-scope `export const`. Postgres cannot live with it. `modules/database-postgres/files/src/client.ts:51-57` states the rule plainly, because a Workers isolate outlives the request that created it while an open socket does not: reusing one postgres.js instance across requests throws `Cannot perform I/O on behalf of a different request`. `drizzleAdapter` offers no way out, since its signature is `(db: DB, config: DrizzleAdapterConfig) => ...` (`@better-auth/drizzle-adapter/dist/index.d.mts:61`) and takes a bound instance rather than a factory.

The failure needs two requests into one isolate. One manual sign-in passes, which is why the first draft's QA step would not have caught it.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Payload shape | Conditional files. The descriptor gains a small per-file condition keyed on the installed driver; each module ships a sqlite and a pg variant of only the dialect-bound files (schemas, auth adapter config). One module per capability, no abstraction layer. Rejected: per-driver feature modules (doubles module count, duplicates neutral files); a `defineTable` neutral schema layer (fights Drizzle's per-dialect design). |
| `getDb` contract | Both drivers export `getDb(env: DbBindings)`. `database-d1` changes to take the whole env and read `env.DB` internally, matching Postgres. Feature routes call `getDb(c.env)` under either driver and stop branching. |
| Why not a repository layer | Drizzle's query builder is already dialect-neutral at call time; a repository only relocates the branch. The coupling lives in the table declarations (`sqliteTable` vs `pgTable`), which the feature module owns. Conditional files scope the branch to those declarations. |
| Skills | Neutralize `auth` and `waitlist` skills. They name no migration or wrangler commands and defer to the installed driver's skill for `db:migrate` specifics. No skill variants, no new skill mechanism. |
| Stopgap | Removed. `auth` and `waitlist` revert to `dependsOn: ["api", "database", ...]`; the driver guarantee comes from `database`'s `requiresOneOf` (#98) plus the conditional-file selection. |
| Condition semantics | `onlyWith: "<module-name>"` on a file entry: the file installs only when that module is in the resolved install set (this run's graph plus modules already installed per config/lock). Literal module names, no capability-group concept. |
| Where the condition is enforced | Inside `listModuleFiles` (`packages/cli/src/lib/applier.ts:167`), which takes the resolved install set as a new parameter. #98 already made that function the one place the three file rules live, covering top-level `files[]`, each scaffold's workspace files, and each `agent.skills` folder, and both engines already call it: `buildPlan` at `applier.ts:387` and `buildUpdatePlan` at `updater.ts:541-542`. One filter therefore covers both arrays and both engines. This matters for more than tidiness: `auth`'s `src/auth.ts` and the new `src/db-provider.ts` live in `scaffolds[0].files[]`, not in top-level `files[]`, so the first draft's wording would have left every scaffold file unconditional. Rejected: filtering in `buildPlan` only, which would leave `update` diffing against a set `add` never wrote and let it reinstate a filtered-out variant; filtering separately in each engine, which re-creates the exact write-path drift `applier.ts:158-165` records #98 as having removed. |
| No matching variant | Hard error at plan time in `buildPlan`, naming the target and the candidate conditions, same exit path as conflicts. `requiresOneOf` should make this unreachable; the error is the backstop. |
| Driver switch | Documented, not tooled: switching drivers means removing and re-adding dependent feature modules too. One paragraph in the ADR amendment plus a line in both driver skills. The unchosen variant is filtered before planning, so lock and drift detection only ever see installed files; no mechanism change. |
| Cleanup contract | Both drivers export the same `withDb`-style helper; D1's is a pass-through. Route files stay single-source. #98 settled the signature and it is on main: `withDb<T>(c: DbRequestContext, body: (db: Db) => Promise<T>)`, where `DbRequestContext` is structural (`env` plus `executionCtx`) so `packages/db` takes no `hono` dependency (`database-postgres/files/src/client.ts:88-135`). This plan consumes it unchanged, and Phase 2 gives D1 the matching one. |
| Auth config split | One neutral `auth.ts` plus a tiny per-driver `files/src/db-provider.ts` variant (selected via `onlyWith`) exporting the `"sqlite" \| "pg"` provider string, the env shape, the `authDb` the adapter binds, and `withAuthScope`. No full `auth.ts` variants, no runtime dialect detection. |
| Auth connection lifetime | An `AsyncLocalStorage` plus a db proxy, both inside `db-provider.ts`. `auth.ts` keeps its module-scope `export const auth` and changes one line to `database: drizzleAdapter(authDb, { provider })`. `authDb` is a `Proxy` whose traps read the current request's Drizzle client out of the ALS. Three facts make this the cheap option: `modules/auth/registry-item.json:34-35` already adds the `nodejs_compat` compatibility flag, so `node:async_hooks` is available with no descriptor change; the adapter's `DB` type is `{ [key: string]: any }` (`index.d.mts:8`), so the proxy needs no cast; and the plugin-array patch point survives untouched. Rejected: a per-request `createAuth(env)` factory (kills the module-scope export, so `packages/cli/src/lib/patch/ts-module.ts` would have to patch inside a function body, and `betterAuth()` rebuilds per request); swapping `database-postgres` to `drizzle-orm/neon-http` (stateless and safe at module scope, but it discards #98's postgres.js work, adds a vendor tie and drops Hyperdrive); narrowing #99 so `auth` stays D1-only. |
| Who closes the socket | The route wrapper, via `withAuthScope`. `modules/auth/files/api/routes/auth.ts` is the only code consumer of `@repo/auth/server` in the whole registry, and it holds `c`, so it has both `c.env` and `c.executionCtx`. The pg variant's `withAuthScope(c, fn)` is `withDb(c, (db) => dbScope.run(db, fn))`, which reuses #98's cleanup helper unchanged. |
| D1 goes through the ALS too | Both variants use the ALS, and the two files differ only in what `withAuthScope` does after entering the scope: pg wraps `withDb`, D1 runs the body. A route that forgets the scope then throws identically under both drivers. Rejected: binding `getDb(env)` directly on D1 with a pass-through wrapper. D1 is the default driver, so most development happens there, and the permissive version means a route written and tested on D1 works, ships, and throws only after the Postgres switch, which is after the data migration rather than during it. The cost is one object lookup per auth call on D1. |
| `getSession` signature | `getSession(c)` under both drivers, scoping internally. The proxy throws outside the ALS, and a user's protected route is not inside auth's own route wrapper, so the recipe at `modules/auth/skills/saasaloy-auth/SKILL.md:127` has to change. Its parameter type is structural and reuses the shape already at `database-postgres/files/src/client.ts:93`, extended with `req.raw`, so `packages/auth` still takes no `hono` dependency. Rejected: keeping `getSession(request)` with a fallback that opens its own client when the ALS is empty (that path has no `executionCtx`, so the socket closes with nothing holding the isolate open for it, which is the leak `client.ts:98-114` warns about); exporting `withAuthScope` for the caller to wrap by hand (forgetting it type-checks, passes on D1, and throws on Postgres). |
| Regression coverage | A `node --test` unit test on the `db-provider.ts` contract, plus a two-request manual QA case with both assertions named. The unit test asserts that `authDb` throws outside a scope and resolves the correct client inside one, which is the contract the runtime failure violates. Rejected: adding `@cloudflare/vitest-pool-workers` to exercise a real isolate (it proves the real thing, but the repo runs `node --test` over `modules/*/files/**/*.test.ts` per `package.json:27` and this would add a second runner and a bootable wrangler config for one regression); a CLI-level variant-selection test alone (proves the right file lands, nothing about the second request); manual QA alone, which is what let this through. |
| ADR | Two records. A new `adr-0029-auth-holds-a-request-scoped-db-client` owns the scope contract and its consequence, that every `auth.api` call runs inside `withAuthScope` on both drivers. ADR 0026's 2026-08-31 amendment is cut down to retracting the D1 pin and pointing at 0029. Rejected: folding both into 0026, which would bury an auth-lifetime decision inside a record titled for the driver split. **domainkit** writes 0029. |
| Pg schema details | `waitlist.id` uses `generatedAlwaysAsIdentity()`, not `serial`. Timestamp defaults are idiomatic per dialect: `defaultNow()` on pg, the existing `unixepoch('subsecond') * 1000` default on sqlite. Parity is semantic (millisecond timestamps), not textual. |
| Workers types under Postgres | `modules/auth`'s `tsconfig.json` and `@cloudflare/workers-types` devDependency stay unconditional; the app targets Workers either way. Conditional dependencies are out of scope for the Phase 1 mechanism. |
| Issue shape | All five phases stay under issue #99 as one unit of work; no separate CLI-mechanism issue. |

## Approach

Reuses: the existing descriptor pipeline (`packages/cli/src/lib/resolve.ts`, `conflicts.ts`, `applier.ts`), the lock/config machinery that already records installed modules, the `database` core's glob-merged `src/schema.ts` (dialect-agnostic, untouched), the driver modules' existing `client.ts` payloads, and #98's `requiresOneOf` and Postgres `withDb` helper.

### Phase 1: descriptor condition mechanism (#99)

- Add the optional `onlyWith: "<module-name>"` condition to `registry-item.schema.json`, on both top-level `files[]` entries and `scaffolds[].files[]` entries: the file installs only when the named module is in the resolved install set (this run's graph plus already-installed modules from config/lock).
- Implement selection in `listModuleFiles` (`packages/cli/src/lib/applier.ts:167`), which gains the resolved install set as a parameter and filters both arrays before recording a target. `buildPlan` (`applier.ts:387`) and `buildUpdatePlan` (`updater.ts:541-542`) inherit it with no filter of their own. Update the function's doc comment at `applier.ts:158-165` to name the condition as its fourth rule.
- Two variant entries for the same `target` with disjoint conditions must be legal. A target whose entries are all conditional and none match is a hard plan-time error naming the target and candidates.
- Unit tests: variant selection under each driver, selection inside a scaffold rather than only in top-level `files[]`, the no-match error, `update` seeing exactly the set `add` wrote, and `plan`/`diff` output showing which variant was chosen.

### Phase 2: normalize the D1 client contract (#99)

- Change `modules/database-d1/files/src/client.ts` to `getDb(env: DbBindings)` reading `env.DB` internally; keep `DbBindings { DB: D1Database }`.
- Align the cleanup contract with #98's Postgres `withDb` helper so a single route body works on both drivers (D1 side is a no-op).
- Update the `database`, `database-d1`, and `database-postgres` skills for the one call shape.

### Phase 3: waitlist goes neutral (#99)

- Split `modules/waitlist/files/db/schema/waitlist.ts` into sqlite and pg variants (pg: identity/serial id, `timestamp` column) selected via `onlyWith`.
- Rewrite `files/api/routes/waitlist.ts` as one neutral file: `getDb(c.env)`, driver-neutral cleanup per Phase 2. `.onConflictDoNothing()` already works on both dialects.
- Neutralize the waitlist skill's migration references.

### Phase 4: auth goes neutral (#99)

- Split `modules/auth/files/db/schema/auth.ts` into sqlite and pg variants; the pg variant replaces the `unixepoch('subsecond')` default and `integer` timestamp mappings with Better Auth's pg-adapter mapping.
- Add `files/src/db-provider.ts` in two variants, selected via `onlyWith` inside `scaffolds[0].files[]`. Each exports four things: `provider` (`"sqlite" | "pg"`), the driver's binding shape, `authDb` (the ALS-backed proxy the adapter binds), and `withAuthScope(c, fn)`. The two files differ only in `withAuthScope`: the pg variant is `withDb(c, (db) => dbScope.run(db, fn))`, the D1 variant is `dbScope.run(getDb(c.env), fn)`.
- Change `files/src/auth.ts` in one line: `database: drizzleAdapter(authDb, { provider })`. The module-scope `export const auth` stays, and so does the `cloudflare:workers` importable `env` that supplies `BETTER_AUTH_URL`, the secret and `CORS_ORIGINS` at module scope. Only the db becomes request-scoped. Move the `DB: D1Database` field out of `AuthBindings` into the D1 `db-provider.ts` variant, and rewrite the comment at `auth.ts:38-44` so it records the scope contract alongside the patch-point reason.
- Rewrite `files/api/routes/auth.ts` as one neutral file wrapping the handler: `withAuthScope(c, () => auth.handler(c.req.raw))`. It keeps importing only from `@repo/auth/server`, never `better-auth` (ADR 0020).
- Change `files/src/server.ts` so `getSession` takes `c` and scopes internally, and re-export `withAuthScope`.
- Add `files/src/db-provider.test.ts` under the existing `node --test` glob: `authDb` throws outside a scope, and resolves the current request's client inside one. Both variants ship the test.
- Neutralize the auth skill's D1 command references, and update the protected-route recipe at `SKILL.md:127` to the new `getSession(c)` signature.

### Phase 5: remove the stopgap, amend the ADR, verify (#99)

- Revert `auth` and `waitlist` `dependsOn` to their pre-stopgap values; delete the `dependsOn: ["database-d1"]` entries #98 added.
- Write `docs/adr/adr-0029-auth-holds-a-request-scoped-db-client-2026-08-31.md` with **domainkit**: the module-scope singleton stays, the db behind it is request-scoped, and every `auth.api` call runs inside `withAuthScope` on both drivers.
- Cut ADR 0026's 2026-08-31 amendment down: it currently says `auth` and `waitlist` "pin D1 until they get one", which Phase 5 makes false. Retract the D1 pin, keep the correction to the "no branch needed" consequence at `adr-0026-database-driver-split-2026-08-28.md:19`, and point at 0029 for the contract that replaced it.
- Manual QA in `.dev`, both drivers: scaffold, add the driver, add `auth` + `waitlist`, typecheck, migrate, exercise the waitlist route. Postgres runs in a local container, since this box has a Docker daemon and no `psql` client.
- The auth QA case names two assertions, never one: sign in and get a cookie, then call a protected route on the **same** worker and get a 200 rather than `Cannot perform I/O on behalf of a different request`. A single sign-in passes on a broken build, which is how the first draft's QA step missed this.
- Close the loop on issue #99's checklist.

## Open questions

None. Two grills on 2026-08-31 settled all of them; see the decisions table. The second grill ran after the #99 spec gate found the connection-lifetime gap the first draft left open, and it settled six decisions: the ALS-and-proxy shape, who closes the socket, D1 going through the ALS too, the `getSession(c)` signature, the regression coverage, and the two-ADR split.

Two implementation-time lookups remain, both facts rather than decisions:

- Better Auth's exact pg drizzle-adapter type mapping, when writing the pg schema variant. Read it from the Better Auth docs.
- Which traps the proxy needs. The adapter reaches `db.select`, `db.insert`, `db.update` and `db.delete`; `DrizzleAdapterConfig.transaction` defaults to `false`, so `db.transaction` should not be reached, and the plan does not turn it on.

## Non-goals

- No repository layer in `@repo/db`; routes keep using the Drizzle query builder directly.
- No data migration between drivers; switching stays remove-then-add per ADR 0026.
- No third driver and no runtime driver selection; the choice stays install-time.
- No changes to the email/sms/logger provider pattern; drivers remain a distinct shape per `create-provider`'s boundary.
- #98's own scope (stopgap, `requiresOneOf`, driver prompt, Postgres `withDb`) is not re-planned here.
