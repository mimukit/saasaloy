# Plan: absorb the PrimeShopr findings into Saasaloy

Status: draft, not grilled

## Context

PrimeShopr is a product built on Saasaloy. Its 314 agent sessions, from 2026-10-06 to 2026-11-04, show what every Saasaloy project will need: template bugs, dev environment friction, missing modules, and missing agent guidance. This plan groups those findings into the fewest issues that each still make one reviewable PR.

Rules for the grouping:

- One issue per area of the codebase, so one PR touches one set of owners and tests.
- A finding that an open issue already covers goes to that issue as a comment, not into a new issue.
- Agent guidance goes into the issue whose code it describes, not into a separate docs issue.
- Low-generic findings are listed at the end and get no issue.

Reference implementation: the PrimeShopr repo at `/home/dev/projects/primeshopr`. Each issue names the PrimeShopr files to lift from.

## New issues

Eight new issues. Order of work: 1 and 2 first (no dependencies, highest benefit), then 3, 4 and 5 in any order, then 6, 7 and 8.

### Issue 1: `fix(base): harden the template dev loop, lint, web and module defaults`

Small, confirmed bugs in the base template and in the `api`, `admin`, `storage-cloudflare` and `sms-khudebarta` modules. Each task is a few lines plus a test or an update note.

Tasks:

- [ ] `apps/web/astro.config.mjs:21`: give the dev server its own Vite cache on `command !== "dev"`, not `command === "build"`, so `astro sync` in `typecheck` stops deleting the running dev server's cache.
- [ ] `apps/web`: add a `typecheck` script and remove `"baseUrl": "."` from `tsconfig.json`, which TypeScript 7 rejects.
- [ ] `lint-staged.config.js`: add `--no-error-on-unmatched-pattern` to the oxlint step, so a commit of only ignored files passes.
- [ ] `commitlint.config.js`: accept the `hotfix` type, or keep it refused and state in the template AGENTS.md that a hotfix commit uses `fix`. Pick one in the grill.
- [ ] `apps/web`: ship `robots.txt` and a `sitemap.xml.ts` route with an exclusion list. Lift from PrimeShopr `apps/web/src/pages/sitemap.xml.ts`.
- [ ] `apps/web/src/styles/globals.css`: replace the per-component `@source` list with a glob, so `shadcn add` needs no extra line and the list stops causing merge conflicts.
- [ ] `apps/web`: add the signed-in state pattern for the static site: a `session:change` event and a `data-session` hint on `<html>` set before paint, so the header does not show "Log in" after sign-in or jump 2.5 s after load.
- [ ] `packages/env/src/setup.ts`: merge a new default from `.env.example` into an existing `packages/env/.env`, so `pnpm env:setup` does not fail on old checkouts after a new key lands.
- [ ] `modules/api`: set `cors({ maxAge: 7200 })`, so admin calls stop paying a preflight each time.
- [ ] `modules/admin`: add a blank `pendingComponent` to `src/routes/__root.tsx`, so a slow `get-session` does not show the list skeleton before login.
- [ ] `modules/admin`: add `public/_headers` with immutable caching on `/assets/*`, and a `<link rel=preload as=fetch>` for `get-session` in `index.html` (822 ms to 76 ms in PrimeShopr).
- [ ] `modules/admin`: change the cream `--background` in `ui/styles/admin.css` to a neutral hue.
- [ ] `modules/storage-cloudflare`: fail at env time when `R2_BUCKET_NAME` and the `BUCKET` binding disagree, or derive the name from the binding. Signed links failed with `NoSuchBucket` while uploads worked.
- [ ] `modules/sms-khudebarta/files/khudebarta.ts:187`: keep a short extract of the response body in the error.
- [ ] `saasaloy-database` skill: require fixed dates in seed slices. A seed with `Date.now()` broke a fixed-range test on 1 November.
- [ ] `saasaloy-database` skill: add a rule for migration number collisions across branches (renumber after a merge, regenerate `_journal.json`).
- [ ] Update notes for each change that touches a file a project owns.

Acceptance: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass on a fresh scaffold. The web scaffold typechecks. A commit of only `routeTree.gen.ts` passes the hook.

### Issue 2: `feat(base): run parallel worktrees and remote dev without port or origin clashes`

The largest time loss in PrimeShopr. Fixed `strictPort` ports 3000, 3001 and 4000 forced agents to stub the API, skip browser checks, or wait on a `flock`. Cookies ignore the port, so two worktrees on localhost overwrite each other's session. The tailnet origin broke CORS, `crypto.randomUUID` and the clipboard.

Tasks:

