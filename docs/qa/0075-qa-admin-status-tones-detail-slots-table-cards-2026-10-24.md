# QA Plan: admin status tones, detail panel slots, mobile table cards and live nav counts

_Generated 2026-10-24 · against `122e9d2` (clean), gates re-run at `af08b74` after a rebase onto `origin/main` · covers issue #217, plan 0082 Phases 2 to 6_

## Summary
- The admin parts gain three status tones, detail panel header, banner and footer slots, a card layout below `md`, and live nav counts; the Payments page uses all four.
- Working means every screen matches the approved mockup round 1, in light and dark, at 1280 px and 360 px.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-217-add-status-tones-detail-panel-slots-and-mobile`, in the worktree `/home/dev/worktrees/saasaloy/issue-217-add-status-tones-detail-panel-slots-and-mobile`.
- Test project: a scaffold at `.dev/afk217` in that worktree, with `admin`, `payment`, `payment-manual`, `payment-console`, `billing`, `teams`, `rbac`, `api-keys`, `feature-flags` and local providers.
- Admin URL: `http://localhost:3001`. Api URL: `http://localhost:4000`.
- Sign in as `admin@example.test` with the password `saasaloy-dev-password`.
- The approved mockup round 1 screenshots are in `/home/dev/projects/saasaloy/.dev/mockup-217/shots/`.

Build the scaffold:

```sh
cd /home/dev/worktrees/saasaloy/issue-217-add-status-tones-detail-panel-slots-and-mobile && ./.afkkit/scaffold.sh
```

Write the local env file. Copy `packages/env/.env.example` to `packages/env/.env` and set `BETTER_AUTH_SECRET` to a random value, `PAYMENT_PROVIDER=manual,console`, `BILLING_PROVIDER=console`, `EMAIL_PROVIDER=console`, `KV_PROVIDER=memory`, `QUEUE_PROVIDER=memory`, `LOGGER_PROVIDER=console`, `CORS_ORIGINS=http://localhost:3000,http://localhost:3001`.

Create the services' env files and the local database:

```sh
cd .dev/afk217 && pnpm env:setup && pnpm --filter @repo/db db:generate && pnpm db:setup && pnpm db:seed
```

Start the api:

```sh
cd .dev/afk217 && pnpm --filter @repo/api dev
```

Start the admin app in a second terminal:

```sh
cd .dev/afk217 && pnpm --filter @repo/admin dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Seeded data, signed in as admin, Acme Inc active | The Payments page matches mockup round 1 at 1280 px | 🔴 Critical |
| TC-1.2 | 1: Seeded data, signed in as admin, Acme Inc active | The Payments page matches mockup round 1 at 360 px | 🔴 Critical |
| TC-1.3 | 1: Seeded data, signed in as admin, Acme Inc active | The other module pages look right after the change | 🟡 Normal |
| TC-1.4 | 1: Seeded data, signed in as admin, Acme Inc active | The reject dialog and the review flow feel right | 🟡 Normal |

## Scenario 1: Seeded data, signed in as admin, Acme Inc active

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login` and sign in as `admin@example.test`.
2. Open Teams, select Acme Inc, and click "Use organization". API keys and Roles need an active organization.

- [ ] Setup complete

### TC-1.1: The Payments page matches mockup round 1 at 1280 px  ·  🔴 Critical

**Goal.** The Payments page at desktop width shows what the owner approved in round 1.

**Steps**

1. Set the window to 1280 px wide. Open Payments. Select `order · 1002`.
   - [ ] The page matches mockup shot 03 in light and in dark
     - header: the reference, a blue Submitted pill and an amber "Amount differs" pill
     - banner: the amber "Nothing here is verified." note under the header
     - footer: Confirm payment and Reject… pinned at the bottom of the panel
     - the claimed amount in amber
     - screenshot: `/tmp/qakit/0075-qa-admin-status-tones-detail-slots-table-cards-2026-10-24/d-light-payments-submitted.png` light 1280 px · `d-dark-payments-submitted.png` dark 1280 px
2. Click the Successful chip. Select the first row.
   - [ ] The successful record matches mockup shot 04: a green Successful pill in the header and Record refund… in the footer
     - screenshot: `d-light-payments-successful.png` light 1280 px · `d-dark-payments-successful.png` dark 1280 px
