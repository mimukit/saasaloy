# QA Plan: the `notification` module (issue #313)

_Generated 2026-11-05 · against `c27639c3` (clean) · covers the bell, the menu, the sidebar badge, the `/notifications` page with its Inbox and Preferences tabs, the six `/notifications` api routes and the two tables, in the `.dev/playground` project on `database-d1`_

## Summary
- The module gives a signed-in `apps/app` user a bell with an unread badge, a sidebar row with the same count, and a page that lists and opts out of notifications.
- "Working" means a user sees and changes only their own rows, and the count stays correct after each read, on a failed fetch and across tabs.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-313-add-in-app-notifications` at `c27639c3`, worktree `/home/dev/worktrees/saasaloy/issue-313-add-in-app-notifications`.
- Target: `.dev/playground`, the disposable playground that CONTRIBUTING.md documents. Its baseline commit `324ea98` holds `app` and `notification` on `database-d1`, with the testing mode `tests-after`. `pnpm play:restore` (from the repo root) resets it. The module files in the playground are identical to the module files at `c27639c3`.
- Ports: this run uses api `http://localhost:4100` and app `http://localhost:3102`, because another worktree holds 3000, 3001 and 4000. On a free machine, use the default ports 4000 and 3002 and skip the port edits below.
- Credentials: `member@example.test` (2 unread rows, 2 read rows) and `admin@example.test` (1 unread row). The password for both is `saasaloy-dev-password`.
- Approved mockup: `docs/plans/assets/0104-notification-mockup-r1/` (`menu-*`, `inbox-*`, `prefs-*` at 1440 and 360 px, `states-*` at 1440 px). The mockup row text is example data. The scaffold ships two categories, Account and Product.
- Screenshots: local to this run at `c27639c3` and not committed. The names under each case match the labels in the gallery.
- Run every command below in `bash`, from `.dev/playground` unless the step says otherwise.

Set the api and app ports for this run (skip on a free machine):

```sh
sed -i 's/port: 4000, strictPort/port: 4100, strictPort/' apps/api/vite.config.ts && sed -i 's/port: 3002, strictPort/port: 3102, strictPort/' apps/app/vite.config.ts && sed -i 's/"port": 4000,/"port": 4100,/' apps/api/wrangler.jsonc
```

```sh
sed -i 's#^BETTER_AUTH_URL=.*#BETTER_AUTH_URL=http://localhost:4100#; s#^CORS_ORIGINS=.*#CORS_ORIGINS=http://localhost:3102#' apps/api/.env && sed -i 's#^PUBLIC_API_URL=.*#PUBLIC_API_URL=http://localhost:4100#' apps/app/.env
```

Set the base URLs and the database client once. Every query below runs through `$DB_CMD`.

```sh
export BASE_URL=http://localhost:4100 APP_URL=http://localhost:3102
```

```sh
export DB_CMD='pnpm --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command'
```

Fill the local database with the seed rows:

```sh
timeout 180 pnpm db:seed
```

Launch the api and the app, each in its own terminal:

```sh
cd apps/api && pnpm exec vite dev --host
```

```sh
cd apps/app && pnpm exec vite dev --host
```

Sign in with curl for the api cases (the cookie jars go in the current folder):

```sh
curl -s -c member.jar -X POST "$BASE_URL/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $APP_URL" -d '{"email":"member@example.test","password":"saasaloy-dev-password"}' -o /dev/null -w '%{http_code}\n'
```

