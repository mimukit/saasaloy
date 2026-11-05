# Plan: admin audit log, members screen and route gate

Grilled: 2026-11-04

Issue: #310. Source: `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, Issue 5. Reference implementation: PrimeShopr (`/home/dev/projects/primeshopr`) issues #109, #112 and #131, plans `docs/plans/0028-plan-admin-audit-log-2026-10-28.md` and `0029-plan-admin-marathon-2026-10-29.md` there.

## Context

Nothing in a Saasaloy scaffold records which staff member changed what. A payment review, a refund, a feature flag override and every Better Auth admin call leave the changed row and nothing else. PrimeShopr built the missing piece over three issues, and every later admin brief in its 314 sessions had to restate the audit wrapper rules, because the template had none to point at.

Two smaller faults travel with it. `payment` and `feature-flags` run `zValidator` before `requireAdmin`, so a signed-out caller with a bad body gets 400 and a field list instead of 401 (`modules/payment/files/api/routes/admin-payment.ts:155`, `modules/feature-flags/files/api/routes/feature-flags.ts:159`). The overview at `/` asks `GET /admin/users` for 100 rows to show five, sorts them in the browser, and holds the first paint on `GET /health` (`modules/admin/files/src/routes/index.tsx:61-67`).

A third gap sits in the managed files. PrimeShopr had to edit `payments.tsx`, `admin-payment.ts` and `__root.tsx` in place to add a search param or a wrapper, so every `saasaloy update` of those files goes to the AI merge. A module file has no way to say "the project owns this one"; only base-template files do (`ownedFiles`, `seedFiles` in `_saasaloy-base.json`).

Who it is for: a project team whose staff use `apps/admin`, and the agent that adds the next admin write route.

Success outcome: an admin write cannot ship without an audit row, and the build says so, not a reviewer.

