# QA Plan: admin Intercom-style shell, theme and screens

_Generated 2026-09-07 · against `03cccb7` · covers issue #123: the admin app's dark-first theme, the eight vendored ui primitives, the three-panel shell, the seven page primitives, and the `/` and `/users` screens_

## Summary

- The admin app renders as three floating panels on a dark canvas: an icon rail, a nav panel, and a content panel. It ships an Inter face, its own token set, a sortable users table, and a detail panel.
- "Working" means the shell matches the reference screenshots at desktop and collapses correctly below `md`, the theme cycles and survives a reload in all three states, and the users screen loads real api rows, sorts, filters and opens a detail panel.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-123-intercom-style-shell-layout-and-theme`, at commit `03cccb7`.
- The project under test is the clean scaffold at `.dev/fresh`. It is git-ignored, it already has `node_modules` installed, and it carries the fixed sources from this commit. Nothing else needs scaffolding.
- Ports are pinned. `apps/admin` is `http://localhost:3001`, `apps/api` is `http://localhost:4000`. A drifting port breaks CORS and the session cookie, so a busy port must fail rather than move.
- Credentials: sign-up is open, and **the first account to sign up becomes the admin**. Claim that account the moment the api answers. A second account gets the `user` role and lands on the access-denied screen, which Scenario 6 needs.
- Use a browser you can open DevTools in. Several checkpoints read `localStorage`, the computed font, and the accessibility tree.
- The reference screenshots are `.afkkit/mockups/mockup-1.png`, `mockup-2.png` and `mockup-3.png`. Open `mockup-1.png` beside the browser for Scenario 2.

Start the api and the admin app in two terminals.

```sh
pnpm -C .dev/fresh --filter @repo/api dev
```

```sh
pnpm -C .dev/fresh --filter @repo/admin dev
```

**A warning about the build cache.** Turborepo's cache at `/home/dev/projects/saasaloy/.turbo/cache` is shared by every worktree of this repository. It has already replayed one branch's `apps/web` build into another branch's scaffold. If you verify build output rather than the running app, pass `--force`, or you may read a different branch's bytes.

```sh
pnpm -C .dev/fresh exec turbo run build --force
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
| --- | --- | --- | --- |
| TC-1.1 | 1: fresh profile, signed out | An anonymous visit redirects to a centred login panel | 🔴 Critical |
| TC-1.2 | 1: fresh profile, signed out | The first load paints dark and stores the choice | 🔴 Critical |
| TC-2.1 | 2: admin session, desktop | The shell reads as three floating panels | 🔴 Critical |
| TC-2.2 | 2: admin session, desktop | The dark palette matches the reference screenshots | 🔴 Critical |
| TC-2.3 | 2: admin session, desktop | Inter renders, and counts align in their columns | 🟡 Normal |
| TC-2.4 | 2: admin session, desktop | The rail and the nav panel carry their content and their active state | 🔴 Critical |
| TC-2.5 | 2: admin session, desktop | The users table sorts, hovers, selects and fills empty cells | 🔴 Critical |
| TC-2.6 | 2: admin session, desktop | The role chips filter with no network request | 🟡 Normal |
| TC-2.7 | 2: admin session, desktop | A row click opens the detail panel beside the table | 🔴 Critical |
| TC-2.8 | 2: admin session, desktop | The keyboard reaches every control, in order | 🔴 Critical |
| TC-2.9 | 2: admin session, desktop | A screen reader reads the table as a table | 🟡 Normal |
| TC-2.10 | 2: admin session, desktop | An unknown path renders the not-found screen inside the shell | 🟡 Normal |
| TC-2.11 | 2: admin session, desktop | The panel outline against the reference | 🟢 Low |
| TC-3.1 | 3: admin session, below `md` | The nav panel moves into a sheet and the rail stays | 🔴 Critical |
| TC-3.2 | 3: admin session, below `md` | The detail panel moves into a sheet | 🟡 Normal |
| TC-4.1 | 4: admin session, theme | The toggle cycles light → dark → system | 🔴 Critical |
| TC-4.2 | 4: admin session, theme | Every state survives a reload, `system` included | 🔴 Critical |
| TC-4.3 | 4: admin session, theme | The light palette is legible on every surface | 🟡 Normal |
| TC-4.4 | 4: admin session, theme | The toggle announces the state it is in | 🟡 Normal |
| TC-5.1 | 5: admin session, api stopped | Both screens report a down api and recover | 🟡 Normal |
| TC-5.2 | 5: admin session, api stopped | A failed sign-out says so where it can be read | 🟡 Normal |
| TC-6.1 | 6: non-admin session | Access denied renders inside the shell | 🔴 Critical |

## Scenario 1: fresh profile, signed out

**Setup.** Run once, for every case in this scenario.

1. Open a private window, or clear `localStorage` and the session cookie for `localhost`.
2. Confirm the api answers.

```sh
curl -i http://localhost:4000/health
```

- [ ] Setup complete

### TC-1.1: An anonymous visit redirects to a centred login panel · 🔴 Critical

**Goal.** An unauthenticated visitor reaches login, and login is one panel on the canvas rather than a shell.

**Steps**

1. Open `http://localhost:3001/users`.
   - [ ] The app redirects to `/login`, and the address bar carries the intended path so sign-in can return to it.
   - [ ] The screen shows one centred rounded panel on the canvas, with no rail and no nav panel.
     - the panel holds the email field, the password field and the submit button
     - nothing outside the panel competes for attention
