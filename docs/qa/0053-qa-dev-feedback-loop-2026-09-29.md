# QA Plan: live module sync and playground baseline reset

_Generated 2026-09-29 · against `6702a53` plus the uncommitted #178 change · covers `play:watch` module sync, `play:snap`, `play:restore`, `play:restore --db`, and the `saasaloy init` nesting guard_

## Summary
- `pnpm play:watch` re-applies an installed module when you save one of its files, and `pnpm play:restore` returns the playground to a git baseline.
- Working means a module edit reaches the running app in about a second, and a restore takes seconds with no fresh install.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-178-shorten-the-module-and-ui-test-loop`.
- You need a browser. On devaloy, forward the ports to your laptop with the command below.
- Admin app: `http://localhost:3001`. Api: `http://localhost:4000`.

```sh
ssh -L 3001:localhost:3001 -L 4000:localhost:4000 devaloy
```

Install the repo and build a fresh playground:

```sh
pnpm install && pnpm play:reset
```

Add the modules this plan uses, then install:

```sh
cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add auth --yes && ./saasaloy add admin --yes && pnpm install && pnpm -C packages/db db:generate && pnpm -C packages/db db:migrate:local
```

Write the api env file. Git ignores it, so every restore keeps it:

```sh
printf 'BETTER_AUTH_SECRET=%s\nBETTER_AUTH_URL=http://localhost:4000\nCORS_ORIGINS=http://localhost:3001\nLOGGER_PROVIDER=console\nLOG_LEVEL=info\nPUBLIC_API_URL=http://localhost:4000\n' "$(openssl rand -hex 32)" > .dev/playground/apps/api/.dev.vars
```

Commit this state as the baseline, from the repo root:

```sh
pnpm play:snap
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Admin app and watcher running | An admin component edit shows in the browser | 🔴 Critical |
| TC-1.2 | 1: Admin app and watcher running | A playground edit is kept, not overwritten | 🔴 Critical |
| TC-1.3 | 1: Admin app and watcher running | Descriptor, uninstalled module and template edits | 🟡 Normal |
| TC-2.1 | 2: Baseline with a signed-up user and a running api | A restore removes a session of work | 🔴 Critical |
| TC-2.2 | 2: Baseline with a signed-up user and a running api | A restore with `--db` empties the database and restarts the api | 🔴 Critical |

## Scenario 1: Admin app and watcher running

**Setup.** Run once, for every case in this scenario. Use three terminals.

1. In terminal 1, start the api.

```sh
cd .dev/playground/apps/api && pnpm dev
```

2. In terminal 2, start the admin app.

```sh
cd .dev/playground/apps/admin && pnpm dev
```

3. In terminal 3, from the repo root, start the watcher.

```sh
pnpm play:watch
```

4. Open `http://localhost:3001` in the browser. Sign up or sign in when the admin app asks.

- [ ] Setup complete

### TC-1.1: An admin component edit shows in the browser  ·  🔴 Critical

**Goal.** A saved edit under `modules/admin/files/` reaches the running admin app with no manual `add`.

**Steps**

1. Open `modules/admin/files/src/components/page-header.tsx`. Change one visible heading class or text. Save the file.
   - [ ] Terminal 3 prints `[sync] admin: 1 file(s) written` within about a second, with the `wrote` line for `apps/admin/src/components/page-header.tsx`
2. Look at the admin app in the browser. Do not reload.
   - [ ] The page shows the change
3. Undo the edit in `modules/admin/files/`. Save the file.
   - [ ] Terminal 3 prints a second sync, and the browser shows the old heading again
4. Run doctor in the playground.

   ```sh
   cd .dev/playground && ./saasaloy doctor
   ```

   - [ ] Doctor ends with `No problems found.`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A playground edit is kept, not overwritten  ·  🔴 Critical

**Goal.** The watcher never overwrites a file you changed in the playground, and it tells you which file it kept.

**Steps**

1. Add the line `// local edit` at the end of `.dev/playground/apps/admin/src/components/rail.tsx`. Save the file.
   - [ ] Terminal 3 prints nothing, because the watcher watches `modules/` only
2. Add the line `// module edit` at the end of `modules/admin/files/src/components/rail.tsx`. Save the file.
   - [ ] Terminal 3 prints `kept   apps/admin/src/components/rail.tsx` under "held back as drift"
     - `apps/admin/src/routeTree.gen.ts` can also show as `kept`. The admin dev server rewrites that file, so this is correct.
   - [ ] The playground file still ends with `// local edit`, and it does not contain `// module edit`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: Descriptor, uninstalled module and template edits  ·  🟡 Normal

**Goal.** The watcher reacts correctly to the three other kinds of change and says what it did.

**Steps**

1. In `modules/admin/registry-item.json`, add one space after the `"type":` colon. Save the file.
   - [ ] Terminal 3 prints one sync for `admin`, then the warning that a removed patch or file is not reversed and that `pnpm play:restore` clears it
2. Add a blank line at the end of `modules/billing/files/package.json`. Save the file.
   - [ ] Terminal 3 prints `billing: not installed in the playground, skipped`
3. Add a blank line at the end of `packages/cli/templates/base/README.md`. Save the file.
   - [ ] Terminal 3 prints that the template changed, that the re-scaffold is skipped because modules are installed, and that `pnpm play:reset` picks it up
   - [ ] The admin app in the browser still works, so the watcher did not reset the playground
4. Save the same module file three times in under a second.
   - [ ] Terminal 3 prints one sync for those saves, not three

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2. Stop the watcher and both dev servers with Ctrl-C first.