3. Set the account menu's Theme to Dark. Look at the pills in the table and the panel.
   - [ ] Every pill reads clearly on the dark panel, and none of the amber `warn` pills can be mistaken for the orange sort header

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The Payments page matches mockup round 1 at 360 px  ·  🔴 Critical

**Goal.** The Payments page on a phone shows cards and a sheet as the owner approved.

**Steps**

1. Set the window to 360 px wide. Open Payments.
   - [ ] The cards match mockup shot m-01: the reference as the title, the amount at the right, and label and value lines below
     - screenshot: `m-light-payments.png` light 360 px · `m-dark-payments.png` dark 360 px
2. Tap `order · 1002`.
   - [ ] The sheet matches mockup shot m-02: header pills, the amber banner, and the pinned footer buttons
     - screenshot: `m-light-payments-sheet.png` light 360 px · `m-dark-payments-sheet.png` dark 360 px

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The other module pages look right after the change  ·  🟡 Normal

**Goal.** The module pages that use the new parts read as the owner approved in round 1.

**Steps**

1. At 1280 px, open Overview, Users, Billing, Teams, API keys, Roles and Flags in turn, in light and dark. Open the first record where the page has a list.
   - [ ] Each page reads correctly, with the record status in the panel header and the pills in the tones of round 1
     - Overview: the health pill
     - Users: Verified and Pending pills; the role pill in the header
     - Billing: the trialing plan pill; tags such as "14-day trial" stay grey badges
     - Teams: Active in the header
     - API keys: Enabled in the header
     - Roles: no status in the header; the `base` tag stays a grey badge
     - Flags: the Site closed pill shows only when maintenance mode is on
     - screenshots: `d-light-<page>.png` and `d-dark-<page>.png` for overview, users, billing, teams, api-keys, roles, flags
2. At 360 px, open Users, Billing, Teams, API keys and Roles.
   - [ ] Each list reads well as cards, with the right column at the right of the title row
     - screenshots: `m-light-<page>.png` and `m-dark-<page>.png` for users, billing, teams, api-keys, roles

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The reject dialog and the review flow feel right  ·  🟡 Normal

**Goal.** The dialogs on the admin parts and the live count feel right to a staff member.

**Steps**

1. Open Payments at 1280 px. Select `order · 1002`. Click Reject….
   - [ ] The dialog looks like the other admin dialogs, and the Reason select and the note field are easy to use
     - screenshot: `d-light-payments-reject-dialog.png` empty · `d-light-payments-reject-filled.png` with a reason
2. Click Cancel. Select `order · 1001`. Click Confirm payment. Watch the Payments row in the sidebar.
   - [ ] The count change and the panel change feel immediate and clear

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd .dev/afk217 && pnpm db:drop && pnpm db:setup && pnpm db:seed
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm typecheck
```

```sh
cd .dev/afk217 && pnpm --filter @repo/admin exec vite build && pnpm --filter @repo/admin typecheck
```

```sh
pnpm release:smoke
```

- ✅ After the rebase onto `origin/main` (which moved `role-workspace.tsx` from `modules/rbac` to `modules/multitenant` in #167), at `af08b74`: `pnpm lint`, `pnpm typecheck` and `pnpm test` exit 0 (859 + 90 + 415 tests, 0 fail), and the rebuilt scaffold's admin `vite build` and `typecheck` exit 0. The browser checks below ran at `122e9d2`.
- ✅ `pnpm lint` at `122e9d2` → exit 0.
- ✅ `pnpm test` at `122e9d2` → exit 0; 859 + 90 + 409 tests pass, 0 fail (845 + 90 + 409 at base). The new suites are `cardSlots` (6 tests) and `liveCount` / `withLiveCounts` (8 tests), each seen red under a deliberate break first.
- ✅ `pnpm typecheck` at `122e9d2` → exit 0.
- ✅ Scaffold admin `vite build` and `typecheck` at `122e9d2` → both exit 0. At the base `32c6720` both exit 1 with 22 errors in `payments.tsx` (imports from the removed `@admin/components/*`).
- ✅ `admin.css` → `--status-ok`, `--status-warn`, `--status-bad` and their foregrounds equal today's `--success`, `--warning` and `--destructive` pairs (computed on the page: `--status-ok=oklch(0.696 0.17 162.48)`, `--status-warn=oklch(0.769 0.188 70.08)`, `--status-bad=oklch(0.501 0.178 28.7)`).
- ✅ `grep -n 'success\|warning\|destructive' status-pill.tsx` → no output.
- ✅ `grep -rn 'Badge variant="\(success\|warning\|error\)"' modules/*/files` → no output.
- ✅ The scaffold's `apps/admin/src/components/nav-counts.ts` → holds `{ to: "/payments", path: "/admin/payment/review-count" }` on its own line, and `prettier --check` exits 0.
- ❌ `pnpm release:smoke` at `122e9d2` → exit 1 in `pnpm lint` of `full-database-d1`, with 9 oxlint errors, all in `apps/api/src/routes/auth.test.ts`. This branch does not touch that file. A scaffold copy outside git also fails `format:check` on 6 files this branch does not touch (`apps/api/src/env.ts`, `apps/api/src/index.ts`, `packages/auth/src/auth.ts`, `packages/config/src/sections.ts`, `packages/queue/src/index.ts`, `packages/tooling/src/targets.ts`). The acceptance check verifies both against the base.

### Browser checks
_Driven with `playwright-cli` against `http://localhost:3001` at `122e9d2`. Screenshots in `/tmp/qakit/0075-qa-admin-status-tones-detail-slots-table-cards-2026-10-24/`._

