# QA Plan: the auth-gated admin app capability module

_Generated 2026-08-29 · against `e23c8a8` · covers issue #87: the `admin` capability module, its role-gated shell and typed dashboard, and the `admin` plugin the `auth` module gained_

_Extended 2026-08-31 · for issue #97: the server-side gate in `@repo/auth/server`, the gated `GET /admin/users` route, and the hook that promotes the first sign-up to admin. Scenario 2 gains TC-2.4; Scenario 5 is new and runs last._

## Summary

- `saasaloy add admin` scaffolds `apps/admin`, a TanStack Router + Vite SPA on port 3001. Its root route denies every visitor who does not hold `session.user.role === "admin"`. The dashboard reads `GET /health` from the api Worker on port 4000 through `hc<AppType>` and TanStack Query. The `auth` module now enables better-auth's `admin` plugin and carries the `role` column.
- "Working" means an anonymous visitor lands on `/login`, a signed-in non-admin gets a terminal denied panel with no redirect loop, an admin gets the sidebar and the live `/health` value, and every failure says what went wrong on screen.
- Issue #97 adds the half a browser cannot check. `@repo/auth/server` now exports `requireSession`, `requireRole` and `requireAdmin`, which throw an `HTTPException` that api's `onError` renders as `{ "error": { "code": ..., "message": ... } }`. `GET /admin/users` is the first route to call one. A `databaseHooks.user.create.before` hook promotes the first account on an empty `user` table to `admin`, so a fresh project reaches the shell without SQL.
- For that half, "working" means the api itself answers `403` to a non-admin's cookie, and the first sign-up on a fresh project lands in the shell while the second lands on the denied panel.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- **Branch under test:** `issue-87-add-the-auth-gated-admin-app-capability-module`, at commit `e23c8a8`.
- **Machine:** a workstation with a graphical browser. Every case in this plan needs a real browser. The CI box has none, which is why these cases are here and not in the automated section.
- **Toolchain:** Node 24.x, pnpm 11. Run every command from the repository root unless a step says otherwise.
- **The playground is already staged.** `.dev/playground` holds `api`, `database`, `auth` and `admin`, installed and built, with the D1 migration applied. Do not run `pnpm play:reset` before Scenario 5. A reset deletes the two seeded accounts and costs you the whole setup. Scenario 5 resets on purpose and is the last thing you run.
- **URLs:** the admin app serves `http://localhost:3001`. The api Worker serves `http://localhost:4000`. Both ports use `strictPort`, so a busy port fails loudly instead of shifting.
- **Accounts:** both live in the playground's local D1. The password is `Password123!` for both.

  | Email | Role | Use |
  |---|---|---|
  | `admin@example.com` | `admin` | the account that may enter the shell |
  | `user@example.com` | `user` | the account the guard must deny |

- **Terms used in this plan:** *the playground* is `.dev/playground`. *The admin app* is `apps/admin` on `:3001`. *The api Worker* is `apps/api` on `:4000`. *The shell* is the sidebar plus the screen beside it. *The denied panel* is the card titled "This account cannot open the admin app". *The guard* is `beforeLoad` in `apps/admin/src/routes/__root.tsx`.

Start the api Worker. Leave it running.

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

Start the admin app in a second terminal. Leave it running.

```sh
pnpm -C .dev/playground --filter @repo/admin dev
```

Confirm the api answers before you open the browser.

```sh
curl -s http://localhost:4000/health
```

- [ ] Environment ready: the api prints `{"status":"ok"}` and `http://localhost:3001/` loads

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: both servers up, no session | An anonymous visitor never reaches the shell | 🔴 Critical |
| TC-1.2 | 1: both servers up, no session | A wrong password fails on screen and names nothing | 🟡 Normal |
| TC-1.3 | 1: both servers up, no session | The admin signs in and the dashboard shows live health | 🔴 Critical |
| TC-1.4 | 1: both servers up, no session | Sign-out from the shell ends the session | 🔴 Critical |
| TC-2.1 | 2: signed in as the non-admin | A non-admin gets the denied panel, not the shell | 🔴 Critical |
| TC-2.2 | 2: signed in as the non-admin | `/login` denies the non-admin where they stand | 🟡 Normal |
| TC-2.3 | 2: signed in as the non-admin | Sign-out from the denied panel works | 🔴 Critical |
| TC-2.4 | 2: signed in as the non-admin | The api refuses `GET /admin/users` to a non-admin cookie | 🔴 Critical |
| TC-3.1 | 3: admin app up, api Worker stopped | Sign-in reports an unreachable api | 🟡 Normal |
| TC-3.2 | 3: admin app up, api Worker stopped | The dashboard shows its error card and recovers | 🟡 Normal |
| TC-3.3 | 3: admin app up, api Worker stopped | Sign-out says the session is still live | 🟢 Low |
| TC-4.1 | 4: reading, no servers needed | The admin skill teaches the code that shipped | 🟡 Normal |
| TC-4.2 | 4: reading, no servers needed | The README wording matches what admin does | 🟢 Low |
| TC-5.1 | 5: a fresh project, empty `user` table | The first sign-up lands in the shell as the admin | 🔴 Critical |
| TC-5.2 | 5: a fresh project, empty `user` table | The second sign-up gets the denied panel | 🔴 Critical |
| TC-5.3 | 5: a fresh project, empty `user` table | Two near-simultaneous first sign-ups: count the admins | 🟡 Normal |

