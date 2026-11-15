# QA Plan: admin audit log, members screen and route gate

_Generated 2026-11-05 · against `fb3009c8` (clean) · covers issue #310: `audit_events`, `adminWrite` and `adminAuthWrite`, the `/members` and `/activity` screens, the overview fix, `adminGate`, the closed `/admin/auth/admin/*` endpoints, the `/admin/flags` mount, audited payment writes, and module seed files_

## Summary

- Every admin write under `/admin/` writes one audit row, and staff read those rows on the new Activity screen and manage the admin group on the new Members screen.
- Working means: each write leaves one correct row, each signed-out request gets 401, each role sees only the controls it may use, and both screens match the approved round 1 mockup.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-310-add-the-admin-audit-log`, commit `fb3009c8`, working tree clean.
- The app under test is the scaffold `.dev/fresh`: modules `admin`, `payment`, `feature-flags` on `database-d1`, testing on, migrations generated.
- `.dev/fresh` is a disposable target. `CONTRIBUTING.md` ("Manual QA: the `.dev/playground`") declares the scaffolds in `.dev/` throwaway. Its database reset is `pnpm db:drop && pnpm db:setup && pnpm db:seed` from the scaffold root.
- The agent added `payment-manual`, `kv-memory` and `payment-console` to `.dev/fresh`. Its env names `PAYMENT_PROVIDER=manual` and `KV_PROVIDER=memory`, and the seed has a `console` payment, but none of the three providers was installed. They stay installed.
- Api base URL: `http://localhost:4000`. Admin app base URL: `http://localhost:3001`.
- Logins, all with the password `saasaloy-dev-password`: `superadmin@example.test` (superadmin), `admin@example.test` (admin), `member@example.test` (a plain user, refused by the admin sign-in).
- The admin app starts in dark mode. The account menu has a "Theme" submenu.
- Screenshots: local to this run at `fb3009c8` and not committed. The names under each case match the labels in the gallery.
- The approved mockups are `docs/plans/assets/0101-mockup-r1-*.png`.

Set the api base URL once:

```sh
export BASE_URL=http://localhost:4000
```

Set the database client once, in bash, from `.dev/fresh/packages/db`. Every query below runs through it.

```sh
export DB_CMD='pnpm exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --json --command'
```

Make the database, from `.dev/fresh`:

```sh
pnpm db:setup && pnpm db:seed
```

Start the api in one terminal, from `.dev/fresh`:

```sh
pnpm --filter ./apps/api dev
```

Start the admin app in a second terminal, from `.dev/fresh`:

```sh
pnpm --filter ./apps/admin dev
```

Get a superadmin cookie for the `curl` steps:

```sh
curl -s -c /tmp/qa310-superadmin.jar -o /dev/null -w '%{http_code}\n' -X POST "$BASE_URL/admin/auth/sign-in/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3001' -d '{"email":"superadmin@example.test","password":"saasaloy-dev-password"}'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: superadmin, worst-case members and audit rows | The Members screen matches the mockup | 🔴 Critical |
| TC-1.2 | 1: superadmin, worst-case members and audit rows | The member dialogs read correctly | 🟡 Normal |
| TC-1.3 | 1: superadmin, worst-case members and audit rows | The Activity screen matches the mockup | 🔴 Critical |
| TC-1.4 | 1: superadmin, worst-case members and audit rows | The overview matches the mockup, also with the api down | 🟡 Normal |
| TC-1.5 | 1: superadmin, worst-case members and audit rows | Add, remove and restore feel right in the live app | 🔴 Critical |
| TC-2.1 | 2: admin, same data | An admin sees no superadmin control | 🟡 Normal |

## Scenario 1: superadmin, worst-case members and audit rows

**Setup.** Run once, for every case in this scenario.

1. Add the worst-case members through the api. Run this in bash from any folder.

```sh
for row in "Christopher Alexander Montgomery III|first.last+billing-notifications@example.com|admin" "J|a@b.co|admin" "Đặng Thị Ngọc Hân|hang@example.test|admin" "王秀英|wang@example.test|admin" "نور الهدى عبد الرحمن|nour@example.test|admin" "🦊 Fox|fox@example.test|admin" "  Sam   Lee |sam@example.test|admin" "dana|dana@example.test|admin" "<script>alert(1)</script> &amp;|xss@example.test|admin" "Benachrichtigungseinstellungen Senior Product Design Engineer, Platform Infrastructure Team Lead QA|long@example.test|superadmin"; do IFS='|' read -r n e r <<< "$row"; curl -s -o /dev/null -w "%{http_code} $e\n" -X POST "$BASE_URL/admin/members" -b /tmp/qa310-superadmin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d "$(jq -nc --arg n "$n" --arg e "$e" --arg r "$r" '{name:$n,email:$e,password:"qa-password-123",role:$r}')"; done
```

2. Add 103 audit rows for paging and for long values, from `.dev/fresh/packages/db`. The file is in the worktree's ignored `.dev/notes`.

```sh
pnpm exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --file ../../../notes/qa-310-seed-audit.sql
```

3. Open `http://localhost:3001` and sign in as `superadmin@example.test`.