2. Submit the form with a blank password.
   - [ ] The screen shows an error inside the panel, and the fields keep their values.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The first load paints dark and stores the choice · 🔴 Critical

**Goal.** A visitor who has never chosen a theme lands on dark, whatever the operating system prefers.

**Steps**

1. Set the operating system to its **light** appearance. Reload `http://localhost:3001/login` with `localStorage` empty.
   - [ ] The page paints dark. The OS preference does not win on a first visit.
   - [ ] No flash of a light page appears for longer than one frame before the dark palette lands.
2. Open DevTools and read the state.
   - [ ] `<html>` carries `class="dark"` and `data-theme="dark"`.
   - [ ] `localStorage.theme` is `dark`.
3. Set `localStorage.theme` to `light` by hand, then reload.
   - [ ] The page paints light. A stored choice beats the dark default.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

1. Clear `localStorage` for `localhost:3001`.
2. Return the operating system to the appearance you normally use.

## Scenario 2: admin session, desktop at 1280px or wider

**Setup.** Run once, for every case in this scenario.

1. Sign up the first account at `http://localhost:3001/login`. That account gets the admin role.
2. Land on the overview at `/`.
3. Set the browser window to 1280px wide or more.
4. Open `.afkkit/mockups/mockup-1.png` beside the browser.

- [ ] Setup complete

### TC-2.1: The shell reads as three floating panels · 🔴 Critical

**Goal.** The layout is the reference layout: separate rounded panels on a darker canvas, not one flat page.

**Steps**

1. Look at the whole window.
   - [ ] Three regions are distinct: an icon rail on the left, a nav panel beside it, and a content panel filling the rest.
     - the rail has no panel background; it sits directly on the canvas
     - the nav panel and the content panel are rounded rectangles, lighter than the canvas
   - [ ] An even gutter of about 8px separates the panels from each other and from every viewport edge.
   - [ ] The corner radius reads at about 12px, matching the screenshot rather than the sharper landing-page corner.
2. Scroll the users table, then the overview.
   - [ ] Only the content panel scrolls. The rail, the nav panel and the page itself stay still.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The dark palette matches the reference screenshots · 🔴 Critical

**Goal.** The measured tokens render as the three-step neutral ramp the screenshots hold.

**Steps**

1. Compare the window with `mockup-1.png` side by side.
   - [ ] The ramp reads in three steps: the canvas is darkest, a panel is one step lighter, a hovered or selected row is one step lighter again.
   - [ ] No surface reads as coloured. The faint blue cast is present but nothing looks tinted.
2. Look at the accents.
   - [ ] The active sort header is the only orange on the screen.
   - [ ] The `admin` role pill is the muted blue of the screenshot's `Open` pill, and no pill is orange.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Inter renders, and counts align in their columns · 🟡 Normal

**Goal.** The pinned font reaches the page, rather than falling back to the system stack.

**Steps**

1. Select the nav panel's "Admin" title. Read its computed `font-family` in DevTools.
   - [ ] The computed family resolves to `Inter Variable`, not to the system sans stack.
2. Look at the numeric columns.
   - [ ] Digits in the nav row counts and in the table's date column line up vertically, because the body enables tabular figures.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: The rail and the nav panel carry their content and their active state · 🔴 Critical

**Goal.** Both navigation surfaces render what the shell promises, and the active row follows the route.

**Steps**

1. Hover each rail icon in turn.
   - [ ] A tooltip appears beside the icon and names the area.
