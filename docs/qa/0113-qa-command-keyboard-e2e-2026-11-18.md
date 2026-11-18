# QA Plan: keyboard e2e flow for the command palette and shortcuts

_Generated 2026-11-18 · against `37e69f35` (clean) · covers issue #265: `command-keyboard.spec.ts`, the `command` tag, `SEED_MEMBER`, and the two skill updates_

## Summary
- The `command` module ships a Playwright spec that drives the palette, the `G` sequences, the `?` sheet and the admin users table with the keyboard only.
- Working means the spec passes on the seeded full-preset playground, and it fails when a nav row, a sheet line or a table key stops working.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-265-cover-the-command-palette-and-shortcuts-in-admin` at `37e69f35`.
- Base URLs: web `http://localhost:3000`, admin `http://localhost:3001`, app `http://localhost:3002`, api `http://localhost:4000`.
- Accounts: `superadmin@example.test` (admin half) and `member@example.test` (app half), both with the password `saasaloy-dev-password`.
- The playground pins these ports. Make sure that no other worktree holds them before you start.
- Screenshots: none. The change adds a test and changes no screen.

Launch with:

```sh
pnpm play:up
```

```sh
pnpm -C .dev/playground e2e:install
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Full-preset playground, servers running | The spec failure messages tell a developer what broke | 🟡 Normal |

## Scenario 1: Full-preset playground, servers running

**Setup.** Run once, for every case in this scenario.

1. Start the playground with the launch commands in Environment.

- [ ] Setup complete

### TC-1.1: The spec failure messages tell a developer what broke  ·  🟡 Normal

**Goal.** A developer who breaks a key binding can find the cause from the spec output alone.

**Steps**

1. Open `.dev/playground/packages/ui/src/blocks/command/shortcut-help.tsx`. Remove one line from the sheet, for example filter out the entry with the title "Go to Members".
2. Run the spec.

   ```sh
   pnpm -C .dev/playground/packages/e2e exec playwright test specs/command-keyboard.spec.ts
   ```

   - [ ] The failure names the missing line and the reason, and you can find the cause without the trace
     - the agent saw `Error: the ? sheet does not list "Go to Members"`
3. Undo the edit and run the spec again.
   - [ ] Both tests pass again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
pnpm play:down
```

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
node --test scripts/e2e-tags.test.ts
```

```sh
pnpm play:up
```

```sh
pnpm -C .dev/playground e2e
```

```sh
pnpm -C .dev/playground/packages/e2e exec playwright test specs/command-keyboard.spec.ts
```

- ✅ `pnpm lint` at `37e69f35` → exit 0 (oxlint, Stylelint and Prettier all clean).
- ✅ `pnpm typecheck` → exit 0.
- ✅ `pnpm test` → exit 0, 901 node tests pass, 0 fail.
- ✅ `node --test scripts/e2e-tags.test.ts` at `37e69f35` → 4 pass, 0 fail. `command` is in `SPEC_TAGS`, and the new spec uses only declared tags (C6).
- ✅ `pnpm play:up` → the full preset scaffolds, migrates and seeds, and `packages/e2e/specs/command-keyboard.spec.ts` lands from the `command` descriptor's `when: installed e2e` row.
- ✅ `pnpm -C .dev/playground e2e` at `37e69f35` → `command keyboard in admin` passes in 9.9 s and `command keyboard in app` passes in 2.7 s (C1 to C6).
- ❌ `pnpm -C .dev/playground e2e` at `37e69f35` → exit 1 from two specs that this branch does not touch: `auth-phone-journey.spec.ts` (`No code for +12025557228 reached packages/e2e/logs/api.log ... a reused api writes no log`) and `waitlist.spec.ts` (`The waitlist form is not on the landing page`). Both come from the playground setup. `play:up` starts the api without the log tee, and the full preset does not place the waitlist form.

### Browser checks
_Driven by the spec itself with Playwright Chromium against the playground at `37e69f35`. 0 screenshots, because no screen changed._

- ✅ admin and app · Mod+K opens the "Command palette" dialog, and Mod+K again closes it (C1).
- ✅ admin and app · every sidebar row is reached through its "Go to" palette row, and the URL matches the row's href (C2).
- ✅ admin and app · every row with a `G` sequence in the `?` sheet is reached through that sequence, and each app has at least one such row (C3).
- ✅ admin `/users` and app home · every palette row with keycaps is in the `?` sheet with the same keycaps, the General section lists the palette, sheet and sidebar keys, and admin `/users` lists four Data table keys (C4).
- ✅ admin `/users` · J highlights row 0, J moves to row 1, K moves back to row 0, Enter opens the detail panel of `admin@example.test`, Escape closes it (C5).
- ✅ break test · with "Go to Members" removed from the sheet in the playground, the admin test fails with `the ? sheet does not list "Go to Members"`. The edit was reverted.
- ✅ break test · with the table's Enter command made a no-op in the playground, the admin test fails at the detail panel `toBeVisible`. The edit was reverted, and the spec passes again.

## Not covered / needs human judgment
- macOS keycaps (`⌘ K`). The spec compares keycaps as text and presses `ControlOrMeta`, but the run used Linux Chromium only.
- The spec on a project with only admin or only app. The tags gate each half, but no single-app project was scaffolded.
- The postgres driver. The run used the default d1 driver.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