- [ ] Setup complete

### TC-1.1: The Members screen matches the mockup  ·  🔴 Critical

**Goal.** The Members screen shows the admin group as the approved mockup does, with worst-case names in place.

**Steps**

1. Open `/members`. Compare the screen with `0101-mockup-r1-members-list.png` and `0101-mockup-r1-members-own-row.png`.
   - [ ] The list, tabs, roles and dates match the mockup in dark and in light, at desktop and at phone width
     - long names and emails: truncated cleanly, no row pushed out of line
     - the avatars: `🦊 Fox` shows `🦊F`, with no broken character
     - "Last sign-in" shows a dash where the mockup shows "Never" (a known difference, Phase 6 notes)
     - screenshots: `members-dark-1440` · `members-light-1440` · `members-dark-375` · `members-light-375`
2. Select Alan A. Admin, then select your own row.
   - [ ] The detail panel reads correctly for another member and for yourself
     - another member: role, "Added … by", recent activity with three rows, "View all in Activity", Remove
     - yourself: "Your profile" with Edit name and Change password, no Remove
     - screenshots: `members-detail-dark-1440` · `members-detail-light-375` · `members-own-dark-1440`
3. Open the Removed tab.
   - [ ] The Removed tab matches `0101-mockup-r1-members-removed-tab.png`, with and without removed members
     - screenshots: `members-removed-dark-1440` · `members-removed-empty-dark-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The member dialogs read correctly  ·  🟡 Normal

**Goal.** Each member dialog says what it does and what follows, in words a staff member understands.

**Steps**

1. Look at the add, remove, change-password and reset-password dialogs. Compare them with `0101-mockup-r1-members-add.png`, `0101-mockup-r1-members-remove-confirm.png` and `0101-mockup-r1-members-passwords.png`.
   - [ ] The title, help text, buttons and error message of each dialog read clearly and match the mockup
     - add: the role select offers Superadmin only to a superadmin
     - remove: the destructive button is clear, and Cancel has the focus
     - change password: "Sign out my other sessions" is on, and a wrong current password shows "Invalid password" in the dialog
     - screenshots: `members-add-dark-1440` · `members-remove-confirm-dark-1440` · `members-password-dark-1440` · `members-password-error-dark-1440` · `members-reset-dark-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The Activity screen matches the mockup  ·  🔴 Critical

**Goal.** The Activity screen shows the audit log as the approved mockup does, in every state.

**Steps**

1. Open `/activity?range=all`. Compare it with `0101-mockup-r1-activity-list.png`.
   - [ ] The filters, chips with counts, rows and "Load older" match the mockup in dark and in light, at desktop and at phone width
     - a row whose action no module registers shows its key, `legacy.removed.action`
     - `<script>alert(1)</script> &amp;` shows as literal text
     - screenshots: `activity-dark-1440` · `activity-light-1440` · `activity-dark-375` · `activity-light-375`
2. Look at the empty state for the last 7 days on a fresh database. Compare it with `0101-mockup-r1-activity-empty-loading.png`.
   - [ ] The empty state reads correctly in every variant
     - screenshots: `activity-empty-dark-1440` · `activity-empty-light-1440` · `activity-empty-dark-375` · `activity-empty-light-375`