Scenario 5 destroys the staged playground. Run it last, after every case above has a result.

## Scenario 1: both servers up, no session

**Setup.** Run once, for every case in this scenario.

1. Open a private browser window. A private window guarantees no session cookie.
2. Open the developer tools. Keep the Network tab and the Console tab visible for the whole scenario.

- [ ] Setup complete: the browser holds no `better-auth.session_token` cookie for `localhost`

### TC-1.1: An anonymous visitor never reaches the shell · 🔴 Critical

**Goal.** The guard sends an anonymous visitor to `/login` and paints no admin content on the way.

**Steps**

1. Type `http://localhost:3001/` in the address bar. Press Enter.
   - [ ] The address bar settles on `http://localhost:3001/login`
   - [ ] The sign-in card is the only thing on screen
     - the title reads "Sign in"
     - the description reads "The admin app is open to admin accounts only."
     - there is an Email field, a Password field, and a Sign in button
     - there is no sign-up link
   - [ ] No admin content flashes before the login card
     - no sidebar, at any width
     - no "Overview" heading and no "Api health" card
2. Read the Network tab.
   - [ ] The page made no request to `http://localhost:4000/health`
3. Type `http://localhost:3001/` again. Press Enter. Repeat once more.
   - [ ] The address bar stops at `/login` each time, and the page does not flicker between two addresses

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A wrong password fails on screen and names nothing · 🟡 Normal

**Goal.** A rejected sign-in shows one message, and the message does not say whether the address exists.

**Steps**

1. On `/login`, enter `admin@example.com` and the password `wrong-password`. Click Sign in.
   - [ ] A message in the error colour appears under the password field
   - [ ] The button returns to "Sign in" and stays clickable
   - [ ] The address bar stays on `/login`
2. Clear the fields. Enter `nobody@example.com` and the password `Password123!`. Click Sign in.
   - [ ] The message is word for word the same as in step 1

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The admin signs in and the dashboard shows live health · 🔴 Critical

**Goal.** An admin account reaches the shell, and the dashboard shows the api's real answer rather than placeholder text.

**Steps**

1. On `/login`, enter `admin@example.com` and `Password123!`. Click Sign in.
   - [ ] The button reads "Signing in…" while the request runs
   - [ ] The address bar settles on `http://localhost:3001/`
2. Look at the sidebar on the left.
   - [ ] The sidebar is complete and readable
     - the word "Admin" sits at the top
     - one nav item reads "Overview", with a layout icon
     - the account block near the bottom shows the name "Admin" and the email `admin@example.com`
     - a "Sign out" button sits under the account block
   - [ ] The "Overview" item is marked as the current page, by its own background and weight
3. Look at the screen beside the sidebar.
   - [ ] The heading reads "Overview" and the sub-line reads "Live data from the api Worker."
   - [ ] The "Api health" card shows a badge with the text `ok`
     - `ok` is the value the api returns from `GET /health`
     - an empty badge, or the word `undefined`, is a failure
4. Read the Network tab. Find the request to `http://localhost:4000/health`.
   - [ ] The request returns 200, and its response body is `{"status":"ok"}`
5. Stop the api Worker in its terminal with Ctrl-C. Wait for the prompt. Click Refresh on the dashboard.
   - [ ] The button reads "Refreshing…" while the request runs
   - [ ] The badge keeps showing `ok`, because the query keeps the last good value
6. Start the api Worker again with the Environment command. Wait for it to print its URL. Click Refresh.
   - [ ] The button returns to "Refresh" and the badge still reads `ok`