- ✅ Sidebar after sign-in · Payments row badge → "Payments 2", equal to the "Submitted 2" chip.
- ✅ `/payments` table · Submitted pill → `open` tone (`oklch(0.915 0.024 256.11)` fill); "Amount differs" → `warn` tint with `oklch(0.555 0.163 48.998)` text.
- ✅ `/payments`, `order · 1002` panel · header → "order · 1002 Submitted Amount differs"; banner → an `alert` slot reading "Nothing here is verified. …"; footer → "Confirm payment Reject…"; attribute labels → no "Status" row; no note card outside the panel.
- ✅ Same panel at 1280 px · body scrolled 119 px of 619 → banner and footer stay in view.
- ✅ Reject… · dialog → a `dialog-popup` with one Reason combobox and one textarea; the page has no native `<dialog>` or `<select>`; "Reject payment" is disabled until a reason is chosen; Escape closes the dialog and leaves the panel open.
- ✅ Error path · confirm a payment of an unregistered provider → the footer shows the api error above the buttons.
- ✅ Confirm `order · 1001` with no reload (same document) → the sidebar badge goes from 2 to 1; the panel footer changes to "Record refund…".
- ✅ Reject `order · 1002` with "Transaction not found" → the sidebar Payments row shows no badge; the queue shows "No payments wait for review".
- ✅ 360 px · Payments, Users, Billing, Teams, API keys, Roles → no table mounted, 2, 4, 2, 1, 2 and 4 cards, horizontal overflow 0 on each page.
- ✅ 360 px sheet, `order · 1002` · body scrolled 343 px of 767 → banner and footer stay in view.
- ✅ Panel headers at 1280 px · Users → role pill in the header, no Role row at the top; Teams → "Active" in the header, no Status row; API keys → "Enabled" in the header, no Status row; Roles → no status in the header, no banner, no footer.
- ✅ Claude tweakcn preset injected as `:root[data-preset="claude"]` · `--destructive-foreground` turns `oklch(1.0000 0 0)` → `ok`, `warn` and `bad` pills keep the same fill and text colour (bad: `oklch(0.505 0.213 27.518)` text before and after).
- ✅ `/payments` console → 0 errors, 0 warnings.

## Not covered / needs human judgment
- The Billing invoice panel: the console billing provider lists no invoices, so no invoice record or its header status was shown.
- The refund dialog: the agent did not drive it. Its fields moved to the admin parts with the same validation.
- A real `saasaloy theme add`: plan 0071 is not built, so the preset check injects Claude's colour keys by hand.
- The Postgres driver: the scaffold uses `database-d1` only.
- Performance and concurrency: the change adds one count request per minute per visible tab; no load test.
- Seed data note: `order · 1002` has the method Nagad and the receiving account "bKash personal". The seed slice sets both; this branch does not change them.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