Target: in a fresh scaffold with `admin`, `payment` and `feature-flags` and testing on, every `POST`, `PUT`, `PATCH` and `DELETE` route under `/admin/` (outside `/admin/auth/*`) maps to an audit action, the coverage test passes, and it fails when one entry is removed. A signed-out request to every gated `/admin/` route answers 401.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Home of the audit code | Inside the `admin` module, not a new opt-in module. The guarantee only holds if the wrapper ships wherever admin routes do. `payment`, `feature-flags` and `teams` already list `admin` in `dependsOn`, so they can import it. |
| Relation to #142 (asked, Q1) | Separate. #310 audits site-staff writes; the table has no tenant column. #142 later adds tenant events with its own `TenantTable` and reuses the `AuditEntry` shape and the action registry. Until then the staff writes `multitenant` and `api-keys-organization` send from the browser to `/admin/auth/organization/*` and `/admin/auth/api-key/*` stay unaudited, and the coverage test skips `/admin/auth/*`. |
| Relation to #201 (asked, Q2) | #310 fixes the three overview faults and keeps the three cards. #201 owns the card seam, and builds it with the module seed files this plan adds. |
| Table | One `audit_events` table, plural snake_case per ADR 0038, in both dialects (`audit.pg.ts`, `audit.sqlite.ts` with `onlyWith`, the way `payment` ships its schema). Columns follow PrimeShopr: `id`, `actor_user_id`, `actor_role`, `action`, `target_type`, `target_id`, `target_label`, `before`, `after`, `created_at`. Three indexes: `created_at`, `(actor_user_id, created_at)`, `(target_type, target_id, created_at)`. Application code never updates or deletes a row. |
| Two wrappers | `adminWrite(c, fn)` for database writes the api makes itself: gate, one transaction, audit rows inserted last in it, `afterCommit` tasks run through `waitUntil` after commit, `currentAdminWrite()` for deep code that joins the scope. `adminAuthWrite(c, fn)` for writes Better Auth makes, which cannot join a transaction: rows go in after the body succeeds. Both refuse a `before` or `after` key that matches `/password/i`. |
| D1 guarantee (asked, Q4) | Each driver's `client.ts` exports `transaction(db, fn)`. Postgres runs `db.transaction`. D1 has no interactive transaction, so it calls `fn(db)`: the body runs first, then the audit rows go in one batch, and a failed insert is logged at `error` while the change stands. The `saasaloy-admin` skill states the weaker guarantee. |
| Action map | A registry, not one hand-edited file. `apps/api/src/lib/audit-actions.ts` holds `defineAuditActions({ actions: [] })`. Each module ships its own action file and registers it with a `plugin-array` patch, so `saasaloy remove payment` takes its actions with it. An entry is `{ route: "METHOD /full/path", target, area }`. Two actions may share a route. |
| Action names (defaulted, Q9) | `<area>.<object>.<verb>`, for example `payment.refund.create`, `flag.tenant.clear`, `member.remove`. |
| Coverage test | `apps/api/src/routes/audit-coverage.test.ts`, shipped by `admin`. It reads `app.routes` from `src/index.ts`, keeps `POST`, `PUT`, `PATCH` and `DELETE` under `/admin/` outside `/admin/auth/*`, and expects none without an action. A second case fails on a map entry whose route does not exist. No exempt list. |
| Better Auth's own admin endpoints (defaulted, Q7) | Close every `admin()` plugin endpoint on the `/admin/auth/admin/*` forward in `modules/auth/files/api/routes/auth.ts`, reads and impersonation included. No browser code calls them, and an open `setRole` over HTTP would be an unaudited write the coverage test cannot see. |
| Flags mount (asked during the build, 2026-11-04) | `feature-flags` mounts its admin-only routes at `/admin/flags`, not `/flags`, like `/admin/payment`. Every `/flags` route was admin-only and only the Flags screen called it; at `/flags` the gate and coverage tests could not see its writes. |
| Gate | `adminGate`, a Hono middleware in `packages/auth/src/server.ts` beside `requireAdmin`, placed before every validator on an admin route. Handlers keep their own `requireAdmin` call for the session value. |
| Gate test | `apps/api/src/routes/admin-gate.test.ts`, shipped by `admin`. It walks `app.routes` under `/admin/` (minus `/admin/auth/*`), sends each a request with no cookie and a malformed body and query, and expects 401. A new route is covered with no new test. |
| Test harness (defaulted, Q8) | Shipped tests are `*.vitest.ts` in the repo, renamed to `*.test.ts` by the descriptor, with `when: { testing: true }`, using `testDatabase()` from `@repo/db/testing` and the seeded `superadmin`, `admin` and `member` users. `modules/auth/files/api/routes/auth.vitest.ts` is the model. CLI changes use the CLI's existing vitest suite beside the source. |
| Members screen | A new `/members` route in `apps/admin` for the admin group: role select on create, own name and password edit, superadmin password reset, superadmin-only removal through ban, restore after a ban, and a removal date read from the `member.remove` audit row. Api routes at `/admin/members`, each write through `adminAuthWrite`. The calls pass the caller's headers to `adminAuth.api`, so the existing `rank-guard` plugin keeps enforcing rank. |
| Who adds a member (asked during the build, 2026-11-05) | Only a superadmin sees "Add member". `rank-guard` already lets only a superadmin create an admin-group account, so the button is hidden from an admin rather than answering 403. The mockup showed it to an admin; this row overrides that. |
| Own password change (asked, Q5) | Asks for the current password, through Better Auth's `changePassword`. A superadmin reset of another member sets it directly and writes `member.password.set`. |
| Users and members (defaulted, Q6) | Both screens stay. Users lists everyone with its chips; Members manages the admin group. |
| Activity page | A new `/activity` route: keyset-paged list (`(created_at, id)` desc, 50 a page, "Load older"), filters in the URL (actor, area, range, search), and a before/after detail panel. Api at `GET /admin/audit-events` and `GET /admin/audit-events/people`. |
| Overview | `/admin/users` takes `limit` and sort query params passed to `listUsers`. The overview asks for five newest and reads `total`, and the loader stops awaiting `/health`, so the health card shows its own loading state. |
| Extension seams (asked, Q3 and Q10) | In #310, through a new descriptor flag: a module file entry with `"seed": true` is written once, recorded in the manifest, and never updated by `update`; a missing one is restored. A managed file imports its extension from the seed file, so a project changes the seed file and the managed file stays clean. |
| Seam files (asked, Q11) | Three. `payments.tsx` composes its `validateSearch` with a search extension from `@admin/extend/payments`. `__root.tsx` wraps the shell in the wrappers from `@admin/extend/root`. `admin-payment.ts` gets no seed file: `adminWrite`, `afterCommit` and `currentAdminWrite()` replace the `staff()` helper PrimeShopr edited. `index.tsx` waits for #201. |
| Seed file on remove (defaulted, Q12) | `saasaloy remove` deletes a seed file whose hash is unchanged, and keeps and warns about one that changed. |
| Seam location (defaulted, Q13) | `apps/admin/src/extend/<name>.ts(x)` and `apps/api/src/extend/<name>.ts`. |
| Seed-file ADR (defaulted, Q16) | A new ADR in `docs/adr/` for module seed files, written in Phase 2, with the next free decision number at write time. |
| UI house rules | From `modules/admin/files/DESIGN.md` and the shell blocks: every screen uses the `@repo/ui` shell set (`PageHeader`, `DataTable`, `FilterChips`, `DetailPanel`, `EmptyState`, `ErrorState`), a screen owns its error component, nav rows carry a `G <key>` shortcut, and a destructive action asks for confirmation inside the page. |
| Mockup method (asked, Q15) | One static HTML page per screen, with the real `admin.css` and shell styles, every state as a section (list, empty, loading, error, create dialog, confirm dialog, removed tab, detail panel). Rendered in the chat and captured with `playwright-cli` into `docs/plans/assets/0101-*`. |
| Visual reference | `docs/plans/assets/0101-mockup-r1-*.png` (11 states). Round 1 also settled: Members uses Active and Removed tabs, the member detail panel shows recent activity with a link to Activity, the add dialog offers Superadmin only to a superadmin, the change-password dialog signs out other sessions by default, Activity rows show a plain label with the action key in the detail panel, nav shortcuts are `G M` and `G A`, and each overview card shows its own failure in place of a page error. |
| Mockup approval | Mockup approved 2026-11-04, round 1. |
| Outward actions (asked, Q14) | Approved: a comment on #142 (stays separate, reuses `AuditEntry` and the registry, organization and api-key writes stay unaudited until then) and a comment on #201 (the overview fix, and the card seam uses module seed files). Posted when this plan is stamped, before the `ready` label. |
| Commit and push (defaulted, Q17) | None. Every change stays uncommitted for the owner to review. The only GitHub changes are the two comments and the labels. |

