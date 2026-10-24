# QA Plan: Command palette and keyboard shortcuts (#264)

_Generated 2026-10-24, updated 2026-10-24 after the review fixes · against `dce4c594` (clean) · covers the `command` module, the shell command contract, and the admin and app commands_

## Summary
- Cmd/Ctrl+K opens a command palette, `G` then a letter goes to a screen, single keys act on a data table, and `?` lists every shortcut, in admin and in the customer app.
- Working means every task in both apps runs with no mouse, and the palette and the `?` sheet match the approved round 1 mockup in plan 0084.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-264-add-the-cmd-k-command-palette-and-shortcut` at `dce4c594`.
- Playground: `.dev/playground` with the `admin`, `app` and `command` modules installed.
- Admin: `http://localhost:3001`, sign in as `admin@example.test`.
- App: `http://localhost:3002`, sign in as `member@example.test`.
- Password for both: `saasaloy-dev-password`.
- The approved mockup is Phase 1 of `docs/plans/0084-plan-command-module-2026-10-24.md`.

If the playground does not exist, build it from the repo root:

```sh
pnpm play:init && cd .dev/playground && ./saasaloy add admin --with database-d1 --yes && ./saasaloy add app --yes && ./saasaloy add command --yes && pnpm install
```

Then fill the env values, seed the database and start the servers from `.dev/playground`. Each command goes in its own terminal.

```sh
pnpm env:setup && pnpm --filter @repo/db db:generate && pnpm db:setup && pnpm db:seed
```

```sh
pnpm --filter @repo/api dev
```

```sh
pnpm --filter @repo/admin dev
```

```sh
pnpm --filter @repo/app dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Admin signed in on Users | The palette and the `?` sheet match the mockup | 🔴 Critical |
| TC-1.2 | 1: Admin signed in on Users | The keyboard flow feels right | 🟡 Normal |
| TC-1.3 | 1: Admin signed in on Users | A Mac shows ⌘ keycaps | 🟢 Low |
| TC-2.1 | 2: App signed in on Home | The palette and the `?` sheet match the mockup in the web-brand skin | 🔴 Critical |

## Scenario 1: Admin signed in on Users

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login` and sign in as `admin@example.test`.
2. Open `http://localhost:3001/users`.

- [ ] Setup complete

### TC-1.1: The palette and the `?` sheet match the mockup  ·  🔴 Critical

**Goal.** The built palette, trigger and `?` sheet match the approved round 1 mockup in both themes and both widths.

**Steps**

1. Compare each screenshot below with the round 1 mockup picks in plan 0084 Phase 1.
   - [ ] The palette matches the mockup in light and dark at 1280 px and 360 px
     - the search row, the group labels, the row height and the icons
     - the keycaps have a hairline and no fill, and stay legible in dark
     - "Current" shows on the theme in use, in place of a keycap
     - the footer shows Move, Run, Esc Close and All shortcuts; below 640 px only Move and Run
     - the palette sits near the top, and is never stuck to the bottom on a phone
     - screenshot: `/tmp/qakit/0080-qa-command-palette-2026-10-24/admin-dark-1280-palette.png` · `admin-light-1280-palette.png` · `admin-dark-360-palette.png` · `admin-light-360-palette.png`
   - [ ] The filtered list and the empty result read correctly
     - "usr" shows Go to Users with the matched letters semibold and underlined
     - the empty copy reads `No commands match “zzqxv”` and suggests a page name
     - screenshot: `admin-dark-1280-filtered.png` · `admin-light-1280-filtered.png` · `admin-dark-1280-empty.png` · `admin-light-360-empty.png`
   - [ ] The `?` sheet matches the mockup
     - two columns at 1280 px, one column at 360 px
     - General, Navigation and Data table sections; sequences read `G then U`
     - screenshot: `admin-dark-1280-help.png` · `admin-light-1280-help.png` · `admin-dark-360-help.png`
   - [ ] The header trigger matches the mockup
     - a "Search commands…" field with Ctrl K keycaps at 1280 px, an icon button at 360 px
     - screenshot: `admin-light-1280-closed.png` · `admin-light-360-closed.png`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The keyboard flow feels right  ·  🟡 Normal

**Goal.** A person can work the Users page with no mouse, and the motion and highlight feel clear.

**Steps**