- [ ] A `DEV_PORT` base read through `loadEnv` in the web, app, admin and api Vite and wrangler configs, with the check in `@repo/env/dev-port`. Lift from PrimeShopr issue #146.
- [ ] A stable port offset per worktree, hashed from the worktree path, written to `.devports.json`.
- [ ] `AUTH_COOKIE_PREFIX` on loopback hosts in the `auth` module, with its env preset key.
- [ ] `DEV_ORIGINS`, CORS and trusted origins built from the env, not a hard-coded localhost list (`modules/api/files/src/index.ts:40`).
- [ ] A `pnpm dev:stop` script that stops the turbo parent and its vite and workerd children for this worktree only.
- [ ] A dev-only gzip plugin for web and admin (a cold load went from 17 to 20 MB down to 4 MB over the tailnet).
- [ ] Small helpers for plain HTTP: an id helper that does not need `crypto.randomUUID`, and `copyText` with an `execCommand` fallback.
- [ ] Find the root cause of the dev server that misses changes in `packages/ui` (about six restarts in PrimeShopr), and fix it. Use `debugkit`.
- [ ] Template AGENTS.md: a `## Worktree setup` section (env, branch database, ports, teardown), a "test on the real origin, not localhost" rule, and a "one session per worktree" rule.
- [ ] Turbo defaults: a `--concurrency` cap for `test` and `typecheck`, which hit EAGAIN at 1024 processes.

Acceptance: two worktrees of one project run `pnpm dev` at the same time, each signs in, and neither session cookie overwrites the other. A dev server reached on a tailnet IP passes CORS and saves a form.

### Issue 3: `feat(auth-phone): add phone number sign-in over the sms capability`

PrimeShopr wired Better Auth's `phoneNumber` plugin to `sms` by hand across about 15 sessions.

Tasks:

- [ ] A new `auth-phone` module that depends on `auth`, `sms` and `ratelimit`. Lift from PrimeShopr `packages/auth/src/phone.ts`.
- [ ] Sign-in by phone and password, set and reset by SMS code, and a `check-reset-code` route, because Better Auth checks the code only with the new password.
- [ ] Clear results: `no_account` and `no_password` in place of one 401, a banned-account message, and masked `auth result` log lines.
- [ ] Send limits: 60 s resend wait, 5 sends per phone per hour, counted over `sms_messages` rows. Add a long-window mode to `ratelimit`, or document why the module counts rows. The limit is off under `SMS_PROVIDER=console`.
- [ ] Web screens: login and register tabs, a code input with guards, a `?next=` return path through `safeNextPath()`.
- [ ] Admin: a "Login codes" tab that reads `verifications`, and an SMS log screen that masks 4 to 8 digit runs in provider error text.
- [ ] An e2e helper that reads console SMS codes from the api log.
- [ ] Skill: `saasaloy-auth-phone`.

Depends on: none. Coordinate with #294 (show a phone sign-up by its phone) and #230 (reset screens).

Acceptance: a new project with `auth-phone` and `sms-console` signs up, signs in, and resets a password by phone with no vendor account.

### Issue 4: `feat(database-postgres): add production operator tools`

Before this, PrimeShopr agents debugged production as the superuser owner role.

Tasks:

- [ ] A `<project>_ro` role with column grants classed `secret`, `pii` or `plain`, re-applied after `db:prod:migrate`.
- [ ] A unit test that fails on a column with no class.
- [ ] `pnpm db:prod:query` with masking, a row cap and an `--auth-trace` preset.
- [ ] `pnpm logs:prod` over a Workers Observability Read token.
- [ ] `pnpm db:prod:superadmin`, run before the api deploy, and close open sign-up after the first superadmin (`auth.ts` only warns now).
- [ ] A `saasaloy-prod-debug` skill. Lift from PrimeShopr `.agents/skills/primeshopr-prod-debug`.
- [ ] `saasaloy-deploy` skill: answer a production question against the deploy tag, not `main`.

Acceptance: an agent reads masked production rows and logs with no write access, and the class test fails on a new unclassed column.

### Issue 5: `feat(admin): add the admin audit log, members screen and route gate`

Every later PrimeShopr admin brief repeated the audit wrapper rules.

Tasks:

- [ ] `adminWrite(c, fn)`: one transaction, one `audit_events` row, and `afterCommit` side effects such as SMS. `adminAuthWrite` for Better Auth writes. An action map.
- [ ] A coverage test over `app.routes` that fails on an admin write route with no audit action.
- [ ] An Activity page in admin.
- [ ] `adminGate` that checks the session before the validator, so a signed-out caller gets 401, not 400, and a test helper that enforces the order on new routes.
- [ ] A members screen: role select on create, own name and password edit, superadmin password reset, superadmin-only removal, restore after a ban, removal date from the audit row.
- [ ] Rewrite the overview page: no `listUsers` with limit 100 for 5 rows, no client sort, do not block paint on `/health`. Coordinate with #201 (module overview cards).
- [ ] Extension seams in managed files (`payments.tsx`, `admin-payment.ts`, `__root.tsx`, `index.tsx`), so a project adds a search param or a wrapper without editing them.

Depends on: none. Decide in the grill whether this issue extends #142 or stays separate. #142 is tenant-scoped role and key events.

Acceptance: every admin write route in a fresh scaffold has an audit action, and the coverage test fails when one is removed.

### Issue 6: `feat(ui): add the missing primitives and shell blocks`

