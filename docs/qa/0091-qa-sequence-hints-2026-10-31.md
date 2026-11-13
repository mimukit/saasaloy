# QA Plan: Sequence hints and shortcut discovery in the shell sidebar

_Generated 2026-10-31 · against `e0bafcc4` (clean) · covers issue #300: the `shell` sidebar key hints and the `command` engine state behind them_

## Summary

- The sidebar shows each row's key in its tooltip, and shows the next key of a `G` sequence after a 300 ms pause.
- Working means the hints follow the real sequence state, close on time, and never show without the `command` module.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-300-show-sequence-hints-and-shortcuts-in-the-sidebar`, in the worktree `~/worktrees/saasaloy/issue-300-show-sequence-hints-and-shortcuts-in-the-sidebar`.
- Target: the disposable `.dev/playground`, with `admin`, `app` and `database-d1`. `pnpm play:reset` rebuilds it.
- Admin: `http://localhost:3001`. App: `http://localhost:3002`. Api: `http://localhost:4000`.
- Account: `qa-admin@example.com` / `qa-password-300`. It is the first account, so it is the superadmin.
- Screenshots: local to this run at `e0bafcc4` and not committed. The names under each case match the labels in the gallery.

Build the playground with these commands, from the worktree root:

```sh
pnpm play:init
```

```sh
cd .dev/playground && ./saasaloy add admin --with database-d1 --yes && ./saasaloy add app --yes && ./saasaloy add command --yes && pnpm install
```

```sh
printf 'BETTER_AUTH_SECRET=%s\nBETTER_AUTH_URL=http://localhost:4000\nPUBLIC_SITE_URL=http://localhost:3000\nPUBLIC_API_URL=http://localhost:4000\nLOGGER_PROVIDER=console\n' "$(openssl rand -hex 32)" >> packages/env/.env && pnpm env:setup
```

```sh
(cd packages/db && pnpm db:generate) && pnpm db:setup
```

Start the three dev servers, each in its own terminal:

```sh
cd apps/api && pnpm dev
```

```sh
cd apps/admin && pnpm dev
```

```sh
cd apps/app && pnpm dev
```

Create the account:

```sh
curl -s -i -X POST http://localhost:4000/auth/sign-up/email -H 'Content-Type: application/json' -H 'Origin: http://localhost:3002' -d '{"email":"qa-admin@example.com","password":"qa-password-300","name":"QA Admin"}'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Admin signed in, `command` installed | The hints look like the approved reference | 🔴 Critical |
| TC-1.2 | 1: Admin signed in, `command` installed | The hints feel right to use | 🟡 Normal |

## Scenario 1: Admin signed in, `command` installed

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login` and sign in with the account above.

- [ ] Setup complete

### TC-1.1: The hints look like the approved reference  ·  🔴 Critical

**Goal.** The sidebar hints match the primeshopr reference at `23a113c` that the owner approved on 2026-10-31.

**Steps**

1. Open the gallery, and look at the open sidebar with `G` held past the pause.
   - [ ] The next keys on the Overview and Users rows, and the "Also" panel beside the footer, match the reference in light and dark
     - the next-key caps take the primary fill, in place of a row's count
     - the "Also" panel sits beside the footer, over the page, and covers no row
     - screenshots: `sidebar-hints-dark-1440` · `sidebar-hints-light-1440`
2. Look at the collapsed sidebar.
   - [ ] The next key sits on the icon corner, at a smaller size, and stays legible
     - screenshots: `sidebar-collapsed-hints-dark-1440`
3. Look at the row tooltips, open and collapsed.
   - [ ] Each tooltip reads as one label followed by its keycaps
     - screenshots: `tooltip-open-dark-1440` · `tooltip-collapsed-dark-1440`
4. Look at the account menu, with and without `command`.
   - [ ] The "Keyboard shortcuts" item sits between Theme and Sign out, with `?` at its right edge
     - screenshots: `account-menu-dark-1440` · `account-menu-no-command-dark-1440`
5. Look at the phone sheet and the app SPA.
   - [ ] The phone sheet shows no hint, and the app's Home row shows `H` the same way admin does
     - screenshots: `sidebar-sheet-dark-375` · `app-hints-dark-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The hints feel right to use  ·  🟡 Normal

**Goal.** A person who does not know the keys can read the hints in time, and a person who knows them is not slowed down.

**Steps**

1. Press `G`, read the hints, then press `U`.
   - [ ] 2.5 s gives enough time to read the hints and press the next key
2. Type `G` then `O` quickly, five times in a row.
   - [ ] No hint flashes, and each navigation feels instant
3. Press `G` by mistake, then click anywhere on the page.
   - [ ] The hints close with no surprise, and the next letter typed does nothing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
pnpm play:reset
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
node --import ./scripts/ts-resolve-hook.ts --test modules/shell/files/ui/lib/shell/shortcut-hints.test.ts
```