7. Press F5 to reload the page.
   - [ ] The dashboard comes back with the sidebar and the `ok` badge, and the app does not return to `/login`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: Sign-out from the shell ends the session · 🔴 Critical

**Goal.** The sidebar's sign-out button clears the session, and the browser cannot walk back into the shell.

**Steps**

1. Click "Sign out" in the sidebar.
   - [ ] The button reads "Signing out…" while the request runs
   - [ ] The app lands on `http://localhost:3001/login`
   - [ ] No error message appears under the button
2. Read the Application tab's cookie list for `http://localhost:4000`.
   - [ ] No `better-auth.session_token` cookie remains
3. Press the browser's Back button.
   - [ ] The app shows the login card, not the shell
4. Type `http://localhost:3001/` in the address bar. Press Enter.
   - [ ] The app redirects to `/login` again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Sign out if any case left you signed in. Close the private window before you start Scenario 2.

## Scenario 2: signed in as the non-admin

This scenario proves the part of the gate that a session alone cannot pass. `user@example.com` holds a valid session and the role `user`.

**Setup.** Run once, for every case in this scenario.

1. Open a fresh private browser window. Open the developer tools, on the Network tab.
2. Open `http://localhost:3001/`. The app redirects to `/login`.
3. Enter `user@example.com` and `Password123!`. Click Sign in.

- [ ] Setup complete: the sign-in request returns 200 and the browser holds a session cookie

### TC-2.1: A non-admin gets the denied panel, not the shell · 🔴 Critical

**Goal.** A signed-in account without the admin role sees a terminal panel, never the shell, and the app never loops.

**Steps**

1. Look at the screen that followed the sign-in.
   - [ ] The denied panel is on screen
     - a shield icon sits above the title
     - the title reads "This account cannot open the admin app"
     - the description names `user@example.com` and says the account does not carry the admin role
     - a "Sign out" button sits at the bottom of the card
   - [ ] No part of the shell is on screen
     - no sidebar
     - no "Overview" heading
     - no "Api health" card
2. Watch the address bar for five seconds. Do not click.
   - [ ] The address stops changing, and the browser's reload button is not spinning
   - [ ] The Back-button history holds no long run of `/` and `/login` entries
3. Read the Network tab for the whole page load.
   - [ ] The page made no request to `http://localhost:4000/health`
     - the guard throws before any child route loader runs
     - a `/health` request here means the gate stops pixels only, which is the defect commit `6f8a50e` fixed
4. Read the Console tab.
   - [ ] The console shows no uncaught error and no React error overlay
5. Type `http://localhost:3001/` in the address bar. Press Enter.
   - [ ] The denied panel comes back, and the shell still never paints

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `/login` denies the non-admin where they stand · 🟡 Normal

**Goal.** A non-admin who opens the login address is denied on the spot, and is not bounced to `/` first.

**Steps**

1. Type `http://localhost:3001/login` in the address bar. Press Enter.
   - [ ] The denied panel is on screen
   - [ ] The sign-in form does not appear, not even for one frame
   - [ ] The page settles without a visible hop through another address

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Sign-out from the denied panel works · 🔴 Critical

**Goal.** The denied panel offers the one action that changes the outcome, and that action works.

**Steps**

1. Click "Sign out" on the denied panel.
   - [ ] The app lands on `http://localhost:3001/login` and shows the sign-in form
   - [ ] No error message appears
2. Enter `admin@example.com` and `Password123!`. Click Sign in.
   - [ ] The shell opens, with the sidebar and the `ok` badge
     - this proves the denied account left no state behind that blocks the next sign-in

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: The api refuses `GET /admin/users` to a non-admin cookie · 🔴 Critical

**Goal.** The refusal comes from the api Worker, not from the browser. This is the only case in the plan that proves it, because every case above it runs inside the SPA the guard already stops.

Run these in a terminal, not the browser. `curl` carries no `beforeLoad`, so a route that relies on the SPA guard answers `200` here and passes every other case in this plan.

**Steps**

1. Sign the non-admin in and keep the cookie jar.

```sh
curl -s -o /dev/null -c /tmp/qa97-user.txt -H "Origin: http://localhost:3001" -H "Content-Type: application/json" \
  -X POST http://localhost:4000/auth/sign-in/email -d '{"email":"user@example.com","password":"Password123!"}'
grep -c better-auth /tmp/qa97-user.txt
```

   - [ ] `grep` prints a number of 1 or more, so the jar holds a session cookie

2. Call the gated route with that jar.