3. Select the "Recorded a refund" row, then the `legacy.removed.action` row.
   - [ ] The detail panel shows when, who, target, action key and a readable before and after table
     - refund amounts show in minor units (`30000 → 35000`): decide if that is acceptable
     - a 2,000-character value wraps inside the panel, with no horizontal scroll
     - screenshots: `activity-detail-dark-1440` · `activity-detail-worst-dark-1440` · `activity-flags-longurl-dark-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The overview matches the mockup, also with the api down  ·  🟡 Normal

**Goal.** The overview shows three cards that each load and fail on their own, as the mockup does.

**Steps**

1. Open `/`. Compare it with `0101-mockup-r1-overview.png` and `0101-mockup-r1-overview-api-down.png`.
   - [ ] The three cards match the mockup in each variant, and the "Unreachable" card reads as a local failure, not a page failure
     - at phone width the long newest name truncates, and every card stays inside the screen edge
     - screenshots: `overview-dark-1440` · `overview-light-1440` · `overview-dark-375` · `overview-light-375` · `overview-api-down-dark-1440` · `overview-api-down-light-375`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: Add, remove and restore feel right in the live app  ·  🔴 Critical

**Goal.** The member lifecycle is clear and smooth to a person who uses it.

**Steps**

1. On `/members`, select "Add member". Add `Rafi Hasan`, `rafi@example.test`, password `qa-password-123`, role Admin.
   - [ ] The dialog closes, the toast "Rafi Hasan added" shows, and the new row appears without a jump
2. Select Rafi Hasan. Select "Remove member", then confirm.
   - [ ] The confirm step, the toast and the move to the Removed tab feel clear and in order
3. Run this query from `.dev/fresh/packages/db`.

   ```sh
   $DB_CMD "select action, actor_role, before, after from audit_events where target_label = 'rafi@example.test' order by created_at;"
   ```

   - [ ] Two rows: `member.add` with after `{"email":"rafi@example.test","name":"Rafi Hasan","role":"admin"}`, then `member.remove` with `{"removed":false}` → `{"removed":true}`, both by `superadmin`
4. On the Removed tab, select "Restore" on Rafi Hasan.
   - [ ] The row leaves the Removed tab and the toast "Rafi Hasan restored" shows
5. Open `/activity`. Select the newest row.
   - [ ] The three newest rows read "Restored a member", "Removed a member", "Added a member", and the flow from Members to Activity feels natural

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** None here. Scenario 2 runs on the same data, and its Reset restores the database.

## Scenario 2: admin, same data

**Setup.** Run once, for every case in this scenario.

1. Open the account menu, select "Sign out", then sign in as `admin@example.test`.

- [ ] Setup complete

### TC-2.1: An admin sees no superadmin control  ·  🟡 Normal

**Goal.** An admin reads the Members screen without a control that would only answer 403.

**Steps**

1. Open `/members`. Select another member, such as dana.
   - [ ] The screen and the panel read well without "Add member", Remove, Reset password and Restore
     - the panel note "Only a superadmin can remove a member or reset another member's password." explains the absence
     - screenshots: `members-admin-dark-1440` · `members-admin-other-dark-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run from `.dev/fresh`.