## Approach

Port the PrimeShopr shape and close the gaps it left. PrimeShopr runs on Postgres only, edits managed files in place, and enforces gate order by hand in two tests. Saasaloy needs both drivers, module-owned action entries, a gate check that covers a new route by itself, and a file a project may change without drift.

It reuses: `requireAdmin`, `withAuthScope` and `adminAuth` from `packages/auth`; `withDb` and the `TEST_DB` hook from each driver's `client.ts`; the `rank-guard` plugin for role rank; the `chained-route`, `plugin-array`, `onlyWith` and `when` descriptor mechanics; the manifest and the `seedFiles` handling for base files in `packages/cli/src/lib/`; `testDatabase()` and the seeded users; the shell blocks the users screen already uses; and `usersQuery` and the `queryOptions` convention in `apps/admin/src/lib/`.

Rejected: a separate `audit` module (opt-in breaks the guarantee); one central action map file (every module would edit an `admin`-owned file); PrimeShopr's trusted server calls for member writes (they skip `rank-guard`); registration arrays or a `config` section as the seam (an edit is drift, or the config cannot carry code).

### Phase 1: mockups (built 2026-11-04)
Attended: the owner approves the screenshots of each screen before Phase 2 starts.
- Mock the members screen: list, create dialog with role select, own profile and password edit, superadmin reset and remove with its confirm dialog, removed tab with restore and removal date.
- Mock the Activity page: filters, list, empty state, loading, detail panel with before and after.
- Mock the overview after the change: three cards, health card loading on its own.
- Save screenshots under `docs/plans/assets/0101-*`.
- Record the approval and the round number as a Design decisions row.

Done when: the plan has a row "Mockup approved YYYY-MM-DD, round N" and the screenshots are in `docs/plans/assets/`.

### Phase 2: module seed files (built 2026-11-04)
- Add `seed` to file entries in `packages/cli/schemas/registry-item.schema.json` and the descriptor types.
- Make the applier write a seed entry once and record it; make `update` skip a recorded seed entry and restore a missing one; make `remove` follow the Q12 rule.
- Add CLI tests beside the source.
- Write the ADR and add a "Module seed file" entry to `CONTEXT.md`.

Done when: CLI tests show a changed seed file survives `update`, a deleted one comes back, and `remove` keeps a changed one with a warning.