2. Look at the rail footer.
   - [ ] A theme toggle and a round avatar are both present.
3. Open the avatar menu.
   - [ ] The menu lists the account name, the email address, a separator, and a sign-out item.
4. Look at the nav panel.
   - [ ] It shows the area title, then a collapsible "Manage" group holding "Overview" and "Users".
   - [ ] Collapsing the group hides its rows and turns the chevron. Expanding restores them.
5. Navigate from `/` to `/users` and back.
   - [ ] The highlight moves with the route in both the nav panel and the rail, with no lag and no second row left highlighted.
   - [ ] On `/`, only "Overview" is highlighted. "Users" is not.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.5: The users table sorts, hovers, selects and fills empty cells · 🔴 Critical

**Goal.** The table behaves as the reference does, and no cell is ever blank.

**Steps**

1. Open `/users`.
   - [ ] The header count is the api's total, and it does not change when you filter later.
   - [ ] Every row shows a small avatar with initials beside the name.
2. Click the "Name" header, then click it again.
   - [ ] The rows reorder, and reorder the other way on the second click. The order never returns to unsorted.
   - [ ] Only the sorted header is orange, and its arrow points the way the rows are ordered.
3. Click the "Created" header.
   - [ ] The rows order by date, not by the printed text. The orange moves to this header and leaves "Name".
4. Scroll the table body with more rows than fit.
   - [ ] The header row stays visible and stays opaque. No row shows through it.
5. Hover a row, then move away.
   - [ ] The row lightens on hover and returns when the pointer leaves.
6. Find or create a user with no name.
   - [ ] The empty cell shows an em dash in the muted text colour, never a blank space.
   - [ ] The "Verified" column reads `Yes` or `No`, never `true` or `false`.
7. Select the "Admins" chip on a project with only one admin, then select a role with no members.
   - [ ] A table with no rows shows the empty-state sentence, and the header row is still there.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.6: The role chips filter with no network request · 🟡 Normal

**Goal.** Filtering is client-side over the rows already loaded.

**Steps**

1. Open the DevTools network panel and clear it. Select the "Admins" chip.
   - [ ] The table narrows to admin rows only.
   - [ ] The network panel records no request to `/admin/users`.
2. Select the "All" chip.
   - [ ] Every row returns, still with no request.
   - [ ] Each chip carries a count, and the counts add up to the "All" count.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.7: A row click opens the detail panel beside the table · 🔴 Critical

**Goal.** Selection opens a fourth panel at desktop width, with the anatomy the reference draws.

**Steps**

1. Click a row.
   - [ ] A detail panel opens to the right of the table, as a fourth panel with the same chrome as the others.
   - [ ] The clicked row stays highlighted while the panel is open.
   - [ ] The panel names the user and lists label-and-value pairs, with an em dash wherever a value is empty.
2. Look at the panel header and body. Compare with `mockup-2.png`.
   - [ ] The header holds a tab row, an open-in-new action and a close action.
   - [ ] The body scrolls on its own, and holds collapsible "Account" and "Access" groups.
   - [ ] The second tab opens and is empty. That is intended.
3. Click another row, then press the close action.
   - [ ] The panel swaps to the second user rather than opening twice.
   - [ ] Close removes the panel and clears the row highlight.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.8: The keyboard reaches every control, in order · 🔴 Critical

**Goal.** The shell is operable without a pointer, and a table row is one tab stop rather than none or five.

**Steps**

1. Load `/users`. Press Tab repeatedly from the top of the page.
   - [ ] Focus moves through the rail, then the nav panel, then the content panel, in that reading order.
   - [ ] Every focused control shows a visible focus ring.
2. Tab into the table.
   - [ ] Each row offers exactly one tab stop, in the first cell.
   - [ ] Enter on that stop opens the detail panel for that row, and fires once rather than twice.
   - [ ] Space does the same, and does not scroll the page.
3. Open the avatar menu with the keyboard.
   - [ ] Arrow keys move between the menu items, and the sign-out item is reachable.
   - [ ] Escape closes the menu and returns focus to the avatar.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.9: A screen reader reads the table as a table · 🟡 Normal

**Goal.** The clickable row keeps its native row semantics. This is the behaviour the fix round changed, so check it rather than assume it.

**Steps**

1. Turn on the platform screen reader. Move into the users table.
   - [ ] The reader announces a table with its caption, and announces each row as a row with its column headers.
   - [ ] No row is announced as a button.