1. Press Ctrl+K (⌘K on a Mac). Type `usr`. Press Enter.
2. Press `J` three times, then `K` once. Press Enter. Press Esc.
   - [ ] The row highlight is easy to follow, and the detail panel opens and closes without a jump
3. Press `?`. Press Esc. Press Ctrl+B two times.
   - [ ] The open and close fades feel quick and calm, and nothing flickers
     - the palette, the `?` sheet and the sidebar collapse

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A Mac shows ⌘ keycaps  ·  🟢 Low

**Goal.** The keycaps follow the platform on a real Mac.

**Steps**

1. On a Mac, open the admin Users page. Press ⌘K.
   - [ ] The trigger, the palette rows and the `?` sheet show ⌘, not Ctrl
2. Press ⌘B.
   - [ ] The sidebar toggles once, and the browser does not open its bookmarks

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. The cases change only the theme, and the palette sets it back.

## Scenario 2: App signed in on Home

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3002/sign-in` and sign in as `member@example.test`.

- [ ] Setup complete

### TC-2.1: The palette and the `?` sheet match the mockup in the web-brand skin  ·  🔴 Critical

**Goal.** The app's palette and `?` sheet match the approved mockup in the web-brand skin.

**Steps**

1. Compare each screenshot below with the round 1 mockup picks.
   - [ ] The palette, the filtered list and the empty result match the mockup in light and dark
     - Home declares no page commands, so the list starts at Navigation
     - "thme" lists the three theme rows
     - screenshot: `/tmp/qakit/0080-qa-command-palette-2026-10-24/app-light-1280-palette.png` · `app-dark-1280-palette.png` · `app-light-360-palette.png` · `app-dark-360-palette.png` · `app-light-1280-filtered.png` · `app-dark-1280-empty.png`
   - [ ] The `?` sheet and the trigger match the mockup
     - screenshot: `app-light-1280-help.png` · `app-dark-360-help.png` · `app-light-1280-closed.png` · `app-light-360-closed.png`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm deps:check
```

- ✅ `pnpm lint` → exit 0 at `dce4c594`, all four passes clean.
- ✅ `pnpm typecheck` → exit 0 at `dce4c594`.
- ✅ `pnpm test` → exit 0 at `dce4c594`; the suites report 997, 90 and 462 tests, 0 failed, including the default key map conflict test per app. This includes the registry tests (conflicts, sequence prefixes, `when`, scope, group order), the commands tests for admin and app (every nav row has a command, no shortcut repeats), and the `update-deps` case for a 0.x minor bump.
- ❌ `pnpm deps:check` → exit 1, "91 outdated · 84 up-to-date". The two new pins, `@tanstack/react-hotkeys` 0.16.0 and `@leeoniya/ufuzzy` 1.0.19, are up to date. The acceptance check ran it on `main` at `53e9d332`: exit 1, "91 outdated · 82 up-to-date". The failure is drift on `main`, not this branch.
- ✅ `./saasaloy add command` in `.dev/playground` → writes the `commandExtension()` patch into both apps' `shell-extensions.ts` and both exact pins into `packages/ui/package.json`. The playground typecheck, lint, and the admin and app builds exit 0. This ran on the Phase 4 tree, which holds the same code as `5b2deb9f`.
- ✅ Commit `767ee3dc` holds only `scripts/update-deps.ts` and `scripts/update-deps.test.ts`.

### Browser checks
_Driven with `playwright-core` 1.64 headless Chromium (Linux, so keycaps read Ctrl) against `http://localhost:3001` and `http://localhost:3002` at `dce4c594`. Every check below ran again after the fix round and again after the review fixes. Screenshots in `/tmp/qakit/0080-qa-command-palette-2026-10-24/`._

Admin, at 1280 px and at 360 px unless one width is named:

- ✅ `/users` · header trigger at 1280 px → "Search commands… Ctrl K"; at 360 px an icon button with no text
- ✅ `/users` · Ctrl+K opens the palette → groups Users, Navigation, Actions, Preferences
- ✅ `/users` · "Current" marks the theme in use → "Theme: Dark Current"
- ✅ `/users` · "Theme: Dark" and "Theme: Light" from the palette → `html.dark` true, then false
- ✅ `/users` · fuzzy "usr" → "Go to Users G U"
- ✅ `/users` · no match → "No commands match “zzqxv” Try a page name, such as “overview”, or press ? for every shortcut."
- ✅ `/users` · Esc closes the palette → not visible
- ✅ `/users` · `?` opens the sheet → General, Navigation (Go to Overview G then O, Go to Users G then U) and Data table (J, K, ↵, Esc) sections
- ✅ `G` then `O` → `/`; `G` then `U` → `/users`
- ✅ `/users` · J highlights a row, J then K returns to it → the same row
- ✅ `/users` · Enter opens the detail panel, Esc closes it → close buttons 0 → 1 → 0
- ✅ `/users` at 360 px · Ctrl+K while the user detail sheet (a dialog) is open → the palette stays closed
- ✅ `/users` at 1280 px · Ctrl+B toggles the sidebar once per press → expanded → collapsed → expanded
- ✅ `/users` at 1280 px · `g`, `o`, `j` and `?` typed in a text field → the field reads "goj?"; no navigation, no highlight, no sheet
- ✅ `/users` at 1280 px · Ctrl+K inside a text field → the palette opens
- ✅ `/users` at 360 px · horizontal overflow → 0 px
- ✅ console errors → none

App, at 1280 px and at 360 px:

- ✅ `/` · header trigger at 1280 px → "Search commands… Ctrl K"; at 360 px an icon button
- ✅ `/` · Ctrl+K opens the palette → groups Navigation, Actions, Preferences
- ✅ `/` · "Current" → "Theme: Dark Current"; theme commands set `html.dark` true, then false
- ✅ `/` · fuzzy "thme" → Theme: Dark, Theme: Light, Theme: System
- ✅ `/` · no match → "No commands match “zzqxv” Try a page name, such as “home”, or press ? for every shortcut."
- ✅ `/` · Esc closes the palette; `?` opens the sheet with Go to Home G then H and Toggle sidebar Ctrl B
- ✅ `G` then `H` → `/`
- ✅ `/` at 360 px · horizontal overflow → 0 px; console errors → none

Fix round, admin `/users` at 1280 px:

- ✅ B3 · Actions group order → Toggle sidebar, Show keyboard shortcuts, Sign out
- ✅ B1 · empty copy → "Try a page name, such as “users”, or press ? for every shortcut."
- ✅ B2 · J, then focus the Overview link, then Enter → the highlight clears (1 → 0), the link goes to `/`, no detail opens
- ✅ B2 · from the page body, J then Enter opens the detail, Esc closes it → close buttons 1 → 0

Admin without the `command` module (the playground's admin `shell-extensions.ts` emptied for the check, then restored):

- ✅ `/users` · header has no trigger → 0
- ✅ `/users` · Ctrl+B toggles the sidebar once per press → expanded → collapsed → expanded
- ✅ `/users` · Ctrl+K opens nothing → 0 dialogs
- ✅ `/users` · `G` then `O` does not navigate → stays on `/users`
- ✅ `/users` · the users table renders → 4 rows; console errors → none

Design tokens, admin `/users` at 1280 px:

- ✅ palette popup background → `oklch(1 0 0)` in light and `oklch(0.242 0.013 258.37)` in dark, equal to `--popover`
- ✅ palette footer text → `--muted-foreground` in both themes

## Not covered / needs human judgment
- The visual match with the approved mockup. TC-1.1 and TC-2.1 cover it from screenshots.
- Motion and feel. TC-1.2 covers it.
- A real Mac. The headless browser runs on Linux, so every keycap reads Ctrl. TC-1.3 covers ⌘.
- The app without the `command` module had no browser run. The app's extension list is the same shape as admin's, and its typecheck and build pass without the module.
- Escape with focus on a control inside the docked detail panel (1280 px) does not close the panel; the focused control keeps the key. Escape from the page body closes it. Below 640 px the panel is a sheet and closes on Escape itself.
- Ctrl+K while the `?` sheet is open opens the palette. The engine skips the module's own overlays on purpose, so a user can move from the sheet to the palette. Ctrl+K stays blocked while any other dialog is open.
- A screen reader pass. The palette has the accessible name "Command palette" and the input "Search commands"; nobody listened to it.
- An automated keyboard e2e test. Issue #265 owns it, blocked on #187.
- Data and state, concurrency and performance. The change has no data layer and no server call of its own.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
