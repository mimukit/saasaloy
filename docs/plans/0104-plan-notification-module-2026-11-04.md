# Plan: the `notification` module, in-app notifications for `apps/app`

Grilled: 2026-11-04

Issue #313. Source: `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, Issue 8.

## Context

Every signed-in product needs a place to tell a user that something happened: an invite was accepted, a payment failed, a job finished. PrimeShopr built one by hand (PrimeShopr issue #41, plan `0016-plan-notifications-page`): a bell in the navbar, a menu with the 5 newest rows, an unread count, a full page, categories and a promotions opt-out. It took three fix commits after the first build, and two of them were the same bug: the bell read a failed request as "0 unread", and a count went stale after Back or after a second tab marked rows read (`d5f3c5c fix(notifications): keep the bell count across failures`).

Saasaloy has no notification feature. A project that wants one writes the table, the routes, the bell and the count logic again, and meets the same two bugs. The `apps/admin` sidebar count seam has the first of them today: `fetchNavCount` in `modules/admin/files/src/components/app-shell.tsx` answers `null` on any failure, and the badge disappears.

Goal: a project adds in-app notifications with `saasaloy add notification`, calls one server function to send one, and gets a bell, a sidebar badge, a page and a category opt-out in `apps/app` with no hand wiring.

Target: a fresh `.dev` project with `app`, `notification` and either database driver passes `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, and its tests prove these behaviours: a user sees and changes only their own rows; `notify` writes nothing for an opted-out category; a required category refuses an opt-out; a failed count request keeps the last count in both apps.

Reference files in `/home/dev/projects/primeshopr`:

- `packages/db/migrations/0003_notifications.sql`, `packages/db/src/repositories/notifications.ts` (table, cursor paging, unread count, mark read, retention).
- `apps/api/src/lib/notify.ts`, `apps/api/src/routes/me.ts` lines 375 to 440 (the write helper and the six routes).
- `apps/web/src/lib/unread-count.ts`, `apps/web/src/lib/use-unread-count.ts` (the count store and the refetch on `visibilitychange`, `pageshow` and session change).
- `packages/ui/src/blocks/notification-menu.tsx`, `packages/ui/src/blocks/notifications-view.tsx` (the bell menu and the page).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Build now | Built now, not moved to the backlog (grill Q1, 2026-11-04). |
| Module name | `notification`, singular (AGENTS.md: every module name is singular). The issue title keeps "notifications". |
| Tier | Feature module. `dependsOn: ["api", "database", "auth", "app", "validators", "shell"]`. It drops files into existing conventions and births no workspace. No `admin` dependency. |
| Row content | Rendered text stored at write time: `title` and `body`. No kind registry, no read-time rendering (Q2). |
| Tables | `notifications` (`id`, `user_id` FK to `users` on delete cascade, `category`, `title`, `body` nullable, `href` nullable, `read_at` nullable, `created_at`) and `notification_opt_outs` (`user_id` FK on delete cascade, `category`, `created_at`, primary key on `user_id` and `category`). Indexes `notifications_user_id_created_at_idx` and `notifications_user_id_read_at_idx`. Both `.pg.ts` and `.sqlite.ts`, plural snake_case (ADR 0038). |
| Tenancy | Per user only. No tenant column, also with `multitenant` installed (Q4). |
| Categories | A `notification` config section at `packages/config/src/sections/notification.ts`: a list of `{ id, label, description, required }` plus the retention days. The scaffold ships `account` (required) and `product` (optional). Categories are checked in, so they are config, not env (ADR 0052). |
| Opt-out | `notify` skips the write while the user is opted out of a non-required category. Turning it back on shows only new rows (Q3). |
| Count | The unread count includes every unread row of the user. An opt-out stops new rows only, so the page and the menu show old rows of an opted-out category, and the count agrees with them (Q16). |
| `notify` input rules | An unknown category throws. An empty title throws. `href` must be an app-relative path that starts with `/` and not with `//`, or `notify` throws (Q11, Q12). |
| Repo layout | `@db/repositories/notifications.ts` (queries), `@api/lib/notify.ts` (the `notify` function other routes call), `@api/routes/notifications.ts` (routes, one `chained-route` patch at `/notifications`), `@validators/notifications.ts` (inputs). The `feature-flags` split. |
| Routes | `GET /notifications?cursor=` (20 rows, newest first), `GET /notifications/unread-count` (answers `{ count }`), `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /notifications/preferences`, `PUT /notifications/preferences`. All behind `requireSession`; every query filters on the session user. A required category in a `PUT` answers 400. Page size 20 and menu size 5 (Q9). |
| Opening a row | A click marks the row read, then goes to `href` when the row has one (Q10). |
| Retention | `pruneNotifications(db, now)` deletes read rows older than 30 days and unread rows older than 180 days, both days in the config section. A `queue` job and a daily schedule ship only `when: { installed: ["queue"] }`. Without `queue` the owner calls the function from their own cron (Q7). |
| Bell | A shell extension, `id: "notification"`, whose `header` is the bell. File `@app/components/notification-extension.tsx`, registered by a `plugin-array` patch into `apps/app/src/components/shell-extensions.ts` (Q5). |
| Sidebar badge | The `app` module gains the `NAV_COUNTS` seam that `admin` has: `apps/app/src/components/nav-counts.ts` and a `useNavCounts` hook in `apps/app/src/components/app-shell.tsx` that passes `counts` to `ShellLayout`. The notification module adds `{ to: "/notifications", path: "/notifications/unread-count" }` with a `const-array` patch and a "Notifications" row with a `nav-entry` patch (Q5, Q13). |
| One count query | The bell and the badge read one TanStack Query key, `["nav-count", "/notifications"]`. It refetches every 60 s while the tab is visible, on window focus (`visibilitychange`), on `pageshow` with `persisted` (bfcache restore), and after each mark-read mutation through invalidation (Q15, which reopened and replaced Q8). |
| Failure keeps the count | The nav count fetch throws on a network error, a non-OK status or a bad body, so TanStack Query keeps the last `data`. The badge never drops to 0 or disappears because of a failure. This applies to `apps/app` and to `apps/admin`, whose `fetchNavCount` changes in this PR (Q14). |
| Blocks | `@ui/blocks/notification/notification-menu.tsx` and `@ui/blocks/notification/notification-list.tsx`, plus `notification-preferences.tsx`: presentational, shell primitives only (`Popover`, `Tabs`, `Badge`, `Switch`, `Button`, `Skeleton`), copy as prop defaults, behaviour as props. The app files build the queries and pass functions down. |
| Page | `@app/routes/notifications.tsx` at `/notifications`, with two tabs: Inbox (list, "Mark all read", "Load more") and Preferences (one switch per category; a required category shows a disabled switch that is on with a "Required" note) (Q17). |
| Seed | `@db/seed/slices/notifications.ts` with unread and read rows in both shipped categories, and `notification-opt-outs.ts` with `rows: {}`. |
| Tests | Route tests: `files/api/routes/notifications.vitest.ts` → `@api/routes/notifications.test.ts`, `when: { testing: true }`, the `file-uploads` pattern on `testDatabase()`. `notify` tests in the same pattern. The pure count and menu rules (badge text, `99+`, `href` check) in plain `.ts` files with `node --test` tests, the `nav-counts.ts` pattern (Q19). |
| UI house rules | No `DESIGN.md` in this repo. The `saasaloy-app` skill rules hold: the page writes no `max-w-*`, padding or background; it composes from `@repo/ui/components/shell/*` only; the nav row takes a hand-picked `shortcut` (`G N`). The badge shows `99+` above 99. |
| Mockup approved | Round 1 approved on 2026-11-04 (Q20). Screenshots and source in `docs/plans/assets/0104-notification-mockup-r1/`: `menu-*`, `inbox-*`, `prefs-*` at 1440 and 360 px, and `states-*` at 1440 px, each light and dark. The screen copy is example data; the scaffold ships two categories. |
| Outward actions | Label #313 `ready` after the grill. No commit and no push unless the owner asks. No follow-up issues. |

## Approach

A self-contained feature module that stores rendered text keyed by a config-defined category. It reuses the `feature-flags` file split, the `file-uploads` route-test pattern, the shell extension seam (ADR 0056) for the bell, the admin `NAV_COUNTS` seam (ported to `app`) for the badge, and the app's `nav-entry` patch target.

Rejected alternatives:

- **Typed kinds rendered at read time** (PrimeShopr's `kind` + `params` + a content module). Every project would write a kind registry before its first notification (Q2).
- **A `notification` capability with providers** (in-app, email, push behind one `notify`). A fan-out product, not a feature. No vendor is wrapped, so ADR 0033's provider test does not apply.

### Phase 1: mockup
Attended: the owner approves the mockup screenshots. Approved round 1 on 2026-11-04.

- Mock the bell (no unread, 3, 99+), the menu (5 newest, loading, empty, failed load), the page (Inbox and Preferences tabs) and the sidebar badge, light and dark, 1440 and 360 px.

Done when: the plan carries the "Mockup approved" row with the screenshot paths. Met on 2026-11-04.

### Phase 2: the `NAV_COUNTS` seam in `app`, and the failure fix in both apps (built 2026-11-05)
- Add `modules/app/files/src/components/nav-counts.ts` (empty list, the admin shape) and its scaffold entry.
- Add `useNavCounts` to `modules/app/files/src/components/app-shell.tsx` and pass `counts` to `ShellLayout`. Add a `pageshow` listener that invalidates `["nav-count"]` when `persisted` is true.
- Change `fetchNavCount` in both apps to throw on failure, so the last count stays. Update the comments in both `nav-counts.ts` files that say a failure shows no count.

Done when: `pnpm test` and `pnpm typecheck` pass in this repo, and a `.dev` project with `app` and no notification module builds and renders Home with no badge.

### Phase 3: schema, config section, repository, seed (built 2026-11-05)
- `saasaloy new module notification --type saasaloy:feature --depends-on api,database,auth,app,validators,shell`, then fill the descriptor.
- Both schema dialects, the config section and its `plugin-array` patch, the repository (insert, cursor page, unread count, mark one read, mark all read, list and set opt-outs, prune), both seed slices.

Done when: `pnpm test` passes in this repo, including `scripts/table-names.test.ts` and `scripts/seed-slices.test.ts`, and `saasaloy add notification` in `.dev` writes every file and patch.

### Phase 4: routes and `notify` (built 2026-11-05)
- `@api/lib/notify.ts` with the input rules and the opt-out skip.
- `@api/routes/notifications.ts` with the six routes, the `chained-route` patch, the validators.
- The `queue` job and schedule for pruning, gated on `queue`.
- Tests: own rows only, cursor paging, mark read is idempotent and scoped to the user, `notify` skips an opted-out category, a required category refuses an opt-out with 400, `notify` refuses a bad `href`.

Done when: the route tests pass in a `.dev` project on `database-d1` and on `database-postgres`.

### Phase 5: bell, page, preferences, badge (built 2026-11-05)
- The three blocks, the shell extension with its patch, the page route, the `nav-entry` and `const-array` patches.
- The bell and the badge share `["nav-count", "/notifications"]`; each mutation invalidates it.

Done when: in a `.dev` project, signed in as a seeded user, the bell and the sidebar row show the seeded unread count; marking a row read in a second tab updates the first tab's badge when it becomes visible; with the api stopped, the badge keeps its number. The screens match the approved mockup round 1.

### Phase 6: skill and docs (built 2026-11-05)
- `skills/saasaloy-notification/SKILL.md`: how to call `notify` from a route, how to add a category, how pruning runs with and without `queue`, and what `remove` leaves.
- Update the `saasaloy-app` skill for the new `NAV_COUNTS` seam, and `llms.txt` or the README module list if modules are listed there.

Done when: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass in this repo, and the `.dev` project from phase 5 passes the same four.

## Migration and rollback

The module adds two new tables and changes no existing one. `saasaloy add` ships the schema; the project runs `db:generate` and applies the migration. `remove` leaves the tables, so the descriptor carries a `removeWarnings` line telling the owner to generate and review the drop migration. The `app` change adds a file and a hook and stores no data.

## Open questions

None. Every decision from the grill on 2026-11-04 is settled.

## Non-goals

- Email, SMS or push delivery. A caller calls `email` or `sms` itself.
- Real-time delivery over WebSocket or SSE.
- Notifications in `apps/web`.
- An admin side: no send screen and no log in `apps/admin` (Q6). The admin change is only the nav count failure fix.
- A tenant column (Q4).
- Translation of stored text, and rewording old rows.
- Per-row actions other than "open" and "mark read".