```sh
git checkout -- modules packages/cli/templates
```

```sh
pnpm play:restore
```

## Scenario 2: Baseline with a signed-up user and a running api

**Setup.** Run once, for every case in this scenario.

1. In terminal 1, start the api.

```sh
cd .dev/playground/apps/api && pnpm dev
```

2. In another terminal, sign up one user.

```sh
curl -s -X POST http://localhost:4000/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3001' -d '{"email":"qa@example.test","password":"password1234","name":"QA"}' -w '\n%{http_code}\n'
```

- [ ] Setup complete, and the sign-up returned `200`

### TC-2.1: A restore removes a session of work  ·  🔴 Critical

**Goal.** `play:restore` returns the files to the baseline in seconds and keeps `node_modules` and the env file.

**Steps**

1. Add a module, and edit one playground file by hand.

   ```sh
   cd .dev/playground && ./saasaloy add waitlist --yes && echo '// scratch' >> apps/admin/src/main.tsx
   ```

2. Look at the change set in the playground.

   ```sh
   cd .dev/playground && git status --short
   ```

   - [ ] The list shows the waitlist files, `saasaloy.json` and `apps/admin/src/main.tsx`, and nothing you did not cause
3. Restore from the repo root.

   ```sh
   pnpm play:restore
   ```

   - [ ] The command ends with `[play] restored in` and a time of a few seconds, and it does not download packages
4. Check the playground again.

   ```sh
   cd .dev/playground && git status --short && ls apps/api/.dev.vars && grep -c scratch apps/admin/src/main.tsx
   ```

   - [ ] `git status` prints nothing, `.dev.vars` still exists, and the scratch count is `0`
   - [ ] The api in terminal 1 still answers `http://localhost:4000/health`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A restore with `--db` empties the database and restarts the api  ·  🔴 Critical

**Goal.** `play:restore --db` stops the api you started, wipes the D1 database, migrates it, and starts the api again.

**Steps**

1. Try the same sign-up again.

   ```sh
   curl -s -X POST http://localhost:4000/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3001' -d '{"email":"qa@example.test","password":"password1234","name":"QA"}' -w '\n%{http_code}\n'
   ```

   - [ ] The status is `422`, because the user exists
2. Restore with the database, from the repo root.

   ```sh
   pnpm play:restore --db
   ```

   - [ ] Terminal 1 shows that its api stopped
   - [ ] The command prints `stopped the api`, `wiped and migrated the d1 database`, `api up on :4000`, and a total time under about 20s
3. Repeat the sign-up from step 1.
   - [ ] The status is `200`, because the database is empty
4. Stop the background api that the restore started.

   ```sh
   kill $(ss -ltnpH 'sport = :4000' | grep -o 'pid=[0-9]*' | cut -d= -f2)
   ```

   - [ ] `.dev/api-dev.log` holds the api output

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. This removes the playground.

```sh
pnpm play:destroy
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
pnpm build
```

```sh
pnpm verify:content
```

```sh
node --test scripts/watch-template.test.ts scripts/playground.test.ts
```

```sh
cd .dev/playground && ./saasaloy doctor
```

```sh
curl -s -X POST localhost:4000/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:5173' -d '{"email":"a@example.test","password":"password1234","name":"A"}' -o /dev/null -w '%{http_code}\n'
```

```sh
curl -s http://localhost:3001/src/components/access-denied.tsx | grep -c LIVE_SYNC_PROBE
```

- ✅ `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm verify:content` → all exit 0.
- ✅ `pnpm test` → 1328 CLI tests, 547 module tests and 185 script tests pass, including 14 watcher tests, 11 playground tests and 3 new `initGitRepo` tests.
- ✅ `pnpm play:reset` → `saasaloy init` prints "Initialized a git repository", and `play:init` commits a baseline. The outer repository shows no change.
- ✅ Watcher, one admin component edit → one sync in 0.6s, Vite logs an HMR update, and the served module contains the probe. After the revert, the probe is gone.
- ✅ Watcher, a playground edit plus a module edit on `apps/admin/src/main.tsx` → the file is listed as `kept` and is not overwritten.
- ✅ Watcher, `registry-item.json` edit → sync plus the removed-patch warning. Billing edit → skipped as not installed. Template edit with 7 modules installed → skipped with the `play:reset` warning.
- ✅ `saasaloy doctor` after a sync → `No problems found.`
- ✅ `pnpm play:restore` after five `add` runs and an install → restored in 0.9s, `git status` clean, `node_modules` kept.
- ✅ `pnpm play:restore --db` on D1 with a running api → sign-up returns 422 before and 200 after, total 14.2s. Only the api process tree stopped; a workerd from another worktree kept running.
- ✅ `pnpm play:restore --db` on Postgres 17 in a local container at `127.0.0.1:55432` → the `public` and `drizzle` schemas are dropped, the migration applies, sign-up returns 422 before and 200 after, total 12.3s.

## Not covered / needs human judgment
- Postgres in this plan. The agent tested it once with a throwaway container. #187 adds the Compose container that a tester would use.
- Seeds. `play:restore --db` leaves an empty database until #187 adds `seed.ts` files.
- macOS and Windows. The api stop uses `ss`, with `lsof` as the fallback. `pgrep` finds the child processes. No test ran off Linux.
- The web app. `astro dev` does not start on the base template yet (#186), so no case uses it.
- A module file that `add` does not copy. The watcher re-runs `add`, and `add` reports every file as unchanged. No case checks this.
- Database rows. The change adds no table and no migration, so there is no schema check.
- Accessibility, compatibility and UX of the apps. The change adds no UI.

## Overall result
_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