PrimeShopr added 17 primitives and several shell features by hand.

Tasks:

- [ ] Base UI primitives: dialog, popover, select, skeleton, sonner, textarea, checkbox, radio group, switch, combobox, input group, input OTP, password field, number field.
- [ ] An in-house calendar with date, range and date-time pickers on `Date` and `Intl`, no `react-day-picker`.
- [ ] A warning token in the theme.
- [ ] Fix or document the `shadcn add` faults: `import { cn } from "cn"`, the prompt to overwrite `button.tsx`, `sonner` needing `next-themes`.
- [ ] Shell DataTable: `grow`, `pin: "end"`, `groupBy`, `initialSort`.
- [ ] Shell PageHeader: a status line, a scoped "3 of 6" count, and "Updated Ns ago" refetch in place of a Refresh button. A two-row header with an attention menu from the nav counts.
- [ ] Shell PageBody: a two-column or aside layout for form pages (empty right side came up 4 times).
- [ ] Shell brand mark: full and icon variants, light and dark files, admin favicon and tab title, from `@repo/config`.
- [ ] Command palette: record search ("detection suggests, Enter runs"). Coordinate with #300.
- [ ] Template AGENTS.md: change "No UI kit as a dependency" to "compare the kit with own source and recommend one", and add "use a combobox for more than 7 options".
- [ ] Template AGENTS.md: keep mockup and QA images out of the repo, and state which small UI tweaks need no mockup.

Depends on: none. Coordinate with #293, #300 and #203 (DOM test runner).

### Issue 7: `feat(cli): make saasaloy update survive skipped releases and local deletions`

The 0.6.1 to 0.8.0 update in PrimeShopr became an 8-phase plan with 157 file operations.

Tasks:

- [ ] Add missing aliases (`@config`, `@env`) to `saasaloy.json` during `update`, not fail with `Unknown alias`.
- [ ] Record a deletion tombstone, so a deleted demo block does not come back on every update.
- [ ] Keep a base snapshot at each recorded CLI version, so an update from an old base is a three-way merge, not a two-way one.
- [ ] Link a shared skill once, not once per dependent module (the CLI exited 2).
- [ ] Pin module refs to the release tag, not `main`.
- [ ] Release job: publish to npm before the tag is pushed.
- [ ] A staged-update recipe in the skill for a breaking module.
- [ ] A path to send a managed-file change upstream: a CLI diff from managed files to a module patch.

Coordinate with #298 (update notes in the merge plan) and #301 (move `dependsOn` on update).

Acceptance: an update from a 0.5.0 base to the current release runs with no alias error, keeps a deleted block deleted, and makes a three-way merge.

### Issue 8: `feat(notifications): add in-app notifications`

PrimeShopr built a bell, a menu with the 5 newest items, unread counts, categories and a promotions opt-out.

Tasks:

- [ ] A `notifications` module with a table, api routes, a bell and a list for the `app` module.
- [ ] A cross-tab refresh: refetch counts on `visibilitychange` and on bfcache restore, and do not swallow errors as 0.
- [ ] A category opt-out.

Generic: medium. File it last, and move it to the backlog if the grill says so.

## Comments on existing issues

Post these as comments, so no new issue is needed.

| Issue | Add |
|---|---|
| #244 (ci module) | The PrimeShopr `ci.yml`: build gate, `PUBLIC_*` env lines for the build, push runs on `main` and `hotfix-*` only, actions pinned by SHA, `persist-credentials: false`, turbo cache with `.env` in the key, parallel `static` and `test` jobs, Postgres with fsync off. |
| #243 (module tests) | A route-inventory guard ("129 of 129 mounted endpoints are tested"), a guard that every test file sits in a run, a PR template with a testing checklist, one database per test worker for route tests (157 s serial now). |
| #303 (e2e main db) | The OTP helper from issue 3, and a CI e2e recipe with the auth and storage secrets. |
| #305 (ci gate) | The deploy gate refuses a `hotfix-*` branch whose base is not a deploy tag. Add the hotfix rule to the `saasaloy-deploy` skill: cut from the tag, deploy, then merge. |
| #292 (payment) | One open payment per order and purpose, refunds counted net in statements, a fresh signed receipt link per click (Safari blocks a tab opened after an await). |
| #247 or plan 0090 (uploads) | XHR upload progress, a browser resize to 2000 px, no HEIC, a clipboard fallback on plain HTTP. |
| #304 (analytics) | Set `mask_all_text` in autocapture. PrimeShopr leaked name initials without it. |

## Not filed

These are low-generic or belong elsewhere.

- Printable documents through `window.print()`, admin settings with history and a 409 on a stale save, business time zone helpers, a scrape capability with credit pause, a form draft with a 72 h expiry, typed-unit conversion. Reopen one when a second project needs it.
- Safari 15 polyfills in admin (`toSorted`, `findLast`). Decide a browserslist target first.
- Plan serial collisions, `Closes #N` links after a retarget, and permission classifier blocks. These belong to the `mimukit/skills` kits or the devaloy box.