```sh
curl -s -c admin.jar -X POST "$BASE_URL/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $APP_URL" -d '{"email":"admin@example.test","password":"saasaloy-dev-password"}' -o /dev/null -w '%{http_code}\n'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Seeded member, 2 unread rows | The bell menu matches the mockup | 🔴 Critical |
| TC-1.2 | 1: Seeded member, 2 unread rows | The page matches the mockup | 🔴 Critical |
| TC-1.3 | 1: Seeded member, 2 unread rows | Opening a row and "Mark all read" feel right | 🟡 Normal |
| TC-1.4 | 1: Seeded member, 2 unread rows | A screen reader announces the bell and the rows | 🟢 Low |
| TC-1.5 | 1: Seeded member, 2 unread rows | Worst-case row text stays readable | 🟢 Low |
| TC-2.1 | 2: Member with no rows | The empty and failed states match the mockup | 🟡 Normal |
| TC-3.1 | 3: Two seeded users, api only | A user reads and changes only their own rows | 🔴 Critical |
| TC-3.2 | 3: Two seeded users, api only | A second mark-read keeps the first read time | 🔴 Critical |
| TC-3.3 | 3: Two seeded users, api only | Preferences refuse a required or unknown category | 🔴 Critical |
| TC-3.4 | 3: Two seeded users, api only | Paging and "Mark all read" cover every row | 🔴 Critical |

## Scenario 1: Seeded member, 2 unread rows

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3102/sign-in` in a desktop browser.
2. Sign in as `member@example.test` with the password `saasaloy-dev-password`.
3. Make sure that the bell in the header shows the badge `2`.

- [ ] Setup complete

### TC-1.1: The bell menu matches the mockup  ·  🔴 Critical

**Goal.** The bell, its badge and its open menu look like the approved mockup round 1 in both themes and at both widths.

**Steps**

1. Set the theme to Light in the account menu. Click the bell at 1440 px width.
   - [ ] The open menu looks like `menu-light-1440.png` in the mockup folder
     - the bell badge: red, round, legible `2`, not clipped by the header
     - the two unread rows: a blue dot, a bold title and a tinted background
     - the two read rows: no dot, a normal title
     - the header row: "Notifications" and "Mark all read"; the footer: "View all notifications"
     - screenshots: `menu-light-1440` · `menu-dark-1440` · `menu-light-375` · `menu-dark-375`
2. Set the theme to Dark. Open the menu again. Resize the window to 375 px and open the menu again.
   - [ ] The same look is clean in dark and at 375 px, with no row text that is illegible on its background

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The page matches the mockup  ·  🔴 Critical

**Goal.** The Inbox and Preferences tabs of `/notifications` look like the approved mockup round 1.

**Steps**

1. Click "View all notifications" in the menu. Stay on the Inbox tab, in Light, at 1440 px.
   - [ ] The Inbox tab looks like `inbox-light-1440.png` in the mockup folder
     - the header: "Notifications", the line "Newest first. Read rows are kept for 30 days.", and the "Mark all read" button
     - the tab row: "Inbox" with "2 unread", and "Preferences"
     - the sidebar: the Notifications row with the badge `2`
     - screenshots: `inbox-light-1440` · `inbox-dark-1440` · `inbox-light-375` · `inbox-dark-375`
2. Click the Preferences tab.
   - [ ] The Preferences tab looks like `prefs-light-1440.png`, and its copy reads well
     - Account: the switch is on and disabled, with "Required. These cannot be turned off."
     - Product: the switch is on and enabled
     - the note under the list about old rows that stay in the inbox
     - screenshots: `prefs-light-1440` · `prefs-dark-1440` · `prefs-light-375` · `prefs-dark-375`
3. Set the theme to Dark, then resize to 375 px. Look at both tabs again.
   - [ ] The same two tabs are clean in dark and at 375 px; at 375 px "Mark all read" shows its icon only

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: Opening a row and "Mark all read" feel right  ·  🟡 Normal

**Goal.** The two read actions give clear, quick feedback with no flicker of the count.

**Steps**

1. Open the menu. Click "Your export is ready" (a row with no link).
   - [ ] The menu closes, the page stays, and the badge changes to `1` with no flash of an empty or wrong badge
2. Open the menu. Click "Mark all read".
   - [ ] The button shows its loading state, the rows lose their unread look, and the badge goes away in the same moment as the sidebar count

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: A screen reader announces the bell and the rows  ·  🟢 Low

**Goal.** A screen-reader user hears the unread count and which rows are unread.

**Steps**

