# Plan: authorization for the admin app

Grilled: 2026-08-31

Tracks issue #97.

## Context

`apps/admin` denies a non-admin in the browser and nowhere else. `modules/admin/files/src/routes/__root.tsx` throws `NotAdminError` from `beforeLoad`, and its own comment is honest about the limit: the server still authorizes every request, and the guard only stops the SPA from asking. The api has no authorization layer at all. `@repo/auth/server` exports one function, `getSession`, which answers *who* the caller is and never *whether they may act*. Today that gap is theoretical, because `/health` is the only route and it is public. It stops being theoretical the moment a feature module drops an administrative route into the chain, because that route inherits authentication and nothing else.

A second problem sits underneath. Nothing promotes the first admin. A fresh `saasaloy add admin` project scaffolds an admin app that every account is denied from, and the only way out is a `wrangler d1 execute` documented in the auth skill. The scaffold is not usable out of the box.

Success means three things. An api route can demand a role in one line. A fresh project produces a working admin on the first sign-up. The auth schema snapshot tells the truth about the version it mirrors.

### What issue #97 already got wrong

Most of #97's scope landed before it was written, in the admin-app work (`589e485`, `47830b4`, `0c0ceb4`). The issue body describes a `modules/admin/files/src/routes/_authed.tsx` that no longer exists, and a `docs/qa/qa-admin-capability-module-2026-08-27.md` that never did. Against the code on `f132d8d`:

| #97 claim | Reality on main |
|---|---|
| "no role concept exists today" in `modules/auth` | `plugins: [admin()]` is registered; `client.ts` pairs `adminClient()` |
| the schema needs the plugin's columns added | `role`, `banned`, `banReason`, `banExpires`, `session.impersonatedBy` are all present |
| the `_authed` guard should read the role | The root route's `beforeLoad` reads it and throws `NotAdminError` |
| #13's AC and the 08-27 QA plan need updating | That QA file does not exist; `qa-admin-app-module-2026-08-29.md` already tests the non-admin denial |
| `modules/database` needs the migration | Schema drops into `packages/db/src/schema/` and the existing `db:generate` picks it up; no module change |

So AC2 and AC5 are done. AC1 and AC3 are open. AC4 is open for a reason #97 did not know about: `modules/auth/files/package.json` pins `better-auth` at **1.7.2** while the snapshot header still claims verification against **1.6.25**. A `pnpm deps:update` bumped the dependency and the header rule was never run.

Issue #97's body is rewritten from this plan, keeping the number so the `critical` label and the thread back to PR #89's merge-risk note survive. It stays one issue.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the server gate lives | `requireSession` / `requireRole` / `requireAdmin` exported from `@repo/auth/server`, beside `getSession`. The alternative, a gate in `modules/api`, inverts the dependency: `auth` declares `dependsOn: ["api", ...]`, so api cannot import `@repo/auth`. This also settles #97's "auth or a new capability" question: the role concept is already in auth's plugin array, so the check belongs next to it. |
| Gate shape | Throwing helpers, not Hono middleware. Middleware needs a per-route wiring convention, and the `chained-route` patch kind (ADR 0028) registers routes, not `.use()` links. A throw reuses api's `onError`, so every deny answers with the one error body the api already publishes. |
| Role model | `requireRole(request, role)` is the primitive; `requireAdmin(request)` is `requireRole(request, ADMIN_ROLE)`. A second role later costs a new call site, not a rewritten helper. Better Auth's `ac`/`statements` permission layer stays out: one boolean does not need a permission model. |
| Deny mechanism | `HTTPException` from `hono`, which `packages/auth` does not currently depend on. Add it, pinned exactly to the version `modules/api` pins, per ADR 0017. The dependency-free alternative makes `modules/api` duck-type a `status` field off a type it cannot import, and no compiler checks that. |
| How the first admin is created | First user wins. A `databaseHooks.user.create.before` hook in `packages/auth/src/auth.ts` sets `role: "admin"` when the `user` table is empty, and leaves the plugin's `"user"` default otherwise. Chosen for out-of-box usability over the safer `pnpm db:promote-admin` script. See the risk note under Approach. |
| The concurrent-sign-up race | Accepted, documented, and covered by a QA step, not engineered away. A unique partial index on `role = 'admin'` would also block the legitimate promotion of a second admin through `client.admin.setRole`. |
| Scope of the gate | Role only. better-auth's `admin` plugin already refuses a banned user at sign-in and revokes their sessions, so a banned account holds no session for `requireAdmin` to see. A second `banned` check duplicates plugin behaviour we would have to re-verify on every bump. |
| Where the first caller lives | `modules/admin`, which already declares `dependsOn: ["api", "auth"]`. Putting it in `modules/waitlist` would add `auth` to a module whose whole appeal is that it is cheap, dragging Better Auth, a four-table schema and `BETTER_AUTH_SECRET` into every project that wanted an email-capture form. The registry has no optional-dependency mechanism. |
| The snapshot drift | Re-verify against `better-auth@1.7.2`, correct the header, and add a test asserting the header's version string matches `package.json`. |

## Approach

The work reuses what already exists and adds one file's worth of new logic. `getSession` stays the primitive and the new helpers wrap it. api's `onError` and `ERROR_CODES` (`401: "unauthorized"`, `403: "forbidden"`) already map the two statuses this needs, so the deny bodies come free. The `admin()` plugin, `adminClient()`, the `role` column and the SPA guard are all in place and untouched. The auth skill's "Roles and the first admin" section already documents the manual SQL, so it needs an edit rather than a new section.