2. Move to the sortable headers.
   - [ ] Each sortable header is announced as a button, and the sorted one announces ascending or descending.
3. Move to the first cell of the selected row.
   - [ ] The reader announces it as the current item.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.10: An unknown path renders the not-found screen inside the shell · 🟡 Normal

**Goal.** An error screen keeps the navigation around it.

**Steps**

1. Open `http://localhost:3001/nope`.
   - [ ] The not-found message renders inside the content panel, with the rail and the nav panel still on screen.
   - [ ] The nav panel still navigates from that screen.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.11: The panel outline against the reference · 🟢 Low

**Goal.** Settle one open question the code review raised and no agent could judge: every panel draws a hairline border at `oklch(0.354 0.014 256.77)`, and the reference may separate panels by fill contrast alone.

**Steps**

1. Put the window and `mockup-1.png` side by side at the same zoom. Look only at the edges of the nav panel and the content panel.
   - [ ] Decide: the outline reads the same as the screenshot, or it reads as a grey line the screenshot does not draw.
     - compare the panel edge, not the rule under a panel header
     - the rule under a header is intended and stays either way
2. Record the verdict in **Notes**, whichever way it goes.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _the verdict, in one line. A fail here is a follow-up issue, not a blocker._

**Reset.** Run after every case above, before moving to Scenario 3.

1. Return to `/users`.
2. Close the detail panel and select the "All" chip.

## Scenario 3: admin session, viewport below the `md` breakpoint

**Setup.** Run once, for every case in this scenario.

1. Stay signed in as the admin.
2. Narrow the browser window to 600px, or switch DevTools to a phone profile.

- [ ] Setup complete

### TC-3.1: The nav panel moves into a sheet and the rail stays · 🔴 Critical

**Goal.** The narrow layout drops one panel without dropping navigation.

**Steps**

1. Look at the screen.
   - [ ] The nav panel is gone and the rail is still on screen.
   - [ ] A toggle appears in the content header, beside the area name.
2. Press the toggle.
   - [ ] The nav slides in over the content as a sheet, with the same rows as the desktop panel.
   - [ ] Pressing a row navigates and closes the sheet.
   - [ ] The close control inside the sheet also closes it.
3. Reload the page with the sheet open.
   - [ ] The sheet is closed after the reload. No nav state persists.
4. Press the rail icons and the nav rows with a finger, or check their height in DevTools.
   - [ ] Every row is at least 44px tall, so it is a usable touch target.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: The detail panel moves into a sheet · 🟡 Normal

**Goal.** The same detail node renders beside the table at desktop and over it below `md`.

**Steps**

1. Open `/users` at this width and click a row.
   - [ ] The detail opens as a sheet sliding in from the right, over the content.
   - [ ] The sheet holds the same tabs, actions and groups the desktop panel held.
   - [ ] Tab stays inside the sheet while it is open, and Escape closes it.
2. Widen the window past 768px with the sheet open.
   - [ ] The detail becomes the fourth panel beside the table, without losing the selected user.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 4.

1. Return the window to 1280px or wider.

## Scenario 4: admin session, theme

**Setup.** Run once, for every case in this scenario.

1. Stay signed in as the admin, at 1280px or wider.
2. Open DevTools on the Application tab, with `localStorage` for `localhost:3001` visible.
3. Clear `localStorage`, then reload. The app paints dark and stores `theme: dark`.

- [ ] Setup complete

### TC-4.1: The toggle cycles light → dark → system · 🔴 Critical

**Goal.** One press advances one step, and the palette repaints each time.

**Steps**

1. Press the toggle in the rail footer three times, watching after each press.
   - [ ] The order is dark → system → light → dark. Each press repaints the whole app, not part of it.
   - [ ] The icon changes with the state: sun for light, moon for dark, monitor for system.
2. Press to `system`, then switch the operating system between light and dark appearance.
   - [ ] The app follows the operating system while the state is `system`, with no reload.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.2: Every state survives a reload, `system` included · 🔴 Critical

**Goal.** This is the bug the fix round repaired. A `system` choice used to be re-pinned to dark on the next load.

**Steps**

1. Press the toggle until the state is `light`. Reload.
   - [ ] The app is still light after the reload.
   - [ ] `localStorage` holds `theme: light` and `theme-chosen: 1`.
2. Press the toggle until the state is `system`. Read `localStorage` before reloading.
   - [ ] The `theme` key is gone, and `theme-chosen: 1` remains. Both are expected.
3. Reload.
   - [ ] The app is still following the operating system. It does **not** return to dark.
   - [ ] `<html>` carries `data-theme="system"`.