```sh
curl -i -b /tmp/qa97-user.txt -H "Origin: http://localhost:3001" http://localhost:4000/admin/users
```

   - [ ] The status line reads `HTTP/1.1 403 Forbidden`
   - [ ] The body is exactly `{"error":{"code":"forbidden","message":"role required: admin"}}`
     - a `200` with a user list is the defect this whole case exists to catch
     - a `401` is wrong too: the caller is signed in, and a 401 sends the SPA to the login screen it just came from
     - an HTML error page means `onError` did not render the `HTTPException`

3. Repeat with no cookie at all.

```sh
curl -i -H "Origin: http://localhost:3001" http://localhost:4000/admin/users
```

   - [ ] The status line reads `HTTP/1.1 401 Unauthorized`
   - [ ] The body is exactly `{"error":{"code":"unauthorized","message":"sign in first"}}`

4. Sign the admin in and call the same route.

```sh
curl -s -o /dev/null -c /tmp/qa97-admin.txt -H "Origin: http://localhost:3001" -H "Content-Type: application/json" \
  -X POST http://localhost:4000/auth/sign-in/email -d '{"email":"admin@example.com","password":"Password123!"}'
curl -i -b /tmp/qa97-admin.txt -H "Origin: http://localhost:3001" http://localhost:4000/admin/users
```

   - [ ] The status line reads `HTTP/1.1 200 OK`
   - [ ] The body carries a `users` array and a `total` number
   - [ ] Both seeded accounts appear, and each carries its `role`
     - this is what makes step 2 a refusal rather than a broken route

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Click "Sign out" in the sidebar. Close the private window. Delete `/tmp/qa97-user.txt` and `/tmp/qa97-admin.txt`; both hold live session cookies.

## Scenario 3: admin app up, api Worker stopped

This scenario covers the failure the developer meets most often in dev: the admin app runs and the api does not.

**Setup.** Run once, for every case in this scenario.

1. Stop the api Worker in its terminal with Ctrl-C. Wait for the shell prompt.
2. Confirm the port is closed. The command must fail.

```sh
curl -sS -m 2 http://localhost:4000/health
```

3. Leave the admin app running on `:3001`.
4. Open a fresh private browser window. Open `http://localhost:3001/`.

- [ ] Setup complete: the `curl` reports a refused connection, and the login card is on screen

### TC-3.1: Sign-in reports an unreachable api · 🟡 Normal

**Goal.** A sign-in that never reaches the api says so, instead of leaving the button stuck.

**Steps**

1. Enter `admin@example.com` and `Password123!`. Click Sign in.
   - [ ] Within a few seconds the button returns to "Sign in" and stays clickable
     - a button stuck on "Signing in…" is the defect commit `1ec3d06` fixed
   - [ ] A message in the error colour appears, and it names the api and `http://localhost:4000`
2. Start the api Worker again with the Environment command. Wait for it to print its URL. Click Sign in again.
   - [ ] The shell opens, so the failed attempt left the form usable

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: The dashboard shows its error card and recovers · 🟡 Normal

**Goal.** A dashboard that cannot read `/health` shows a named error and comes back without a sign-out.

**Steps**

1. Stay signed in as the admin, on the dashboard. Stop the api Worker with Ctrl-C.
2. Click Refresh on the dashboard. Then press F5 to reload the page.
   - [ ] The error card replaces the "Api health" card
     - the title reads "The api did not answer"
     - the description names `http://localhost:4000`
     - a "Try again" button sits under it
   - [ ] The app stays on `http://localhost:3001/` and does not redirect to `/login`
     - the api is down, not the session; a redirect here would be wrong
3. Start the api Worker again. Wait for it to print its URL. Click "Try again".
   - [ ] The "Api health" card returns and its badge reads `ok`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.3: Sign-out says the session is still live · 🟢 Low

**Goal.** A sign-out that never reaches the api tells the user the session survived, instead of doing nothing.

**Steps**

1. Stay signed in as the admin. Stop the api Worker with Ctrl-C.
2. Click "Sign out" in the sidebar.
   - [ ] A message under the button says the api was unreachable and the account is still signed in
   - [ ] The app stays in the shell and the sidebar is still on screen
3. Start the api Worker again. Wait for it to print its URL. Click "Sign out".
   - [ ] The app lands on `/login` and the message is gone

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Start the api Worker again if any case left it stopped. Close the private window.

## Scenario 4: reading, no servers needed

An agent confirmed that these documents exist and cover the named topics. A human judges whether they are true and useful.