### Phase 3: route gate (built 2026-11-04)
- Add `adminGate` to `modules/auth/files/src/server.ts` and export it from `@repo/auth/server`.
- Put it before the validator on every admin route that has one: `payment` (list query, review, refund), `feature-flags` (two `PUT`s), and `admin-users` once it takes a query.
- Add `admin-gate.vitest.ts` to the `admin` module.
- Update the route recipe in the `saasaloy-admin` and `saasaloy-api` skills.

Done when: the gate test passes in a scaffold with `payment` and `feature-flags`, and it fails when `adminGate` is moved after a validator on one route.

### Phase 4: audit core (built 2026-11-04)
- Add the `audit_events` schema in both dialects and a seed slice.
- Add `transaction(db, fn)` to each driver's `client.ts`.
- Add `apps/api/src/lib/admin-write.ts` with `adminWrite`, `adminAuthWrite`, `currentAdminWrite` and `changedFields`.
- Add `apps/api/src/lib/audit-actions.ts` with `defineAuditActions` and the helpers `adminWriteRoutes` and `unauditedRoutes`.
- Add the audit repository: insert with one timestamp for all rows, keyset list, counts by action, actor list, last time per target.
- Add `audit-coverage.vitest.ts` and tests for the helpers.

Done when: the tests pass on both drivers, and on Postgres an `adminWrite` body that throws leaves neither its change nor an audit row.

### Phase 5: audit the existing writes (built 2026-11-04)
- Route `payment` review and refund through `adminWrite`, with the payment store bound to its transaction. Ship `payment`'s action file and its registration patch.
- Move the `feature-flags` mount from `/flags` to `/admin/flags`, and change the Flags screen to `api.admin.flags`.
- Route the three `feature-flags` writes through `adminWrite`. Ship its action file and patch.
- Close the `admin()` plugin endpoints on the `/admin/auth/admin/*` forward.

Done when: in a scaffold with `admin`, `payment` and `feature-flags`, the coverage test passes, and it fails after one action entry is deleted.

### Phase 6: members screen and Activity page (built 2026-11-05)
- Add `/admin/members` routes: list, create, update, remove, restore, each write through `adminAuthWrite` with its action.
- Add `/admin/audit-events` and `/admin/audit-events/people`.
- Build `/members` and `/activity` in `apps/admin` to the approved mockup, add both nav rows, and add their commands.
- Update the `saasaloy-admin` skill with the four-step recipe for a new admin write route.

Done when: in a running scaffold, a superadmin creates an admin, removes them, restores them, and the Activity page lists the three rows with the removal date matching the `member.remove` row.

### Phase 7: overview and seams (built 2026-11-05)
- Add `limit` and sort query params to `GET /admin/users`.
- Change the overview to ask for five newest, read `total`, and drop the `/health` wait from the loader.
- Ship `@admin/extend/payments` and `@admin/extend/root` as seed files, and import them from `payments.tsx` and `__root.tsx`.

Done when: the overview makes one `GET /admin/users?limit=5` request and renders with the api's `/health` route stopped, and a search param added in `extend/payments.ts` reaches `payments.tsx` with no edit to it.

### Phase 8: gate and docs (built 2026-11-05)
- Update the module READMEs and skills that name an admin route or a seam (`admin`, `auth`, `payment`, `feature-flags`).
- Run `pnpm lint`, `pnpm test`, and the scaffold typecheck in `.dev`.

Done when: the repo gate passes, and the target holds in a fresh `.dev` scaffold with `admin`, `payment` and `feature-flags` and testing on: every admin write route has an action, the coverage test fails when one is removed, and every gated `/admin/` route answers 401 to a signed-out request.

## Migration and rollback

`audit_events` is a new table, so there is no data to move. The project generates the migration with its driver's `db:generate` after `saasaloy add admin` or `saasaloy update`. Rollback is to drop the table; nothing else reads it.

An existing project that edited `payments.tsx` or `__root.tsx` in place gets the new versions through the usual AI merge once; after that its changes belong in the seed files.

## Open questions

None. Every decision from the grill is settled above.

## Non-goals

- Tenant-scoped audit, refusal rows, api-key principals, and audit of `/admin/auth/organization/*` and `/admin/auth/api-key/*` (#142).
- Module cards and an `index.tsx` seam on the overview (#201).
- Audit of client-group self-service actions (a user changing their own profile on `/auth`).
- Retention, export or deletion of audit rows.