```sh
pnpm db:drop && pnpm db:setup && pnpm db:seed
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Target: `.dev/fresh`, a declared disposable target. Reset: `pnpm db:drop && pnpm db:setup && pnpm db:seed`. The agent ran Scenario 1's Setup there, wrote through the api, and reset the database at the end (`.dev/notes/qa-fresh-reset.log`).

### Repo gate at `fb3009c8`, clean

The green result before the commits does not bind to this sha, so the agent ran all three again. Logs: `.dev/notes/qa-lint.log`, `qa-typecheck.log`, `qa-test.log`.

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

- ✅ `pnpm lint` → exit 0. oxlint type-aware, oxlint plain, Stylelint, and "All matched files use Prettier code style!"
- ✅ `pnpm typecheck` → exit 0 (turbo replayed a cache hit for `saasaloy:typecheck`, same inputs)
- ✅ `pnpm test` → exit 0. CLI vitest 1967 of 1967 in 75 files; `test:modules` 1063 of 1063; then 91, 147 and 547 more, 0 fail

### Scaffold gate in `.dev/fresh`

```sh
pnpm exec vitest run apps/api
```

```sh
pnpm typecheck
```

- ✅ shipped api tests (`admin-gate`, `audit-coverage`, `admin-write`, `admin-members`, `admin-audit`, `admin-users`, `auth` and others) → 8 files, 78 of 78 pass (`.dev/notes/qa-fresh-vitest.log`)
- ✅ scaffold `pnpm typecheck` → 14 of 14 tasks (`.dev/notes/qa-fresh-typecheck.log`)

### Database static facts (D1, local file under `.dev/fresh/apps/api/.wrangler/state`)

```sh
$DB_CMD "select name, type, \"notnull\", pk from pragma_table_info('audit_events');"
```

```sh
$DB_CMD "select name, sql from sqlite_master where type='index' and tbl_name='audit_events';"
```

```sh
$DB_CMD "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('audit_events');"
```

```sh
$DB_CMD "select name from d1_migrations;"
```

- ✅ table → `audit_events` has `id` TEXT pk, `actor_user_id`, `actor_role`, `action`, `target_type`, `target_id`, `target_label` TEXT not null, `before` and `after` TEXT nullable, `created_at` INTEGER not null
- ✅ indexes → `audit_events_created_at_idx (created_at)`, `audit_events_actor_user_id_idx (actor_user_id, created_at)`, `audit_events_target_type_target_id_idx (target_type, target_id, created_at)`
- ✅ constraint → foreign key `actor_user_id` → `users.id`
- ✅ migration → `0000_omniscient_iron_fist.sql` applied, and it holds `CREATE TABLE audit_events`

### Gate and closed endpoints, signed out

```sh
for r in "GET /admin/users?limit=abc" "GET /admin/members" "POST /admin/members" "PATCH /admin/members/x" "POST /admin/members/x/password" "DELETE /admin/members/x" "POST /admin/members/x/restore" "GET /admin/audit-events?cursor=%25%25" "GET /admin/audit-events/people" "GET /admin/payment/payments?status=nope" "GET /admin/payment/review-count" "GET /admin/payment/payments/x" "POST /admin/payment/payments/x/review" "POST /admin/payment/payments/x/refunds" "GET /admin/flags" "GET /admin/flags/k" "PUT /admin/flags/k" "PUT /admin/flags/k/tenants/t" "DELETE /admin/flags/k/tenants/t"; do set -- $r; printf '%s %s -> ' $1 $2; curl -s -o /dev/null -w '%{http_code}\n' -X $1 "$BASE_URL$2" -H 'Content-Type: application/json' -d '{"bad":'; done
```

```sh
curl -s -i -X POST "$BASE_URL/admin/auth/admin/set-role" -b /tmp/qa310-superadmin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d '{"userId":"x","role":"superadmin"}'
```

```sh
curl -s -o /dev/null -w '%{http_code}\n' "$BASE_URL/flags" -b /tmp/qa310-superadmin.jar
```

- ✅ 19 gated routes, no cookie, malformed body and query → 401 on every one, never 400
- ✅ `POST /admin/auth/admin/set-role` as superadmin → 404 `{"error":{"code":"not_found","message":"not found"}}`; `list-users`, `get-user`, `impersonate-user`, `ban-user` → 404 too
- ✅ old `GET /flags` → 404; the Flags screen calls `/admin/flags`
- ✅ `member@example.test` at `/admin/auth/sign-in/email` → 401 "Invalid email or password"; its client cookie on `GET /admin/members` → 401

### Roles and inputs, signed in

Admin cookie, as the Environment step makes the superadmin one:

```sh
curl -s -c /tmp/qa310-admin.jar -o /dev/null -w '%{http_code}\n' -X POST "$BASE_URL/admin/auth/sign-in/email" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3001' -d '{"email":"admin@example.test","password":"saasaloy-dev-password"}'
```

```sh
curl -s -w '\n%{http_code}\n' -X DELETE "$BASE_URL/admin/members/f36f96b0-839e-5d8a-97b2-0c6c22a61fab" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001'
```

```sh
curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/admin/members" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d '{"email":"qa-new@example.test","name":"QA New","password":"qa-password-123","role":"admin"}'
```

```sh
curl -s -w '\n%{http_code}\n' "$BASE_URL/admin/audit-events?cursor=not-a-cursor" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001'
```

```sh
curl -s -w '\n%{http_code}\n' "$BASE_URL/admin/audit-events?limit=51" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001'
```

```sh
curl -s "$BASE_URL/admin/users?limit=5&sortBy=createdAt&sortDirection=desc" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001'
```

```sh
curl -s -w '\n%{http_code}\n' "$BASE_URL/admin/users?limit=101" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001'
```

```sh
curl -s -w '\n%{http_code}\n' -X DELETE "$BASE_URL/admin/members/f36f96b0-839e-5d8a-97b2-0c6c22a61fab" -b /tmp/qa310-superadmin.jar -H 'Origin: http://localhost:3001'
```

- ✅ admin `DELETE /admin/members/<superadmin id>` → 403 "Only a superadmin can remove a member."
- ✅ admin `POST /admin/members` role admin → 403 "only a superadmin may change an admin-group account or role" (rank guard)
- ✅ admin bad cursor → 400 "cursor: not a cursor this api gave"
- ✅ admin `limit=51` → 400 "limit: Too big: expected number to be <=50"
- ✅ `GET /admin/users?limit=5&sortBy=createdAt&sortDirection=desc` → `{ total: 4, users: 4 }` on the seeded database
- ✅ `limit=101` → 400 "limit: Too big: expected number to be <=100"
- ✅ superadmin removes self → 400 "You cannot remove yourself."
- ✅ admin renames self (`PATCH`, `{"name":"Alan A. Admin"}`) → 200; admin renames the superadmin → 403 "You can change only your own name."
- ✅ admin own password with a wrong `currentPassword` → 400 "Invalid password"; admin sets the superadmin's password → 403; admin restores a member → 403
- ✅ superadmin sets dana's password (`{"newPassword":"new-password-456"}`) → 200 `{"changed":true}`, and dana signs in with it → 200
- ✅ superadmin adds a removed member's email again → 409 `member_removed` with the member and its `removedAt`
- ✅ removed member signs in → 403; after restore → 200
- ✅ two concurrent `DELETE` of dana → one 200, one 400, and one `member.remove` row

### Audit rows on the disposable target

Ten worst-case members added through `POST /admin/members` (201 each), then these writes:

```sh
curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/admin/payment/payments/9ab2cb50-dffe-56f2-aef0-5ff3436593d1/review" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d '{"action":"confirm","note":"QA-310 confirm"}'
```

```sh
curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/admin/payment/payments/76bc1284-41e0-5b3b-b444-ad21340a650a/review" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d '{"action":"reject","reason":"duplicate","note":"QA-310 reject"}'
```

```sh
curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/admin/payment/payments/af61dcb0-9def-5f10-a14a-ee5a7e041d9b/refunds" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d '{"amount":5000,"note":"QA-310 refund"}'
```

```sh
curl -s -w '\n%{http_code}\n' -X PUT "$BASE_URL/admin/flags/kill.ai" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d '{"enabled":true,"percentage":null}'
```

```sh
curl -s -w '\n%{http_code}\n' -X PUT "$BASE_URL/admin/flags/kill.ai/tenants/tenant-qa-310" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001' -H 'Content-Type: application/json' -d '{"enabled":false,"percentage":null}'
```

```sh
curl -s -w '\n%{http_code}\n' -X DELETE "$BASE_URL/admin/flags/kill.ai/tenants/tenant-qa-310" -b /tmp/qa310-admin.jar -H 'Origin: http://localhost:3001'
```

```sh
$DB_CMD "select (select count(*) from audit_events where lower(coalesce(before,'') || coalesce(after,'')) like '%password%') as pw_rows, (select count(*) from audit_events a left join users u on u.id = a.actor_user_id where u.id is null) as orphan_actors;"
```

- ✅ payment confirm, reject, refund → one row each: `payment.review.confirm` `{status: submitted} → {status: successful, note}`, `payment.review.reject` `→ {status: failed, reason: duplicate}`, `payment.refund.create` `{refundedAmount: 30000} → {refundedAmount: 35000, refund.amount: 5000, refund.id, refund.note}`
- ✅ flag writes → `flag.value.set` `{enabled:false} → {enabled:true}`, `flag.tenant.set` `null → {enabled:false, percentage:null}`, `flag.tenant.clear` `{…} → null`, target `kill.ai · tenant tenant-qa-310`
- ✅ member writes → `member.add` after `{email, name, role}`, `member.profile.update` `{name: Alan Admin} → {name: Alan A. Admin}`, `member.password.set` with `before` and `after` both null, `member.remove` `{removed:false} → {removed:true}`
- ✅ `removedAt` in `GET /admin/members` equals the `member.remove` row time exactly (`2026-11-05T01:54:11.746Z`)
- ✅ no row has a key or value that contains "password"; no row has an orphan actor
- ✅ a body that throws leaves no row on D1: before the providers were installed, review and refund answered 500 (`PAYMENT_PROVIDER names "manual", which is not registered`), and the payment stayed `submitted` with 0 `payment.*` rows
- ✅ keyset paging, 126 rows → pages of 50, 50, 26; `nextCursor` null on the last; 0 duplicate ids across pages; newest first
- ✅ page-size boundary → `q=qa-fifty-` (50 rows) gives 50 and `nextCursor` null; `q=qa-fiftyone-` (51 rows) gives 50, then 1, then null
- ✅ chip counts → `all 126 = members 118 + payments 3 + flags 4 + 1 unregistered`; an unregistered action answers `label` = its key and `area` null

### Browser checks

Re-checked after the fix round, on the uncommitted tree based on `fb3009c8`.

_Driven with `playwright-cli` (session `qa310`, headless Chromium) against `http://localhost:3001` at `fb3009c8`. 33 screenshots at 1440 px and 375 px in dark and light, local to this run and not committed. `DESIGN.md` names one breakpoint, `md`, so the widths are 1440 and 375._