**Setup.** Run once, for every case in this scenario.

1. Open `modules/admin/skills/saasaloy-admin/SKILL.md`, `modules/README.md` and the root `README.md` in an editor.

- [ ] Setup complete

### TC-4.1: The admin skill teaches the code that shipped · 🟡 Normal

**Goal.** A module author who follows the skill writes code that works, and the skill states no claim the code contradicts.

**Steps**

1. Read the skill top to bottom against `modules/admin/files/src/`.
   - [ ] Each of the six topics is accurate, and an author could act on it without reading the source
     - "Add a screen": dropping `src/routes/<name>.tsx` is enough, and the sidebar entry is a separate optional step
     - "The gate": the guard denies by throwing, and only a throw stops a child route's loader
     - "The typed client": the `hc<AppType>` recipe matches `src/lib/api.ts`
     - "Ports and CORS": `:3001` and `:4000`, and the origin allowlist
     - "Removing the module": a route file the author dropped stays on disk after `saasaloy remove admin`
     - "Deploy": the wrangler steps match `apps/admin/wrangler.jsonc`
   - [ ] The prose names no file, script or field that does not exist

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.2: The README wording matches what admin does · 🟢 Low

**Goal.** A first-time reader gets the right idea of the admin capability from the two README files.

**Steps**

1. Read the `admin` lines in the root `README.md` and in `modules/README.md`.
   - [ ] Both describe `admin` as shipped, name `apps/admin` and its stack, and read as one voice with the neighbouring module entries

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Scenario 5: a fresh project, empty `user` table

**Run this scenario last.** Its setup deletes `.dev/playground` and the two seeded accounts with it. Every case in Scenarios 1 to 4 must already have a result before you start.

This scenario covers the hook that makes `saasaloy add admin` usable out of the box: `databaseHooks.user.create.before` in `packages/auth/src/auth.ts` writes `role: "admin"` when the `user` table is empty. Nothing else in this plan sees it, because Scenarios 1 to 4 run against a database that already has rows.

Sign-up runs through the api with `curl`, not the browser. The admin app ships no sign-up route on purpose, and TC-5.3 needs two requests it can fire together.

**Setup.** Run once, for every case in this scenario.

1. Stop both dev servers with Ctrl-C. Wait for both prompts.
2. Build a fresh project and install the modules. The `add` command reads `saasaloy.json` from the shell's working directory, so it has to run inside the playground; the repository root has no such file and the command refuses there.

```sh
pnpm play:reset
(cd .dev/playground && ./saasaloy add admin --yes)
pnpm -C .dev/playground install
```

3. Give the api its dev origin, so the keyless path opens.

```sh
printf 'BETTER_AUTH_URL=http://localhost:4000\n' >> .dev/playground/apps/api/.dev.vars
```

4. Create the tables.

```sh
pnpm -C .dev/playground --filter @repo/db db:generate
pnpm -C .dev/playground --filter @repo/db db:migrate:local
```

5. Start both servers again, in their own terminals, with the Environment commands rewritten for the new playground.
6. Confirm the `user` table exists and is empty. The command must print a header and no rows.

```sh
pnpm -C .dev/playground --filter @repo/db exec wrangler d1 execute DB --local \
  --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state \
  --command "select email, role from user"
```

- [ ] Setup complete: `add admin` applied its files, the migration ran, `select` returns zero rows, and `curl -s http://localhost:4000/health` prints `{"status":"ok"}`

### TC-5.1: The first sign-up lands in the shell as the admin · 🔴 Critical

**Goal.** One sign-up on an empty table produces a working admin, with no SQL and no manual promotion.

**Steps**

1. Sign the first account up.

```sh
curl -s -i -c /tmp/qa97-first.txt -H "Origin: http://localhost:3001" -H "Content-Type: application/json" \
  -X POST http://localhost:4000/auth/sign-up/email \
  -d '{"email":"first@example.com","password":"Password123!","name":"First"}'
```

   - [ ] The status line reads `HTTP/1.1 200 OK`

2. Read the row back.

```sh
pnpm -C .dev/playground --filter @repo/db exec wrangler d1 execute DB --local \
  --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state \
  --command "select email, role from user"
```

   - [ ] Exactly one row, `first@example.com`, with `role` = `admin`
     - `user`, an empty cell or `NULL` means the hook did not fire, and TC-5.2 will pass for the wrong reason

3. Open a private browser window at `http://localhost:3001/`. Sign in as `first@example.com` with `Password123!`.
   - [ ] The shell opens: the sidebar reads "Admin", the "Overview" heading is on screen, and the "Api health" badge reads `ok`
   - [ ] The denied panel does not appear at any point