1. Run the Reset of this scenario, then sign in again. Start VoiceOver or NVDA. Move the focus to the bell with Tab, then open the menu with Enter.
   - [ ] The reader says "Notifications, 2 unread" on the bell, and says "Unread:" before each unread row title

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: Worst-case row text stays readable  ·  🟢 Low

**Goal.** Long, unbroken, right-to-left and CJK text in a row reads acceptably at both widths.

**Steps**

1. Open the gallery and look at the worst-case captures. The agent served these rows through a browser mock.
   - [ ] Each row reads acceptably: in the menu the title and the body end in an ellipsis, in the Inbox they wrap, and the RTL title reads right to left
     - screenshots: `menu-worst-light-1440` · `menu-worst-light-375` · `inbox-worst-light-1440` · `inbox-worst-light-375` · `bell-99plus-light-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2. It deletes the seeded notification rows and the opt-outs, then writes the seed rows again.

```sh
$DB_CMD "delete from notifications; delete from notification_opt_outs;" && timeout 180 pnpm db:seed
```

## Scenario 2: Member with no rows

**Setup.** Run once, for every case in this scenario.

1. Delete the member's rows:

```sh
$DB_CMD "delete from notifications where user_id = (select id from users where email = 'member@example.test');"
```

2. Sign in to `http://localhost:3102` as `member@example.test`. Make sure that the bell shows no badge.

- [ ] Setup complete

### TC-2.1: The empty and failed states match the mockup  ·  🟡 Normal

**Goal.** A user with no rows, and a user whose row fetch fails, see a clear state that matches `states-*` in the mockup.

**Steps**

1. Open the menu. Then open `/notifications`.
   - [ ] The menu and the Inbox tab show "No notifications yet" with its line, as in `states-light-1440.png`
     - screenshots: `menu-empty-light-1440` · `menu-empty-dark-1440` · `inbox-empty-light-1440` · `inbox-empty-dark-1440`