- ✅ `/` · requests → `/health`, one `GET /admin/users?limit=5&sortBy=createdAt&sortDirection=desc`, `/admin/payment/review-count`; no 100-row fetch
- ✅ `/` · cards → "API health Healthy", "Users 4", "Newest sign-ups" with four seeded users
- ✅ `/` · `/health` routed to 500 → h1 "Overview" renders, the health card shows "Unreachable", Users and Newest sign-ups fill, `/health` tried 2 times, no error boundary
- ✅ `/members` as superadmin → one "Add member" button; as admin → 0 "Add member", 0 Remove or Reset buttons in another member's panel, 0 Restore buttons
- ✅ `/members` · Add member dialog → focus starts in Name; a 63-character email causes no dialog overflow; the new row appears
- ✅ `/members` · remove → the alert dialog title "Remove Christopher Alexander Montgomery III?", Cancel has the focus, toast "Christopher Alexander Montgomery III removed", Removed tab lists him with "Today, 01:54" and "Ada Superadmin"
- ✅ `/members` · restore → toast "J restored", tabs "Active 12" and "Removed 1"
- ✅ `/members` · own Change password with a wrong current password → the dialog stays open and shows "Invalid password"
- ✅ `/members` · panel "View all in Activity" → `href="/activity?actor=<member id>"`
- ✅ `/activity` · fresh database, last 7 days → empty state "No activity matches", chips all 0, no overflow at 1440 or 375
- ✅ `/activity` · first page → 50 rows, chips "All 124", "Members 116", "Payments 3", "Flags 4", one "Load older"
- ✅ `/activity` · "Load older" twice → 100, then 124 rows, 124 distinct, the button gone; requests carry `cursor=2026-11-05T00:58:14.218Z~qa310-75`, then `~qa310-25`
- ✅ `/activity` · filters in the URL → Payments chip gives `?area=payments`; All time adds `&range=all`; a person adds `actor=59f104ac-…`; a reload keeps all three and 3 rows
- ✅ `/activity` · detail panel → "Recorded a refund", "5 Nov 2026, 01:56:40", "Alan A. Admin admin", target "order · 1004", action `payment.refund.create`, four changed fields
- ✅ `/activity` · `<script>alert(1)</script> &amp;` → literal text, 0 `script` elements in `main`; the embedded newline renders as two lines
- ✅ `/flags` → calls `GET /admin/flags`, shows "Flags 4" and the flag list; `/payments` → calls `/admin/payment/payments?status=submitted`
- ✅ console → 0 errors and 0 warnings on `/`, `/members`, `/activity` (the first load logs one `favicon.ico` 404, outside this change)
- ✅ every screen, both themes, both widths → page `scrollWidth` equals `clientWidth`; no `undefined`, `null` or `NaN` text
- ✅ 🟡 `/` · Newest sign-ups name = `Benachrichtigungseinstellungen Senior Product Design Engineer, Platform Infrastructure Team Lead QA` @ 375 → all three cards end at 358 px, the same edge as with a short name; the name truncates with an ellipsis at 333 px and carries the full name as its `title`; page `scrollWidth` 375
- ✅ 🟡 `/activity` · Target = a 148-character URL @ 1440 → the table is 1174 px in a 1174 px box with no sideways scroll; the Target cell truncates at 320 px with an ellipsis and a `title` that holds the full URL
- ✅ 🟡 `/activity` · detail panel, `after.description` = 2,000 characters @ 1440 → the value wraps inside the 383 px panel: table 351 px in a 351 px box, value cell `scrollWidth` 120 equals its `clientWidth` 120 (`overflow-wrap: anywhere`); Field keeps 112 px and Before keeps 120 px, and the stored newline in Before shows
- ✅ 🟡 `/activity` · search `q` = `1004` → 1 row, and the URL becomes `?actor=…&area=payments&range=all&q="1004"` (the router quotes a numeric string) after the 300 ms pause; after a reload the field holds `1004` and 1 row shows; a typed `?q=1004` also loads 1 row; "Clear filters" empties the field and the URL
- ✅ 🟡 `/members`, `/activity` · avatar for name = `🦊 Fox` → initials `🦊F` (code points `1f98a`, `46`), no lone surrogate, on the Members row and on the Activity row of a change Fox made
- ✅ 🟢 `/members` and `/activity` @ 375 · email `bartholomew.fitzgerald@northwind-industries-holdings.example.com`, the long name, `<script>alert(1)</script> &amp; Benachrichtigungseinstellungen` and the long URL → every truncated value has a `title` that equals its full text; the member panel heading and its email carry a `title` too
- ✅ 🟢 `/members` · name `نور الهدى عبد الرحمن` → `dir="auto"`, computed `direction: rtl`; names, emails, target labels and both search fields carry `dir="auto"`
- ✅ 🟢 `/members` Removed tab · two removed members → buttons named "Restore J" and "Restore Christopher Alexander Montgomery III", 0 buttons named only "Restore"
- ✅ 🟢 `/activity` · "Load older" twice → 50, 100, then 121 rows and the button gone; all three requests send the same `from` (`2026-10-29T02:48:14.046Z`), and the later two add `cursor=…~qa310-72`, then `~qa310-22`

## Not covered / needs human judgment

- Visual match with the approved mockup, copy, and the feel of each flow. These are the manual cases above.
- Nav shortcuts `G M` and `G A`. They need the `command` module, and `.dev/fresh` does not have it. `G U` does not work there either.
- Escape on a detail panel. It does not close the panel on `/members`, `/activity` or the older `/users`, so this change did not cause it.
- The overview health card loading state on its own. The driver cannot hold a response open. The api-down state covers the separate failure.
- Postgres. The run used `database-d1` only. The Postgres rollback of a throwing `adminWrite` is covered by the shipped tests, not by this run.
- `saasaloy update` on an existing project, the seed-file rules and the update notes. The CLI tests in `pnpm test` cover them; this run drove no update.
- Audit of `/admin/auth/organization/*` and `/admin/auth/api-key/*`. This is a non-goal (#142).
- Real browsers other than headless Chromium, real phones, and screen readers.
- Performance with a large log. The run used 128 rows only.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