4. Call the gated route with the same account's cookie.

```sh
curl -i -b /tmp/qa97-first.txt -H "Origin: http://localhost:3001" http://localhost:4000/admin/users
```

   - [ ] The status line reads `HTTP/1.1 200 OK` and the body carries `first@example.com` with `"role":"admin"`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-5.2: The second sign-up gets the denied panel · 🔴 Critical

**Goal.** The promotion fires once per project. Every account after the first is an ordinary user, in the database, in the browser and at the api.

**Steps**

1. Sign a second account up.

```sh
curl -s -i -c /tmp/qa97-second.txt -H "Origin: http://localhost:3001" -H "Content-Type: application/json" \
  -X POST http://localhost:4000/auth/sign-up/email \
  -d '{"email":"second@example.com","password":"Password123!","name":"Second"}'
```

   - [ ] The status line reads `HTTP/1.1 200 OK`

2. Read both rows back with the `select` command from TC-5.1 step 2.
   - [ ] Two rows. `first@example.com` is still `admin` and `second@example.com` is `user`
   - [ ] `first@example.com` was not demoted or rewritten

3. Open a second private browser window at `http://localhost:3001/`. Sign in as `second@example.com` with `Password123!`.
   - [ ] The denied panel is on screen, titled "This account cannot open the admin app", naming `second@example.com`
   - [ ] No sidebar and no "Overview" heading appear, at any point

4. Call the gated route with the second account's cookie.

```sh
curl -i -b /tmp/qa97-second.txt -H "Origin: http://localhost:3001" http://localhost:4000/admin/users
```

   - [ ] `HTTP/1.1 403 Forbidden`, body `{"error":{"code":"forbidden","message":"role required: admin"}}`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-5.3: Two near-simultaneous first sign-ups: count the admins · 🟡 Normal

**Goal.** Record what the documented race actually does on this machine. Two requests that both read an empty table can both be promoted. That outcome is accepted, not locked, so this case measures rather than judges.

**There is no failing count.** One admin and two admins are both valid results. Write the number down. The case fails only if the run errors out, or if zero admins come out of it.

**Steps**

1. Empty the tables. Sign-ups leave rows in `account` and `session` too, and a stale `account` row blocks re-using an address.

```sh
pnpm -C .dev/playground --filter @repo/db exec wrangler d1 execute DB --local \
  --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state \
  --command "delete from session; delete from account; delete from user"
```

   - [ ] The `select` command from TC-5.1 step 2 returns zero rows

2. Fire two sign-ups at once. The `&` puts the first in the background, so both requests are in flight together.

```sh
curl -s -o /tmp/qa97-race-a.json -H "Origin: http://localhost:3001" -H "Content-Type: application/json" \
  -X POST http://localhost:4000/auth/sign-up/email \
  -d '{"email":"race-a@example.com","password":"Password123!","name":"Race A"}' &
curl -s -o /tmp/qa97-race-b.json -H "Origin: http://localhost:3001" -H "Content-Type: application/json" \
  -X POST http://localhost:4000/auth/sign-up/email \
  -d '{"email":"race-b@example.com","password":"Password123!","name":"Race B"}'
wait
```

   - [ ] Both commands finish and neither response file contains an `error` key

3. Count the admins.

```sh
pnpm -C .dev/playground --filter @repo/db exec wrangler d1 execute DB --local \
  --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state \
  --command "select email, role from user order by email"
```

   - [ ] Two rows are present
   - [ ] **Record the count of `role = 'admin'` rows here: \_\_\_\_ (1 or 2)**
   - [ ] At least one row reads `admin`
     - zero admins is a real failure: an empty table produced no owner, and the project is unusable without SQL

4. Repeat steps 1 to 3 twice more and record each count.
   - [ ] **Run 2 admin count: \_\_\_\_**
   - [ ] **Run 3 admin count: \_\_\_\_**

5. If any run produced two admins, note it for the tracker. The mitigation is a follow-up issue, not a fix in this branch: a unique index on `role = 'admin'` would also block promoting a second admin later, which is why the race is documented instead of locked.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _the three counts; anything else the run showed_

**Reset.** Stop both dev servers. Delete `/tmp/qa97-*`; those files hold live session cookies. The playground is now a scratch project with test accounts in it, so run `pnpm play:destroy` when you are done.

## Automated verification (by AI agent)