2. Stop the api server (Ctrl+C in its terminal). Reload `/notifications`, then open the menu.
   - [ ] The failed state reads well: "Could not load notifications", "Check your connection and try again." and a "Try again" button
     - screenshots: `menu-error-light-1440` · `menu-error-dark-1440` · `inbox-error-light-1440` · `inbox-error-dark-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3. Start the api server again first.

```sh
$DB_CMD "delete from notifications; delete from notification_opt_outs;" && timeout 180 pnpm db:seed
```

## Scenario 3: Two seeded users, api only · run by the agent on `.dev/playground` at `c27639c3`

**Setup.** Run once, for every case in this scenario.

1. Make sure that the seed rows are in place and that `member.jar` and `admin.jar` exist (Environment).

```sh
$DB_CMD "select u.email, count(n.id) as total, sum(case when n.read_at is null then 1 else 0 end) as unread from users u join notifications n on n.user_id = u.id group by u.email;"
```

- [x] Setup complete: member has 4 rows (2 unread), admin has 1 row (1 unread)

### TC-3.1: A user reads and changes only their own rows  ·  🔴 Critical

**Goal.** No route lets one user read, count or mark another user's rows.

**Steps**

1. Read the member's list and both counts.

   ```sh
   curl -s -b member.jar "$BASE_URL/notifications" -w '\n%{http_code}\n'
   ```

   ```sh
   curl -s -b member.jar "$BASE_URL/notifications/unread-count" && curl -s -b admin.jar "$BASE_URL/notifications/unread-count"
   ```

   - [x] The member list holds 4 rows, none of them "You were made an admin"; the counts are `{"count":2}` and `{"count":1}`
2. As the member, mark the admin's row read.

   ```sh
   curl -s -b member.jar -X POST "$BASE_URL/notifications/$($DB_CMD "select id from notifications where title = 'You were made an admin';" --json | grep -o '"id": "[^"]*"' | cut -d'"' -f4)/read" -w '\n%{http_code}\n'
   ```

   ```sh
   $DB_CMD "select title, read_at from notifications where title = 'You were made an admin';"
   ```

   - [x] The api answers 404 `not_found`, and the admin row still has `read_at` null
3. Call each route with no session.

   ```sh
   for r in "GET /notifications" "GET /notifications/unread-count" "POST /notifications/read-all" "POST /notifications/x/read" "GET /notifications/preferences"; do set -- $r; curl -s -o /dev/null -X $1 "$BASE_URL$2" -w "$r %{http_code}\n"; done
   ```

   - [x] Every route answers 401

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _Run by the agent. Output, trimmed:_ list `200`, 4 rows: `New sign-in to your account`, `Your export is ready`, `Your email address was verified`, `New: better search`. Counts `{"count":2}` and `{"count":1}`. Member marks the admin row: `{"error":{"code":"not_found","message":"No such notification."}} 404`, and the admin row keeps `read_at: None`. A missing id answers the same 404; a 129-character id answers `400 invalid_input`. No session: `GET /notifications 401`, `GET /notifications/unread-count 401`, `POST /notifications/read-all 401`, `POST /notifications/x/read 401`, `GET /notifications/preferences 401`. A `PUT /notifications/preferences` with no session and no body answers `400 invalid_input`, because the body validator runs before `requireSession`; with a valid body it answers `401 unauthorized`.

### TC-3.2: A second mark-read keeps the first read time  ·  🔴 Critical

**Goal.** Mark read is idempotent and writes `read_at` on the one row it names.

**Steps**

1. Mark "Your export is ready" read twice, and read the row after each call.

   ```sh
   ID=$($DB_CMD "select id from notifications where title = 'Your export is ready';" --json | grep -o '"id": "[^"]*"' | cut -d'"' -f4) && curl -s -b member.jar -X POST "$BASE_URL/notifications/$ID/read" -w ' %{http_code}\n' && $DB_CMD "select title, read_at from notifications where id = '$ID';" --json | grep read_at
   ```

   ```sh
   curl -s -b member.jar -X POST "$BASE_URL/notifications/$ID/read" -w ' %{http_code}\n' && $DB_CMD "select title, read_at from notifications where id = '$ID';" --json | grep read_at && curl -s -b member.jar "$BASE_URL/notifications/unread-count"
   ```

   - [x] Both calls answer 200 `{"ok":true}`, `read_at` is the same value after both, and the count is `{"count":1}`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _Run by the agent. Output, trimmed:_ first call `{"ok":true} 200`, `read_at: 1793839884339`; second call 1.2 s later `{"ok":true} 200`, `read_at: 1793839884339` (same value); count `{"count":1}`.

### TC-3.3: Preferences refuse a required or unknown category  ·  🔴 Critical

**Goal.** An opt-out writes one row, and a refused body writes nothing.

**Steps**

1. Turn Product off as the member.

   ```sh
   curl -s -b member.jar -X PUT "$BASE_URL/notifications/preferences" -H 'Content-Type: application/json' -H "Origin: $APP_URL" -d '{"categories":{"product":false}}' -w '\n%{http_code}\n'
   ```

   ```sh
   $DB_CMD "select o.category, u.email from notification_opt_outs o join users u on u.id = o.user_id;"
   ```

   - [x] The api answers 200 with `product` `enabled: false`, and one opt-out row exists for `member@example.test`, category `product`
2. Send a body that turns Account off with Product on, then a body with an unknown id.

   ```sh
   curl -s -b member.jar -X PUT "$BASE_URL/notifications/preferences" -H 'Content-Type: application/json' -H "Origin: $APP_URL" -d '{"categories":{"product":true,"account":false}}' -w '\n%{http_code}\n'
   ```

   ```sh
   curl -s -b member.jar -X PUT "$BASE_URL/notifications/preferences" -H 'Content-Type: application/json' -H "Origin: $APP_URL" -d '{"categories":{"product":true,"promotions":false}}' -w '\n%{http_code}\n'
   ```

   ```sh
   $DB_CMD "select o.category, u.email from notification_opt_outs o join users u on u.id = o.user_id;"
   ```

   - [x] Both calls answer 400 `invalid_input` with a message that names the category, and the `product` opt-out row is still there
3. Turn Product on again.

   ```sh
   curl -s -b member.jar -X PUT "$BASE_URL/notifications/preferences" -H 'Content-Type: application/json' -H "Origin: $APP_URL" -d '{"categories":{"product":true}}' -w '\n%{http_code}\n' && $DB_CMD "select count(*) as opt_outs from notification_opt_outs;"
   ```

   - [x] The api answers 200 with `product` `enabled: true`, and no opt-out row is left

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _Run by the agent. Output, trimmed:_ Product off `200` with `"enabled":false`; one opt-out row `product` / `member@example.test`. Account off: `400` `categories.account: "Account" notifications are required and cannot be turned off.` Unknown id: `400` `categories.promotions: no notification category is named "promotions".` Also `{"product":"no"}` and `{}` answer `400 invalid_input`. The `product` row stays after all four refusals. Product on: `200` with `"enabled":true`, `opt_outs: 0`. A body that sets the required Account to `true` answers `200`.

### TC-3.4: Paging and "Mark all read" cover every row  ·  🔴 Critical

**Goal.** The cursor walks every row exactly once, and "Mark all read" marks only the caller's rows.

**Steps**

1. Add 21 unread rows for the member, so the member holds 25 rows.

   ```sh
   $DB_CMD "with recursive n(i) as (select 1 union all select i + 1 from n where i < 21) insert into notifications (id, user_id, category, title, created_at) select 'qa-page-' || i, (select id from users where email = 'member@example.test'), 'product', 'QA page row ' || i, 1767600000000 + i * 1000 from n;"
   ```

2. Read page 1, then page 2 with its `nextCursor`, then a forged cursor.

   ```sh
   P1=$(curl -s -b member.jar "$BASE_URL/notifications") && echo "$P1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["notifications"]), d["nextCursor"])'
   ```

   ```sh
   C=$(echo "$P1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["nextCursor"])') && curl -s -b member.jar -G "$BASE_URL/notifications" --data-urlencode "cursor=$C" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["notifications"]), d["nextCursor"], [n["title"] for n in d["notifications"]])'
   ```

   ```sh
   curl -s -b member.jar "$BASE_URL/notifications?cursor=not-a-cursor" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["notifications"]), d["notifications"][0]["title"])'
   ```

   - [x] Page 1 holds 20 rows and a cursor; page 2 holds 5 rows, the oldest ones, and a null cursor; the forged cursor answers page 1
3. Mark all read as the member.

   ```sh
   curl -s -b member.jar -X POST "$BASE_URL/notifications/read-all" -w '\n%{http_code}\n' && curl -s -b member.jar "$BASE_URL/notifications/unread-count" && curl -s -b admin.jar "$BASE_URL/notifications/unread-count"
   ```

   - [x] The api answers `{"marked":<the member's unread count>,"ok":true}`, the member count is `{"count":0}`, and the admin count stays `{"count":1}`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _Run by the agent. Output, trimmed:_ page 1 `20` rows, cursor `1767600003000.qa-page-3`; page 2 `5` rows (`QA page row 2`, `QA page row 1`, `Your export is ready`, `Your email address was verified`, `New: better search`), cursor `None`; 25 ids, 25 unique. Forged cursor: 20 rows, first `New sign-in to your account`. The admin with the member's cursor gets 0 rows. Read-all: `{"marked":22,"ok":true} 200`, member `{"count":0}`, admin `{"count":1}`. A second read-all answers `{"marked":0,"ok":true}`.

**Reset.** Run after every case above. The agent ran it: `notifications 5 rows`, then member 4 rows (2 unread) and admin 1 row (1 unread).

```sh
$DB_CMD "delete from notifications; delete from notification_opt_outs;" && timeout 180 pnpm db:seed
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Target: `.dev/playground`, the declared disposable playground, reset with `pnpm play:restore` from the repo root. The agent ran Scenario 3, the Scenario 1 and 2 page flows, and every database write on this target only. Database host: the local D1 file under `apps/api/.wrangler/state` (Miniflare, no network).

Reused gate results: `pnpm test` (1034 + 91 + 549 pass, 0 fail) and `pnpm build` passed on this content, but on the uncommitted tree before the commits, not on `c27639c3` clean. That is a different revision and dirty state, so the reuse rule does not cover them. The agent did not run them again. The agent ran `pnpm lint` and `pnpm typecheck` again on `c27639c3` clean.

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
cd .dev/playground && pnpm exec vitest run apps/api/src/routes/notifications.test.ts apps/api/src/lib/notify.test.ts
```

```sh
cd .dev/playground && pnpm typecheck
```

```sh
cd .dev/playground && timeout 180 pnpm db:seed
```

```sh
$DB_CMD "select name, sql from sqlite_master where name like '%notification%';"
```

```sh
$DB_CMD "select name from d1_migrations;"
```

```sh
$DB_CMD "update notifications set read_at = 1793839884339 where title = 'Your export is ready';" && timeout 180 pnpm db:seed && $DB_CMD "select title, read_at from notifications where title = 'Your export is ready';"
```

- ✅ `pnpm lint` (repo, `c27639c3` clean) → exit 0, "All matched files use Prettier code style!"
- ✅ `pnpm typecheck` (repo, `c27639c3` clean) → exit 0, 1 task (a turbo cache hit on the same inputs)
- ✅ playground route and `notify` tests → 2 files, 20 tests pass. These cover the cases no route reaches: `notify` skips an opted-out category, writes a required one, and throws on an unknown category, a blank title and a bad `href`.
- ✅ playground `pnpm typecheck` → exit 0, 11 tasks (8 from the turbo cache)
- ✅ `pnpm db:seed` → finished in 15 s with exit 0 and `notifications 5 rows`, `notification_opt_outs 0 rows`. The hang that an earlier run saw did not occur; the script opens the local D1 file through `getPlatformProxy` and needs no running api.
- ✅ table `notifications` → columns `id` text primary key, `user_id` text not null, `category` text not null, `title` text not null, `body` text, `href` text, `read_at` integer, `created_at` integer not null with a default
- ✅ table `notification_opt_outs` → columns `user_id`, `category`, `created_at`, primary key (`user_id`, `category`)
- ✅ indexes → `notifications_user_id_created_at_idx` (`user_id`, `created_at`) and `notifications_user_id_read_at_idx` (`user_id`, `read_at`)
- ✅ constraints → both tables carry `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade`
- ✅ migrations → `d1_migrations` lists `0000_low_dorian_gray.sql`, which creates both tables
- ✅ `pnpm db:seed` on a seed row that a user marked read → `read_at` stays `1793839884339`. This agrees with the module skill ("The seed does not reset `read_at`"). The comment in the playground's `packages/db/scripts/seed.ts` says a run "puts each seed row back to its slice values", which is not true for a column the slice leaves out. Each Reset in this plan deletes the rows before the seed for that reason.

### Browser checks
_Driven with `playwright-cli` (session `qa313r`, headless Chromium) against `http://localhost:3102` with the api at `http://localhost:4100`, at `c27639c3`. 25 screenshots, local to this run and not committed. Signed in as `member@example.test`. Mocks served `GET` reads only, with CORS headers, and the agent cleared every route before the browser closed._

- ❌ 🟡 sidebar · Notifications row count = `100` and `1284` @ 1440 via route `**/notifications/unread-count` → the row shows `100` and `1284` while the bell shows `99+`; expected the same `99+` (plan, UI house rules: "The badge shows `99+` above 99"; skill: "the bell and the badge always show the same number"); fix: render the row count through `badgeText()` in the app's nav count, or cap it in `liveCount`
- ❌ 🟡 `/notifications` Inbox · row body = `IMG_20250914_183022_HDR_portrait_edited_edited.HEIC` (unbroken) @ 375 via route `http://localhost:4100/notifications` → the row is 440 px wide in a 373 px panel, and the file name runs past the right edge with no wrap and no ellipsis; expected a wrap; fix: add `break-words` (`overflow-wrap: anywhere`) to the title and body in `notification-list.tsx`
- ❌ 🟡 every app page · console → `[["nav-count","/notifications"]]: No queryFn was passed as an option, and no default queryFn was found.` 6 times on load, 4 more on opening the menu, 2 more on a `pageshow` with `persisted`; expected no console error. Every count check below still passed, so no stale count was seen. Fix: find which fetch runs with the options of `useUnreadCount()` (`enabled: false`, no `queryFn`); the module skill warns that this state makes an invalidation fetch nothing. Use debugkit before a change.
- ❌ 🟢 `/notifications` Inbox tab · unread count = `1284` via route `**/notifications/unread-count` → the tab reads `1284 unread`; expected `1,284 unread` (worst-case catalog); fix: format with `Intl.NumberFormat(config.app.locale)`
- ✅ `/` · bell → `aria-label` "Notifications, 2 unread", badge `2`; sidebar Notifications row `2`; no horizontal overflow at 1440 and 375
- ✅ bell menu · rows → 4 rows newest first, 2 with `data-unread`, each unread title starts with the screen-reader text "Unread: "; header "Mark all read"; footer link "View all notifications" with `href` `/notifications`; popup 384 px wide at 1440, 5 to 364 px at 375
- ✅ bell menu · "View all notifications" → URL `/notifications`, menu closed
- ✅ `/notifications` · header → `h1` "Notifications", "Newest first. Read rows are kept for 30 days.", "Mark all read" button; tabs "Inbox 2 unread" (selected) and "Preferences"; 4 rows, 2 unread; no "Load more"
- ✅ `/notifications` @ 375 · "Mark all read" → 38 px icon button, its label `position: absolute` (screen reader only); no page or row overflow
- ✅ Preferences tab · switches → Account `aria-checked=true` and disabled, with "Required. These cannot be turned off."; Product `aria-checked=true`; a click on Account changes nothing; "Mark all read" is absent on this tab
- ✅ Preferences tab · Product off → switch `false`, database holds one opt-out row `product` for `member@example.test`; after a reload the switch is still `false`; Product on → switch `true`, 0 opt-out rows
- ✅ menu · open "Your export is ready" (no `href`) → menu closes, URL stays `/notifications`, bell `1`, sidebar `1`, tab "Inbox 1 unread", 1 unread row
- ✅ Inbox · open "New sign-in to your account" (`href` `/`) → URL `/`, bell badge gone, `aria-label` "Notifications", sidebar row has no count; the menu then shows 0 unread rows and no "Mark all read"
- ✅ menu · "Mark all read" → bell and sidebar count gone, menu stays open with 0 unread rows; database holds 0 unread rows for the member
- ✅ `/notifications` · "Mark all read" → bell and sidebar count gone, tab "Inbox", 0 unread rows, the button is gone
- ✅ two tabs · mark all read in tab 2 → tab 1 keeps `2` until a `visibilitychange` (bubbling, as a browser fires it), then shows no count
- ✅ `pageshow` · `persisted: false` after a database change → count unchanged (no count); `persisted: true` → count `2`
- ✅ failed count · `500`, body `{}`, body `{"count":"7"}`, and the browser offline, each followed by a `visibilitychange` → bell `2` and sidebar `2` every time; back online → `2`
- ✅ bell · count = `5`, `1`, `99`, `100`, `1284`, `0` via route → badge `5`, `1`, `99`, `99+`, `99+`, none; `aria-label` "Notifications, 99+ unread" at 100 and above, "Notifications" at 0; badge 16 px wide at one digit, 30 px at `99+`
- ✅ failed rows · `500` on `http://localhost:4100/notifications` → menu and Inbox show "Could not load notifications", "Check your connection and try again.", "Try again"; bell keeps `2`; "Try again" with the route removed loads 4 rows in both places
- ✅ empty · member rows deleted → bell has no badge; menu and Inbox show "No notifications yet" and "When something needs your attention, it shows here."; no "Mark all read" in either place
- ✅ worst-case rows via route (long German title with an email, RTL, CJK, `<script>alert(1)</script> &amp; 🦊 Fox`, an embedded newline, a 2,000-character body, an unknown category `promotions`, a future date, `1970-01-01`) @ 1440 and 375, in the menu and the Inbox → no `undefined`, `null`, `NaN` or "Invalid Date"; `<script>` and `&amp;` render as literal text and no `script` element is added; the unknown category shows its raw id `promotions`; the future date shows "now"; `1970-01-01` shows "56 years ago"; menu titles and bodies end in an ellipsis with no row overflow; the Inbox at 1440 has no row overflow
- ✅ Inbox · 20 mocked rows with a `nextCursor` → "Load more" shows; a click loads page 2 (21 rows, last "Page two row") and "Load more" goes away
- ✅ keyboard · focus on the bell, Enter → menu opens, focus moves to "Mark all read"; Escape → menu closes, focus is back on the bell (`aria-label` "Notifications, 2 unread")
- ✅ signed out · `/notifications` → redirect to `/sign-in?redirect=%2Fnotifications`, no bell
- ✅ console, other errors → only `favicon.ico` 404, which this change does not touch

### Re-check after the fixes
_The 4 ❌ above are fixed on this branch after `c27639c3`. The agent ran these again with `playwright-cli` against the same playground on api 4100 and app 3102._

- ✅ sidebar and bell · count = `1284` and `100` via route → the bell, the sidebar row and the bell `aria-label` all read `99+`. The sidebar now renders `navCountLabel()` from `@repo/ui/lib/shell/nav-counts`.
- ✅ `/notifications` Inbox @ 375 · body `IMG_20250914_183022_HDR_portrait_edited_edited.HEIC` and the long German title → each row has `scrollWidth` 373 and `clientWidth` 373, and the page overflow is 0. The title and the body wrap with `wrap-anywhere`.
- ✅ console · "No queryFn" → 0 messages on load, after the menu opens, and after a `pageshow` with `persisted`. The bell and the sidebar now share `navCountQuery()` from `apps/app/src/lib/nav-count.ts`. A mark-read with the real api drops the bell and the sidebar from `2` to `1`.
- ✅ `/notifications` Inbox tab · count = `1284` via route → the tab reads `1,284 unread`.

## Not covered / needs human judgment
- `apps/admin`: the playground has no `admin` module, so the admin nav count failure fix ran only in the repo's own tests (`modules/shell` `nav-counts.test.ts` and the admin app shell). Nobody drove it in a browser.
- `database-postgres`: the playground runs `database-d1` only. The `.pg.ts` schema and the route tests on Postgres were not run in this pass.
- `queue` and the daily prune: the playground has no `queue` module, so `pruneNotifications`, the `notification.prune` job and its schedule were not run. The function is covered by the repo tests only.
- `saasaloy add` and `saasaloy remove notification`: this pass used the playground as installed at `324ea98`. It did not run `add` or `remove` again, and it did not check `removeWarnings`.
- The `G N` shortcut: it binds only when the `command` module is installed, and the playground does not have it.
- A real back-forward cache restore and a real tab switch: headless Chromium does not hide a tab, so the agent fired `pageshow` and `visibilitychange` events itself. TC-1.3 covers the feel in a real browser.
- The 60 s refetch interval: not timed in this pass.
- CJK and emoji glyphs: the headless browser has no CJK or emoji font, so those characters show as boxes in `menu-worst-*` and `inbox-worst-*`. Judge them in a desktop browser if they matter.
- Real-time delivery, email, SMS and push: out of scope for this module (plan non-goals).
- Concurrency: a double click on "Mark all read" was not driven; the second call answers `marked: 0` (TC-3.4), so it changes nothing.
- Performance: not measured. The list reads 20 rows a page through a keyset cursor and an index on (`user_id`, `created_at`).
- Opening the menu moves the focus to "Mark all read", so Enter twice marks every row read. Judge whether that first focus is right in TC-1.4.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