4. Reload once more, with the operating system set to light.
   - [ ] The app paints light, because `system` resolves against the OS.
5. Delete `theme-chosen` by hand, leave `theme` absent, then reload.
   - [ ] The app returns to dark. An absent marker is a first visit again, which is the intended migration for a profile created before this change.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.3: The light palette is legible on every surface · 🟡 Normal

**Goal.** Light is a first-class theme, and no reference screenshot exists for it, so it needs an eye.

**Steps**

1. Set the state to `light`. Walk the overview, `/users`, an open detail panel and the open account menu.
   - [ ] Every surface is legible, with nothing invisible on its own background.
     - rail icons and the active icon's fill
     - nav rows, their hover and their active state
     - table header, row hover, the selected row
     - the status pill and the active sort header
     - the account menu, which opens above a panel
   - [ ] The three-step ramp still reads, in reverse: a cream canvas, white panels, a warmer hover.
2. Repeat the same walk in `dark`.
   - [ ] The same sweep is clean in dark.
   - [ ] No text sits at near-black on the dark canvas where a muted token was intended.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-4.4: The toggle announces the state it is in · 🟡 Normal

**Goal.** The fix round added a relabel pass on mount. Before it, the button announced `system` over a painted dark page.

**Steps**

1. Clear `localStorage` and reload, so the app paints dark on a first visit. Inspect the toggle in the accessibility panel, without clicking it.
   - [ ] Its accessible name says the theme is dark and names the next state, rather than saying `system`.
2. Press the toggle once.
   - [ ] The accessible name follows the new state.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 5.

1. Clear `localStorage` and reload, so the app is back on dark.

## Scenario 5: admin session, api stopped

**Setup.** Run once, for every case in this scenario.

1. Stay signed in as the admin.
2. Stop the `apps/api` terminal.

- [ ] Setup complete

### TC-5.1: Both screens report a down api and recover · 🟡 Normal

**Goal.** A down api is the ordinary case in development, and neither screen may go blank.

**Steps**

1. Reload `/`.
   - [ ] The overview shows an error inside the content panel, with the rail and the nav panel still around it.
   - [ ] A "Try again" button sits in the page header.
2. Reload `/users`.
   - [ ] The users screen shows the same shape of error, with its own "Try again" button in the page header.
   - [ ] The two screens use the same button, not a plain underlined link on one of them.
3. Restart the api, then press "Try again" on each screen.

   ```sh
   pnpm -C .dev/fresh --filter @repo/api dev
   ```

   - [ ] Each screen reloads its data and renders normally, with no full page reload.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-5.2: A failed sign-out says so where it can be read · 🟡 Normal

**Goal.** The fix round kept the account menu open on failure. The error used to render inside a menu that closed on the click.

**Steps**

1. Stop the api again. Open the account menu in the rail and press "Sign out".
   - [ ] The menu stays open.
   - [ ] An error line appears inside the menu and says the session is still live.
   - [ ] You are still signed in, and the shell still renders.
2. Restart the api and press "Sign out" again.
   - [ ] The app signs out and lands on `/login`, and the menu goes with the shell.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 6.

1. Restart the api if it is stopped.
2. Sign back in as the admin account.

## Scenario 6: non-admin session

**Setup.** Run once, for every case in this scenario.

1. Sign out of the admin account.
2. Sign up a second account. It gets the `user` role.

- [ ] Setup complete

### TC-6.1: Access denied renders inside the shell · 🔴 Critical

**Goal.** A signed-in account without the admin role sees a real screen, not an empty table.

**Steps**

1. Sign in as the second account.
   - [ ] The access-denied screen renders inside the shell, with the rail and the nav panel around it.
   - [ ] A sign-out control on that screen works and returns to `/login`.
2. Confirm the server, not only the browser, refuses the data.

   ```sh
   curl -i -b /tmp/non-admin-cookies.txt http://localhost:4000/admin/users
   ```

   - [ ] The response is `403` with a `forbidden` error code. A `200` means the route skipped its gate.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _the cookie jar comes from the sign-in request; the `saasaloy-admin` skill documents how to capture it_

**Reset.** Run at the end of the plan.

1. Sign out.
2. Stop both dev terminals.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. Nothing in this section was re-run while the plan was written. Every result is transcribed from `.afkkit/verified.md`, which records the verification and the fix round._

The repository's own gate, re-run after the fix round:

```sh
pnpm test && pnpm build && pnpm lint
```