_Checks the agent ran itself, at commit `e23c8a8`, against the staged playground. No action needed from the tester; listed here for context and sign-off._

Static reads of the module sources:

```sh
grep -n "admin(\|plugins" modules/auth/files/src/auth.ts modules/auth/files/src/client.ts
```

```sh
grep -n "role\|banned\|banReason\|banExpires\|impersonatedBy" modules/auth/files/db/schema/auth.ts
```

```sh
grep -n "d1 execute" modules/auth/skills/saasaloy-auth/SKILL.md
```

```sh
grep -n "envPrefix\|strictPort\|port:" modules/admin/files/vite.config.ts
```

```sh
grep -rn "fetch(" modules/admin/files/src && grep -n "hc<" modules/admin/files/src/lib/api.ts
```

```sh
grep -n "^#\{1,4\} " modules/admin/skills/saasaloy-admin/SKILL.md
```

```sh
grep -n -i "admin" README.md modules/README.md
```

```sh
ls -l .dev/playground/.agents/skills/saasaloy-admin/SKILL.md .dev/playground/.claude/skills/saasaloy-admin
```

Descriptor validation, with the same Ajv 2020 build the CLI uses:

```sh
cd packages/cli && node --input-type=module -e 'import fs from "node:fs";import {Ajv2020} from "ajv/dist/2020.js";const s=JSON.parse(fs.readFileSync("schemas/registry-item.schema.json","utf8"));const v=new Ajv2020({strict:false,allErrors:true}).compile(s);for(const m of ["admin","api","auth"])console.log(m,v(JSON.parse(fs.readFileSync(`../../modules/${m}/registry-item.json`,"utf8"))));'
```

Runtime checks, with both dev servers up:

```sh
curl -sI http://localhost:3001/
```

```sh
curl -sI -H "Origin: http://localhost:3001" http://localhost:4000/health
```

```sh
curl -si -X OPTIONS -H "Origin: http://localhost:3001" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" http://localhost:4000/auth/sign-in/email
```

```sh
curl -s -i -c /tmp/qa87c.txt -H "Origin: http://localhost:3001" -H "Content-Type: application/json" -X POST http://localhost:4000/auth/sign-in/email -d '{"email":"admin@example.com","password":"Password123!"}'
```

```sh
curl -s -b /tmp/qa87c.txt -H "Origin: http://localhost:3001" http://localhost:4000/auth/get-session
```

```sh
curl -s -i -b /tmp/qa87c.txt -c /tmp/qa87c.txt -H "Origin: http://localhost:3001" -H "Content-Type: application/json" -X POST http://localhost:4000/auth/sign-out -d '{}'
```

```sh
cd .dev/playground/apps/admin && pnpm exec wrangler deploy --dry-run
```

Typed-contract check, run by editing `apps/api/src/routes/health.ts` in the playground and reverting it:

```sh
pnpm -C .dev/playground typecheck
```

Results:

- ✅ P1-plugin → `auth.ts:99 plugins: [admin()]` and `client.ts:26 plugins: [adminClient()]`. Both halves of the plugin are on.
- ✅ P1-schema → `role`, `banned`, `ban_reason`, `ban_expires` on `user`, `impersonated_by` on `session`. The playground's applied migration carries all five.
- ✅ P1-session → `get-session` for `admin@example.com` returns `"role":"admin"`, and `session.impersonatedBy` is present.
- ✅ P1-doc → the promotion one-liner is at `SKILL.md:131` (`--local`) and `:136` (`--remote`). It was run verbatim to seed the playground.
- ✅ P2-schema-valid → `admin`, `api` and `auth` descriptors all validate; every `scaffolds[].files` source exists on disk.
- ✅ P2-dev → `:3001` answers `HTTP/1.1 200 OK`, `Content-Type: text/html`, with `<title>Admin</title>`, the `noindex` robots meta and `id="root"`. `vite.config.ts:43` sets `port: 3001, strictPort: true`.
- ✅ P2-deploy → `wrangler deploy --dry-run` exits 0, reads 8 files from `dist`, reports no bindings.
- ✅ P2-env → `vite.config.ts:31` sets `envPrefix: "PUBLIC_"`.
- ✅ P3-guard-code → the guard throws on every deny. `beforeLoad` redirects an anonymous visitor to `/login`, then throws `NotAdminError` for a non-admin before the login-page redirect. `isAdmin` is `session?.user.role === "admin"`, a strict equality against a constant.
- ✅ P3-signin, transport half → sign-in returns 200 with an `HttpOnly` `SameSite=Lax` session cookie; sign-out returns 200, expires all three cookies, and `get-session` then returns `null`.
- ✅ P3-cors → the simple request and the preflight both echo `access-control-allow-origin: http://localhost:3001` with `access-control-allow-credentials: true`.
- ✅ P4-client → the only `fetch(` match in the module's `src` is inside a comment; `src/lib/api.ts:27` is `hc<AppType>(...)`; the dashboard uses `queryOptions` + `ensureQueryData` + `useQuery`.
- ✅ P4-typecheck → baseline exits 0. Changing `health.ts` to `c.json({ ok: true }, 200)` fails with `@repo/admin:typecheck: src/routes/index.tsx(84,45): error TS2339: Property 'status' does not exist on type '{ ok: true; }'`. Reverting returns it to 0.
- ✅ P5-skill, presence half → all six topics have a section, plus a seventh on Loader and Query.
- ✅ P5-skill-installed → `.agents/skills/saasaloy-admin/SKILL.md` exists and `.claude/skills/saasaloy-admin` is a symlink to it.
- ✅ P5-docs, presence half → both README files name `admin` and `apps/admin` with its stack, in the present tense.
- ✅ The non-admin seed is real → `get-session` for `user@example.com` returns `"role":"user"`, so Scenario 2 has the account it needs.