```sh
node --import ./scripts/ts-resolve-hook.ts --test modules/command/files/ui/lib/command/registry.test.ts
```

```sh
cd .dev/playground && pnpm typecheck
```

```sh
cd .dev/playground && pnpm --filter @repo/admin build && pnpm --filter @repo/app build
```

- ✅ `pnpm lint` at `e0bafcc4` → exit 0: both oxlint passes, Stylelint and `prettier --check` clean.
- ✅ `pnpm test` at `e0bafcc4` → exit 0: 1026, 91 and 533 `node:test` cases pass, plus 75 and 6 vitest files; the update-note parse test reads `command/0001-shortcut-hints-need-shell`.
- ✅ `sidebarHints` tests → 2 of 2 pass. Inverting the row check turns 1 red.
- ✅ `pendingShortcuts` tests → 3 of 3 pass in `registry.test.ts` (31 in the file). Dropping the `slice(1)` turns 1 red.
- ✅ Playground with `admin` and without `command` → `pnpm typecheck` exit 0 (10 tasks), `@repo/admin` build exit 0. Checked at `166ac6ba`.
- ✅ Playground with `admin`, `app` and `command` → `pnpm typecheck` exit 0 (11 tasks), `@repo/admin` and `@repo/app` builds exit 0.
- ✅ `curl` sign-up above → `200`, `"role":"superadmin"`.
- ℹ️ `pnpm build` in a fresh playground exits 1 in `@repo/web` prerender until `PUBLIC_SITE_URL` and `PUBLIC_API_URL` are set. This branch does not touch `apps/web`.

### Browser checks

_Driven with Playwright 1.63 (`chrome-headless-shell` 1247) against `http://localhost:3001` and `http://localhost:3002` at `e0bafcc4`. 10 screenshots, local to this run and not committed. A temporary global command "Go to New user" on `G N` was added to the playground's `app-shell.tsx` for the "Also" panel check, then restored._

- ✅ `/` · Users row tooltip, open sidebar → `UsersGU`
- ✅ `/` · `G` then `U` within 60 ms → no hint at 60 ms; URL `/users`
- ✅ `/users` · `J` then `Escape` → 1 highlighted row, then 0 (`Escape` still clears the highlight)
- ✅ `/users` · `G`, pause, `Escape` → 3 hints, then 0
- ✅ `/users` · `G`, pause, click Overview → 3 hints, URL `/`, then 0 hints
- ✅ `/` · `G` → 0 hints at 150 ms; at 500 ms Overview shows `O` and Users shows `U`
- ✅ `/` · "Also" panel → `Also` · `N` · `Go to New user`, and no row command in it
- ✅ `/` · `G`, pause, click the page, then `U` → 0 hints after the click; URL stays `/`
- ✅ `/` · `G`, pause, window `blur`, then `U` → 3 hints, then 0; URL stays `/`
- ✅ `/` · `G`, no next key → 3 hints at 2000 ms, 0 at 2900 ms
- ✅ `/` · `Ctrl+B`, then `G` and a pause → `data-collapsible="icon"`; Overview `O`, Users `U`
- ✅ `/` · Users row tooltip, collapsed sidebar → `UsersGU`
- ✅ `/` · account menu → item `Keyboard shortcuts?`; a click opens the sheet (General, Navigation)
- ✅ `/` at 375 px · `G` and a pause, sheet closed and sheet open → 0 hints both times
- ✅ `/` · console errors during the run → none
- ✅ app `/` · `G` and a pause → Home shows `H`
- ✅ `/` after `saasaloy remove command` → no `kbd` in the sidebar, tooltip `Users`, menu items `Theme` and `Sign out` only, no palette trigger

## Not covered / needs human judgment

- The visual match with the approved reference, in TC-1.1.
- The reading time and the feel of the sequence, in TC-1.2.
- A real window switch: the agent sent a synthetic `blur` event to `window`, which is the event the engine listens for.
- macOS keycaps: the run used Linux, so the caps read `Ctrl`. `chordKeycaps` tests already cover `⌘`.
- Security, data and performance: the change adds no request, no stored data, and no list that grows.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
