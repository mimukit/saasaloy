# QA Plan: The admin shell polish and the admin primitive set

_Generated 2026-10-19 · against `a6d75d7` (uncommitted changes) · covers plan 0069, Phases 2 to 7 (#192)_

Plan: [`docs/plans/0069-plan-admin-shell-polish-2026-10-18.md`](../plans/0069-plan-admin-shell-polish-2026-10-18.md).

## Summary
- The admin app uses a new sidebar shell, a page frame, and 39 admin components copied from coss ui.
- "Working" means every admin page renders in the shell, in both themes, at 360 px and 1280 px, with usable keyboard focus.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-192-polish-the-admin-shell-layout-and-ui-styles`.
- Admin app: `http://localhost:3001`. API: `http://localhost:4000`.
- Browser: a desktop browser with developer tools. Start at 1280 px wide, dark theme.

1. From the repository root, make a new playground.

```sh
pnpm play:init
```

2. In `.dev/playground`, add the database driver.

```sh
./saasaloy add database-d1 --yes
```

3. Add the modules for the admin pages.

```sh
for m in admin billing billing-console feature-flags api-keys rbac teams email-console queue-memory kv-memory; do ./saasaloy add $m --yes; done
```

4. Install the dependencies.

```sh
pnpm install
```

5. Make the env file.

```sh
cp packages/env/.env.example packages/env/.env
```

6. In `packages/env/.env`, set `BETTER_AUTH_SECRET` to the output of this command.

```sh
openssl rand -hex 32
```

7. In the same file, set `BILLING_PROVIDER=console`, `EMAIL_PROVIDER=console`, `KV_PROVIDER=memory`, `LOGGER_PROVIDER=console` and `QUEUE_PROVIDER=memory`.
8. Set `BILLING_APP_NAME=Playground`, `BILLING_APP_URL=http://localhost:3000`, `BILLING_LOCKOUT_DAYS=14`, `EMAIL_FROM=admin@example.com`, `FLAGS_ISOLATE_TTL_SECONDS=30`, `KV_KEY_PREFIX=play` and `LOG_LEVEL=info`.
9. Write the service env files and the database.

```sh
pnpm env:setup && pnpm --filter @repo/db db:generate && pnpm db:setup
```

10. In terminal 1, start the API.

```sh
pnpm --filter @repo/api dev
```

11. In terminal 2, start the admin app.

```sh
pnpm --filter @repo/admin dev
```

12. Make seven users. Run this command once for each of `ada`, `bob`, `cy`, `dee`, `eve`, `fay` and `gus`. Change the name and the email each time.

```sh
curl -i -X POST http://localhost:4000/auth/sign-up/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3001' -d '{"name":"Ada Admin","email":"ada@example.com","password":"Passw0rd!Passw0rd"}'
```

13. In `packages/db`, give `ada` and `bob` the admin role, and mark five users verified.

```sh
pnpm exec wrangler d1 execute DB --local --command "UPDATE users SET role='admin' WHERE email IN ('ada@example.com','bob@example.com'); UPDATE users SET email_verified=1 WHERE email IN ('ada@example.com','bob@example.com','cy@example.com','dee@example.com','eve@example.com');"
```

- [ ] Environment ready: `http://localhost:4000/health` answers `{"status":"ok"}`, and `http://localhost:3001` shows the sign-in card

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Signed out | Sign in with a wrong password, then as an admin | 🔴 Critical |
| TC-2.1 | 2: Admin signed in, no teams or keys yet | The sidebar shell, its collapse and the account menu | 🔴 Critical |
| TC-2.2 | 2: Admin signed in, no teams or keys yet | A tour of the seven pages and their empty states | 🔴 Critical |
| TC-2.3 | 2: Admin signed in, no teams or keys yet | Create, issue, toggle and delete actions with toasts | 🔴 Critical |
| TC-2.4 | 2: Admin signed in, no teams or keys yet | Keyboard focus in the dialog, the menu, the select and the alert dialog | 🟡 Normal |
| TC-3.1 | 3: Admin signed in, 360 px | The mobile shell, the sheets and no sideways scroll | 🔴 Critical |
| TC-4.1 | 4: Admin signed in, light theme | The light theme on every page | 🟡 Normal |
| TC-4.2 | 4: Admin signed in, light theme | The system theme and the first-visit default | 🟢 Low |
| TC-5.1 | 5: Admin signed in, slow or stopped API | The loading skeleton | 🟡 Normal |
| TC-5.2 | 5: Admin signed in, slow or stopped API | The error screens and "Try again" | 🔴 Critical |
| TC-5.3 | 5: Admin signed in, slow or stopped API | The 404 screen | 🟢 Low |
| TC-6.1 | 6: A playground made before this change | `saasaloy update admin` and the build | 🟡 Normal |

## Scenario 1: Signed out

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login` in a private window.

- [ ] Setup complete

### TC-1.1: Sign in with a wrong password, then as an admin  ·  🔴 Critical

**Goal.** The sign-in card shows its errors in place and opens the shell for an admin.

**Steps**

1. Look at the card.
   - [ ] The card shows the brand mark, "Sign in to <project> admin" and the admin role hint
2. Enter `ada@example.com` and the password `wrong-password`. Click "Sign in".
   - [ ] A red message shows under the password field, and the caret stays in the field
3. Enter the password `Passw0rd!Passw0rd`. Click "Sign in".
   - [ ] The overview opens inside the sidebar shell

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** None. Stay signed in for Scenario 2.

## Scenario 2: Admin signed in, no teams or keys yet

**Setup.** Run once, for every case in this scenario.

1. Sign in as `ada@example.com` at 1280 px, dark theme.
2. Do not create a team or an API key before TC-2.2.

- [ ] Setup complete

### TC-2.1: The sidebar shell, its collapse and the account menu  ·  🔴 Critical

**Goal.** The sidebar navigates every page and collapses to icons without a lost state.

**Steps**

1. Look at the sidebar.
   - [ ] The sidebar shows the brand row, the "Manage" group with seven rows, and the account menu at the foot
2. Click each nav row in turn.
   - [ ] The active row takes the hover tone, and the header path changes to "Admin / <page>"
3. Click the sidebar toggle in the header. Hover an icon.
   - [ ] The sidebar collapses to an icon strip, and a tooltip names the page
4. Press ⌘B or Ctrl+B. Then reload the page.
   - [ ] The sidebar expands, and it stays expanded after the reload
5. Open the account menu.
   - [ ] The menu shows the name, the email and "Sign out"

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A tour of the seven pages and their empty states  ·  🔴 Critical

**Goal.** Every page renders full width in the frame, with its data, its header and its empty state.

**Steps**

1. Open `/`. Click "Refresh".
   - [ ] API health shows "Healthy" with a check time, Users shows 7, and "Newest sign-ups" lists five users, newest first
   - [ ] "Refresh" shows a spinner and refetches both cards
2. Click "View all". On `/users`, use the chips and the column headers.
   - [ ] The chips All, Admins and Users carry the counts 7, 2 and 5
   - [ ] Each column sorts, and the active sort header turns orange
3. Click a row on `/users`.
   - [ ] The detail panel opens beside the list
4. Open `/billing`, `/flags`, `/teams`, `/roles` and `/api-keys` in turn.
   - [ ] Each page header lines up with the first column of its table, and no page shows a narrow centred column
     - billing: "Current plan" and "Plans" cards; the invoices table shows "No invoices yet"
     - flags: the maintenance card with "Close the site"; one switch per flag
     - teams and api-keys: an empty state with its call to action
     - roles: the Roles and Members tabs

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Create, issue, toggle and delete actions with toasts  ·  🔴 Critical

**Goal.** The write actions on the module pages work and confirm with a toast.

**Steps**

1. On `/flags`, change one switch.
   - [ ] A toast shows at the bottom right
2. On `/teams`, click "New organization". Enter the name `Acme` and the slug `acme`. Click "Create".
   - [ ] "Create" shows a spinner, the dialog closes, a toast shows, and the new row shows "Active"
3. Click "New organization" again. Enter the slug `acme`. Click "Create".
   - [ ] A field error tells you that the slug is taken
4. On `/api-keys`, click "New key". Enter the name `ci`, pick an expiry and a scope. Click "Issue key".
   - [ ] The secret shows once in a warning banner, and a toast shows
5. Click the new key row.
   - [ ] The key panel opens
6. On `/roles`, click "New role". Enter the name `support`, tick two permissions, and save.
   - [ ] The dialog shows the permission grid, and the new role shows in the list
7. Open the `support` role. Click "Delete role". Confirm.
   - [ ] An alert dialog asks first, and the role leaves the list after you confirm
8. Open the `ci` key. Click "Revoke key". Confirm.
   - [ ] An alert dialog asks first, and the key shows as revoked after you confirm

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: Keyboard focus in the dialog, the menu, the select and the alert dialog  ·  🟡 Normal

**Goal.** Every overlay takes focus when it opens and gives it back when it closes.

**Steps**

1. On `/teams`, Tab to "New organization" and press Enter. Press Tab through the dialog. Press Escape.
   - [ ] Focus moves into the Name field and stays inside the dialog
   - [ ] The dialog closes, and focus returns to "New organization"
2. Tab to the account menu and press Enter. Press the arrow keys. Press Escape.
   - [ ] Focus moves to the first item, and the arrow keys move the highlight
   - [ ] Focus returns to the account menu button
3. On `/teams`, add `bob@example.com` to `Acme` as a member. On `/roles`, open the Members tab. Tab to the role select of `bob` and press Space. Use the arrow keys, then press Enter.
   - [ ] The list opens with the current role highlighted, the arrow keys move the highlight, and Enter picks a role with a toast
4. On `/api-keys`, issue a key, open it, and press Tab to "Revoke key". Press Enter. Press Escape.
   - [ ] Focus moves into the alert dialog, and Escape cancels it
5. Look at each focused control during this case.
   - [ ] Every focused control shows a visible focus ring, and no toast takes focus

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** None. Scenario 3 uses the same data.

## Scenario 3: Admin signed in, 360 px

**Setup.** Run once, for every case in this scenario.

1. In the developer tools, set the device toolbar to 360 px wide.

- [ ] Setup complete

### TC-3.1: The mobile shell, the sheets and no sideways scroll  ·  🔴 Critical

**Goal.** At 360 px no page scrolls sideways, and the sidebar and the detail panel open as sheets.

**Steps**

1. Click the sidebar toggle in the header. Click a nav row.
   - [ ] The sidebar opens as a sheet from the left, and it closes when the page changes
2. Open each of the seven pages. Scroll each one.
   - [ ] No page shows a sideways scroll bar on the page itself; a wide table scrolls inside its own frame
     - billing: "Manage billing" sits under the card title and stays inside the card
     - users and api-keys: the table header and rows
3. On `/users`, click a row.
   - [ ] The detail panel opens as a bottom sheet

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Set the width back to 1280 px.

## Scenario 4: Admin signed in, light theme

**Setup.** Run once, for every case in this scenario.

1. Press the theme toggle in the header until it shows the sun icon.

- [ ] Setup complete

### TC-4.1: The light theme on every page  ·  🟡 Normal

**Goal.** Borders, inputs and badges stay readable on the cream canvas.

**Steps**

1. Open each of the seven pages at 1280 px. Open one dialog and one detail panel.
   - [ ] Every page reads clearly, with no text or border lost on its background
     - the sidebar rows and the active row
     - table rows, the row hover and the selected row
     - status badges, inputs, switches and the dialog surface

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.2: The system theme and the first-visit default  ·  🟢 Low

**Goal.** The app follows the operating system on "system" and starts in dark on a first visit.

**Steps**

1. Press the toggle until it shows the monitor icon. Change the appearance of the operating system.
   - [ ] The app follows the operating system
2. Clear the site data and reload.
   - [ ] The app starts in dark

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Sign in again as `ada@example.com`, dark theme.

## Scenario 5: Admin signed in, slow or stopped API

**Setup.** Run once, for every case in this scenario.

1. Stay signed in as `ada@example.com` at 1280 px.

- [ ] Setup complete

### TC-5.1: The loading skeleton  ·  🟡 Normal

**Goal.** A slow page shows a skeleton inside the frame, not a blank panel.

**Steps**

1. In the developer tools, set the network to "Slow 3G". Open each page from the sidebar.
   - [ ] A skeleton header and skeleton rows show while the page loads, with the sidebar still in place
2. Set the network back to "No throttling".

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-5.2: The error screens and "Try again"  ·  🔴 Critical

**Goal.** A failed load shows an error screen inside the shell, and "Try again" recovers it.

**Steps**

1. In the developer tools, block the request URL pattern `localhost:4000/admin/*`. Open `/users` from the sidebar.
   - [ ] The "The user list did not load" screen shows, with the error detail and "Try again"
2. Open `/billing`, `/flags` and `/teams` in turn. On each page, right-click its request to `localhost:4000` in the Network panel. Choose "Block request URL", then reload. Do not block `/auth/*`.
   - [ ] Each page shows its error screen inside the shell, and the sidebar still works
3. Remove every request block. Press "Try again".
   - [ ] The page loads

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-5.3: The 404 screen  ·  🟢 Low

**Goal.** An unknown path shows the 404 screen inside the shell.

**Steps**

1. Open `http://localhost:3001/no-such-page`.
   - [ ] The 404 screen shows inside the shell, with the sidebar and the header

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop both dev servers with Ctrl+C. Then, from the repository root, remove the playground.

```sh
pnpm play:destroy
```

## Scenario 6: A playground made before this change

**Setup.** Run once, for every case in this scenario.

1. Check out `main` in a second worktree. Make a playground there with the `admin` module, as in Environment steps 1 to 4.
2. Check out this branch in that worktree again. Keep the playground.

- [ ] Setup complete

### TC-6.1: `saasaloy update admin` and the build  ·  🟡 Normal

**Goal.** An existing project takes the new admin set through the update path and builds.

**Steps**

1. In the playground, preview the update.

```sh
./saasaloy update admin --dry-run
```

   - [ ] The plan creates the files under `packages/ui/src/{components,blocks,containers,lib}/admin/` and `packages/ui/src/assets/`, and removes the old copies in `apps/admin/src/components/`
2. Apply the update, install, and build.

```sh
./saasaloy update admin --yes && pnpm install && pnpm --filter @repo/admin build
```

   - [ ] The build passes, or it fails only on `@tanstack/react-table` and passes after the next command
3. Run this command only if step 2 failed on `@tanstack/react-table`. Then build again.

```sh
pnpm install --fix-lockfile && pnpm --filter @repo/admin build
```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Remove the second worktree and its playground.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint && pnpm typecheck && pnpm test
```

```sh
pnpm --filter @repo/admin build && pnpm --filter @repo/admin typecheck && pnpm --filter @repo/ui typecheck
```

```sh
grep -ril coss packages/ui/src/components/admin packages/ui/src/lib/admin
```

```sh
sed -i '1i import { Button as B } from "@repo/ui/components/button";' apps/admin/src/routes/users.tsx && pnpm exec oxlint -c oxlint.config.mjs apps/admin/src/routes/users.tsx
```

```sh
pnpm dlx @google/design.md lint apps/admin/DESIGN.md
```

- ✅ The repo gate (lint, typecheck, tests) → all green, 1,008 tests pass. Reused: it ran on `a6d75d7` with the same uncommitted changes.
- ✅ A clean playground with all 21 modules → the admin build passes, and the admin and ui typecheck shows 0 errors. Reused: same revision and changes.
- ✅ The coss grep in the playground → only `packages/ui/src/components/admin/NOTICE.md` matches, and it holds the MIT text with `Copyright (c) 2025 coss.com`.
- ✅ The import guard in the playground → oxlint reports `no-restricted-imports` with "Admin code uses the admin set". The line was removed after the check, and the file is clean again.
- ✅ `apps/admin/DESIGN.md` → 0 errors, 0 warnings.
- ✅ Browser checks in the dark theme, run by the agent → no page scrolls sideways at 360 px, the dialog and the menu return focus, a team create and a key issue work. TC-2.2, TC-2.4 and TC-3.1 still need a human pass.

## Not covered / needs human judgment
- An automated a11y scan. Issue #202 tracks it.
- Automated render tests of the overlays and the page frame. Issue #203 tracks a DOM test runner.
- A real API 500 on a signed-in page. With the API stopped, the guard sends you to sign-in, so TC-5.2 blocks the admin requests in the browser.
- Performance with large data. The seed has seven users. The tables have no pagination change in this work.
- Concurrency. The work changes no write path; the module pages keep their existing calls.
- Security. The work changes no permission check; the admin guard is the same.
- Browsers other than one desktop Chromium-based browser.
- The data layer. The diff touches no migration, schema or query.

## Overall result
_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