Checks confirmed earlier in the run and deliberately not repeated here, because repeating them would rebuild or reset the staged playground:

- P2-add (`pnpm play:reset` + `saasaloy add admin --yes`) → passed at `3ceb136`. It resolves `api → database → auth → admin`, applies 40 files, and registers the `@admin` alias. A re-run deletes the seeded accounts.
- P2-routing (drop a route file, rebuild, delete it) → passed at `3ceb136`, byte-for-byte reversible.
- P5-remove (`saasaloy remove admin --yes`) → passed at `3ceb136`. It deletes 16 files and leaves a foreign route drop on disk. A re-run deletes the app under test.
- P5-deps (`pnpm deps:verify`) → passed at `3ceb136`. The script starts with `play:init --force`, which rewrites the playground's `saasaloy.json`.
- P5-suite (`pnpm test`, `pnpm build`) → green at this HEAD, 13 files and 237 tests.

Every one of the four fix commits since `3ceb136` (`6f8a50e`, `1ec3d06`, `056d2ed`, `e23c8a8`) touches only `modules/admin/files/src/routes/__root.tsx`, `login.tsx`, `components/sign-out-button.tsx`, `lib/auth.ts` and the admin skill. None touches a descriptor, a dependency or the CLI, which is why the five checks above still hold.

The agent stopped both dev servers when it finished. The tester starts them again with the Environment commands.

## Not covered / needs human judgment

- **Visual polish and layout at other widths.** Every case above runs at one desktop width. The sidebar is a fixed 60-unit column with no responsive rule, so a narrow window is untested.
- **Keyboard and screen-reader use.** The sign-in form, the sidebar link and both error paragraphs carry labels and `role="alert"`, but nobody has driven them with a keyboard or a screen reader.
- **Dark mode.** The admin app inherits `@repo/ui` tokens. No case checks the dark palette.
- **Production-shaped config.** Every run used the localhost dev fallbacks. `COOKIE_DOMAIN`, `BETTER_AUTH_URL` and a real `PUBLIC_API_URL` origin are untested end to end.
- **A session that dies mid-visit.** `loadSession()` memoises for the page load, so a revoked session keeps painting the shell until a reload while the api answers 401. That is a cosmetic lag and not a privilege, because the api authorizes each request on the cookie it receives. It is written down in `src/lib/auth.ts` and it is not tested here.
- **A second `saasaloy add admin` over an edited file.** Whether the second add reports "needing merge" cleanly is untested.
- **Concurrency and performance.** The dashboard reads one endpoint with one row of data, so neither dimension carries risk worth a case.
- **The first-admin race under real load.** TC-5.3 fires two sign-ups from one shell on one machine. It records what happens; it does not establish how wide the window is on a deployed Worker with a public origin, where the two requests may land on different isolates. Treat its counts as an observation, not a bound.
- **`account.issuer` on a project that upgraded.** The schema snapshot now carries the column better-auth 1.7.2 made required, and the auth skill documents the migration edit it needs. That sequence was run against a standalone SQLite database on drizzle-kit 0.31.10, but not against a real D1 through `db:migrate:local`. Every run in this plan starts from a fresh `add auth`, so the upgrade path is untested here.