```sh
pnpm typecheck
```

- ✅ `pnpm test` → exit 0. Turborepo task green, `test:modules` 94 tests, `test:scripts` 82 tests, 0 failures. Six of those cases are the new `modules/admin/files/src/lib/initials.test.ts`.
- ✅ `pnpm build` → exit 0.
- ✅ `pnpm lint` → exit 0, all four passes: `lint:types`, `lint:code`, `lint:css`, `format:check`.
- ✅ `pnpm typecheck` → exit 0.
- ✅ **The landing page stylesheet is back to its pre-branch size.** Built in `.dev/playground` with `turbo run build --force` to defeat the shared cache. Before the fix, 71,537 bytes. A build of the same sources with the eight new primitives removed, which is the `main`-equivalent baseline, 45,748 bytes. After the fix, 45,706 bytes and 8,597 gzip. Diffed rule by rule against the baseline, the only difference is one dropped `.underline` declaration. It went when the users error screen swapped its underlined link for a `Button`, which TC-5.1 checks. The landing page picks that up because `globals.css` scans every app, a rule that predates this branch.
- ✅ **The eight primitives still reach the admin bundle.** `tabs-list` 26 times, `dropdown-menu` twice, `mix-blend-darken` once, `caption-bottom` once in the admin CSS, and zero times in the landing page CSS.
- ✅ **The clean scaffold builds.** `.dev/fresh` was refreshed with the fixed sources and rebuilt from empty `dist` directories: three tasks, exit 0. `apps/admin/dist` carries the users chunk, the Inter `woff2` files and a 76,187-byte stylesheet.
- ✅ **A nav entry for a missing route fails typecheck.** Adding `{ to: "/nope" }` to `NAV_AREAS` produced `TS2322` in `nav-panel.tsx`; removing it restored a clean run.
- ✅ **No page primitive reaches for data.** A grep over `modules/admin/files/src/components/` for `@repo/api`, `hono/client`, `@admin/lib/api` and `import.meta.env` returns nothing.
- ✅ **Nothing about the nav is stored.** A grep for `localStorage` and `sessionStorage` over the same directory returns nothing.
- ✅ **The route tree is generated, not hand-written.** A clean scaffold's build regenerated `routeTree.gen.ts`; after normalising quotes and semicolons it is identical to the committed file.
- ✅ **`wrangler deploy --dry-run` for `apps/admin`** → exit 0, 30 files read from the assets directory.
- ✅ **`DESIGN.md` passes the official linter** → 0 errors, 0 warnings, 2 pre-existing infos.
- ✅ **The theme logic was traced by hand** over its four states, because no browser can run here. TC-4.2 is the case that actually confirms it.
- ❌ **`pnpm verify:preset`** → exit 1, `recorded 101fd7fd684f, computed 8216141e2c84`. **Pre-existing**: the stamp was already stale against `main`'s own `globals.css`. The computed value moves because the landing-page fix edits that file.
- ❌ **`pnpm deps:verify`** → fails at its `pnpm -C .dev/playground lint` step with "No files found to lint". The playground has no `.git` of its own, so oxlint reads the parent worktree's `.gitignore`, where `.dev/` is ignored. **Pre-existing on `main`.**
- ❌ **`pnpm deps:check`** → exit 1, 16 pending updates. **Pre-existing on `main`.**
- ❌ **Three typecheck errors in the scaffolded project**, two in `apps/api/src/index.ts` and one in `packages/auth/src/auth.ts`. **Pre-existing on `main`**, and none of them is in `apps/admin`.

## Not covered / needs human judgment

- **Every rendered and interactive observable.** This box is headless. It has no browser, and `verifykit` cannot run here. That is why all 22 cases above are manual.
- **The light palette against any reference.** The three mockups are dark only, so TC-4.3 is a judgment, not a comparison.
- **The panel outline.** TC-2.11 settles an open review finding rather than confirming a requirement. A fail there is a follow-up issue.
- **Performance under a large table.** The api caps its answer at 100 users, so a realistic large-volume pass needs a seeded database this plan does not build.
- **Concurrency and timing.** The screens are read-only, so double-submit and race conditions have no surface here. Deliberately skipped.
- **Compatibility across browsers and operating systems.** Run the plan in one browser first. Repeat TC-2.1, TC-2.2 and TC-3.1 in a second browser if the project targets one.
- **A deployed build.** Only `wrangler deploy --dry-run` ran. No bundle reached Cloudflare.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