**The first-user-wins risk, stated once.** Sign-up is open. Any account that reaches `/signup` before the project's owner does becomes the admin, and on a deployed api with a public origin that window is real. The hook narrows it to the very first sign-up on an empty table, which is a much smaller target than an unconditional promotion, but it does not close it. Phase 2 carries the warning in three places for that reason, and the auth skill carries the recovery command so the warning has an answer attached. The concurrent case, where two requests both read an empty table and both become admin, is left unmitigated and is a QA observation rather than a lock.

### Phase 1: the server gate and its first caller (built 2026-08-31)

In `modules/auth/files/src/server.ts`:

- `requireSession(request)` — returns the session or throws `HTTPException(401, "sign in first")`.
- `requireRole(request, role)` — calls `requireSession`, then throws `HTTPException(403, "role required: <role>")` unless `session.user.role === role`. Returns the session, so the caller reads `session.user.id` without a second lookup.
- `requireAdmin(request)` — `requireRole(request, ADMIN_ROLE)`.
- Export `ADMIN_ROLE` so `modules/admin/files/src/lib/auth.ts` and the server share one string instead of two literals.

Add `hono` to `modules/auth/files/package.json` at the exact version `modules/api` pins, and register it per ADR 0017. Keep `getSession` exported unchanged, so a route wanting a nullable session still has one. Unit-test the helpers beside `env.test.ts`, the module's existing test convention.

Then give them a caller. `modules/admin` ships no api files today, so this phase adds the first: `files/api/routes/admin-users.ts`, a `GET /admin/users` sub-app that calls `requireAdmin` then `auth.api.listUsers`, registered with a `chained-route` patch on the exported chain (ADR 0028) so `hc<AppType>` types it. The route contract is the one `modules/waitlist/files/api/routes/waitlist.ts` documents: one named `export const`, one chained expression, an explicit status on every `c.json`.

### Phase 2: first user wins

Add `databaseHooks` to `betterAuth({...})` in `modules/auth/files/src/auth.ts`. The `user.create.before` hook counts rows in `user` through the drizzle client already in scope (`getDb(authEnv.DB)`) and returns `{ data: { ...user, role: ADMIN_ROLE } }` on zero. Anything else returns the input untouched, so the plugin's `"user"` default applies.

The warning goes in three places, because the failure is unrecoverable once a stranger holds the role:

- A comment in `auth.ts`, in the file's existing register, stating that this is the only automatic promotion in the system and that it fires once per project.
- The descriptor's env-var output, which the CLI prints at `add` time and is the only one of the three that reaches the person running the command.
- The auth skill, carrying both the warning and the `update user set role` recovery command that already ships there.

### Phase 3: the schema snapshot

Re-verify the four tables against `better-auth@1.7.2`'s `getAuthTables()` and its Drizzle SQLite type mapping, fix any column that moved, and correct the header to name `1.7.2`. If nothing moved, the change is the header alone, and that is still the point of the rule.

Add a test beside `env.test.ts` asserting that the version string in the snapshot's header matches `better-auth` in `modules/auth/files/package.json`. It cannot verify the columns, and it is not meant to. It fails the build on a bump that skipped the re-verification, which forces a human to the exact moment the header rule asks for.

This phase is independent of Phases 1 and 2 and can land first.

### Phase 4: docs, skills and QA

- `modules/auth/skills/saasaloy-auth/SKILL.md` — add `requireSession`/`requireRole`/`requireAdmin` to "Protect a route", and rewrite "Roles and the first admin" so the first-user-wins hook is the primary path, the open-signup window is stated, and the wrangler SQL becomes the recovery path. Keep the "installed auth before this shipped needs a migration" paragraph.
- `modules/admin/skills/saasaloy-admin/SKILL.md` — state that the SPA guard is the second half of a gate whose first half is `requireAdmin`, and that a new admin route wires both. Document `GET /admin/users` as the worked example.
- `docs/qa/qa-admin-app-module-2026-08-29.md` — add the steps AC3 and AC1 need: a fresh project's first sign-up lands in the shell; the second sign-up gets the denied panel; two near-simultaneous first sign-ups, recording how many admins result; and a `curl` of `GET /admin/users` carrying the non-admin's cookie, expecting `403` and the `{ error: { code: "forbidden" } }` envelope. That last step is the one a browser cannot fake, so it is the only step that proves AC1.

## Open questions

- **Does the dashboard render `GET /admin/users`, or is the route enough?** Phase 1 delivers a typed, gated endpoint. Whether `apps/admin`'s dashboard replaces its `/health` card with a user list is UI work the plan neither includes nor rules out. Deferred deliberately: the route is what proves AC1, and the screen is a separate, larger change.
- **An opt-out for first-user-wins.** A project that deploys before its first sign-up wants the hook off. An env var (`AUTO_PROMOTE_FIRST_USER=false`) would do it, and it adds a variable to every deploy for a case nobody has hit yet. Follow-up issue rather than scope.

## Non-goals

- Custom roles, permissions, or Better Auth's access-control layer. `requireRole` takes a string and compares it.
- A `banned` check in `requireAdmin`, per the settled decision.
- An admin-management UI. `client.admin.setRole` and friends already exist on the client; nothing renders them.
- `GET /waitlist`, gated or otherwise. It needs an optional-dependency mechanism the registry does not have, which is its own issue.
- A migration shipped in `modules/database`. The schema file drops into `packages/db/src/schema/` and the project's own `db:generate` emits the SQL, which is the existing arrangement (ADR 0020).
- Postgres portability of the row-count hook. `auth` declares `dependsOn: ["database-d1"]` (ADR 0026), so there is no Postgres path to break. It becomes real when auth supports `database-postgres`, and belongs to that issue.
- Rate limiting or abuse controls on `/signup`. Real, and a different issue.
- Changing issue #13's acceptance criteria. #13 is closed and its QA plan already tests role denial.
