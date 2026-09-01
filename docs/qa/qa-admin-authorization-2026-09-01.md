# QA Plan: authorization for the admin app

_Generated 2026-09-01 · against `c81492a` · covers issue #97: the three route gate helpers in `@repo/auth/server`, the gated `GET /admin/users` route, the first-admin hook, and the corrected `better-auth@1.7.2` schema snapshot_

## Summary

- `@repo/auth/server` now exports `requireSession`, `requireRole` and `requireAdmin`. Each reads the session, asks `decide()` in `packages/auth/src/authorize.ts`, and throws a Hono `HTTPException` on a refusal. The api's `onError` renders that throw as `{ "error": { "code": ..., "message": ... } }`. `modules/admin` ships `GET /admin/users` as the first caller, registered by a `chained-route` patch. A `databaseHooks.user.create.before` hook promotes the first account on an empty `user` table to `admin`. The schema snapshot now names `better-auth@1.7.2` and carries the NOT NULL `account.issuer` column that version added.
- "Working" means the api refuses a non-admin itself, the first sign-up on a fresh project reaches the admin shell, `hc<AppType>` types the new route in `apps/admin`, and a project that already holds `account` rows can apply the `issuer` migration without losing them.

## Read this first: two cases live in the other plan

This plan does not repeat the runtime refusal or the first-admin path. Both are already written, with commands, in `docs/qa/qa-admin-app-module-2026-08-29.md` (the 08-29 plan), which this branch extended:

- **The 403 curl, the anonymous 401 and the admin 200** are TC-2.4 of the 08-29 plan. That case covers acceptance criterion 1 in full.
- **The first sign-up becoming the admin, the second staying a user, and the concurrent race** are Scenario 5 of the 08-29 plan, cases TC-5.1, TC-5.2 and TC-5.3. Those cover acceptance criterion 4 in full.

Run the 08-29 plan first. It needs a browser and it destroys its playground in Scenario 5. This plan starts from a fresh playground of its own, so the order costs nothing.

Everything in this plan runs in a terminal and an editor. No case here needs a browser.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- **Branch under test:** `issue-97-authorization-for-the-admin-app`, at commit `c81492a`.
- **Machine:** any box with the repo toolchain. Node 24.x, pnpm 11.
- **Working directory:** the repository root, unless a step says otherwise.
- **The playground is stale.** `.dev/playground` currently holds `logger`, `logger-console`, `api`, `database`, `database-d1`, `auth` and `admin`, installed but never migrated and never started. Scenario 1's setup resets it. Do not test against the tree as you found it.
- **The CLI runs from inside the playground.** `saasaloy add` reads `saasaloy.json` from the shell's working directory, and the repository root has none. The command also refuses without `--yes` in a non-interactive shell.
- **The api Worker serves `http://localhost:4000`.** Only Scenario 2 starts it.
- **Terms used in this plan:** *the playground* is `.dev/playground`. *The api Worker* is `apps/api` on `:4000`. *The gate* is the three `require*` helpers in `packages/auth/src/server.ts`. *The snapshot* is `packages/db/src/schema/auth.ts` in the playground, placed there from `modules/auth/files/db/schema/auth.ts`. *The 08-29 plan* is `docs/qa/qa-admin-app-module-2026-08-29.md`.

Confirm you are on the right commit.

```sh
git rev-parse --short HEAD
```

- [ ] Environment ready: the command prints `c81492a`

## Known failure you will meet, and must not report

`pnpm -C .dev/playground typecheck` exits 1 on two errors, both in `apps/api/src/index.ts`, both on a `createLogger(c.env)` call:

```
src/index.ts(120,33): error TS2345: Argument of type 'Bindings' is not assignable to parameter of type 'LoggerEnv'.
src/index.ts(146,48): error TS2345: Argument of type 'Bindings' is not assignable to parameter of type 'LoggerEnv'.
```

This branch touches no file under `modules/api` or `modules/logger`. A playground built with `api` alone reproduces the same pair. Treat those two lines as the floor: TC-1.1 asks you to confirm nothing else joins them. Turbo halts on the first failing task, so `apps/admin` and `apps/web` never run under the repository-wide command; every typecheck step in this plan runs `tsc` inside one workspace instead.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: a fresh playground, installed, not migrated | The scaffold lands the gate and adds no type error | 🔴 Critical |
| TC-1.2 | 1: a fresh playground, installed, not migrated | The developer is warned about the open first slot | 🟡 Normal |
| TC-1.3 | 1: a fresh playground, installed, not migrated | `hc<AppType>` types `GET /admin/users` in the admin app | 🟡 Normal |
| TC-2.1 | 2: a playground on the old schema, with account rows | The `account.issuer` migration keeps the existing rows | 🟡 Normal |
| TC-3.1 | 3: reading, no servers needed | The auth skill's gate table matches what ships | 🟡 Normal |
| TC-3.2 | 3: reading, no servers needed | The admin skill pairs the browser guard with the api gate | 🟡 Normal |

## Scenario 1: a fresh playground, installed, not migrated

**Setup.** Run once, for every case in this scenario.

1. Build a fresh project and install `admin` with everything it depends on.

```sh
pnpm play:reset
```

2. Add the module. The command runs inside the playground.

```sh
(cd .dev/playground && ./saasaloy add admin --yes)
```

3. Install the workspace dependencies.

```sh
pnpm -C .dev/playground install
```

- [ ] Setup complete: `add admin` reports the resolved chain `api → database → database-d1 → auth → admin` and applies its files, and the install exits 0

### TC-1.1: The scaffold lands the gate and adds no type error · 🔴 Critical

**Goal.** `saasaloy add admin` delivers every file the gate needs, wires the route into the chain `AppType` reads, and leaves the playground with the two pre-existing errors and nothing more.

**Steps**

1. Read the auth package's source directory.

```sh
ls .dev/playground/packages/auth/src
```

   - [ ] All five files are present: `auth.ts`, `authorize.ts`, `client.ts`, `env.ts`, `server.ts`
     - `authorize.ts` is the new one, and it is the file that holds the rule
     - a missing `authorize.ts` means the descriptor's `scaffolds[].files` list lost its entry, and `server.ts` will not resolve its import

2. Confirm the route file landed and the chain links it.

```sh
grep -n "adminUsers" .dev/playground/apps/api/src/index.ts .dev/playground/apps/api/src/routes/admin-users.ts
```

   - [ ] The import and the `.route("/admin", adminUsers)` link both appear in `index.ts`, and the link sits inside the `const app = base...` chain that `export type AppType = typeof app` reads
     - a link written as a separate `app.route(...)` statement compiles and still empties the route out of `AppType`
   - [ ] `admin-users.ts` exports `adminUsers` as one chained expression and calls `await requireAdmin(c.req.raw)` as the first line of the handler

3. Confirm the auth package declares the dependency its new import needs.

```sh
grep -n '"hono"' .dev/playground/packages/auth/package.json
```

   - [ ] The line reads `"hono": "4.13.5"`
     - `server.ts` imports `hono/http-exception`; an undeclared dependency resolves by accident through the workspace root and breaks on a real install

4. Typecheck the auth package on its own.

```sh
(cd .dev/playground/packages/auth && pnpm exec tsc --noEmit)
```

   - [ ] The command exits 0 and prints nothing
     - this is the package that gained `authorize.ts` and the rewritten `server.ts`, so a clean run here is what says the branch introduced no type error

5. Typecheck the admin app on its own.

```sh
(cd .dev/playground/apps/admin && pnpm exec tsc --noEmit)
```

   - [ ] The only errors printed are the two `createLogger(c.env)` errors in `../api/src/index.ts` described above
     - count them: exactly two, at lines 120 and 146
     - a third error is a real finding for this branch; write it into Notes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The developer is warned about the open first slot · 🟡 Normal

**Goal.** A developer who never reads the module source still learns that the first sign-up takes the admin role, and learns it where they configure the api.

**Steps**

1. Read the environment file the scaffold wrote.

```sh
grep -n -A 3 "BETTER_AUTH_URL" .dev/playground/apps/api/.dev.vars.example
```

   - [ ] The `FIRST USER WINS` sentence is there, and it names the recovery route
     - it says the first account on an empty `user` table gets role `admin`
     - it says sign-up is open once the origin is public
     - it points at `/saasaloy-auth` for the recovery SQL
   - [ ] Judge it as a developer reading this file for the first time: the warning tells you to act, and it tells you what the action is
     - a warning that only states the behaviour, with no instruction to claim the slot, is a fail

2. Read the same warning at its second and third homes.

```sh
grep -n "First user wins\|WARNING — sign-up is open" modules/auth/files/src/auth.ts
```

```sh
grep -n -A 6 "### First user wins" modules/auth/skills/saasaloy-auth/SKILL.md
```

   - [ ] All three wordings agree with each other and with the hook in `auth.ts`
     - none of them promises the race is prevented; the code accepts it and each text says so

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: `hc<AppType>` types `GET /admin/users` in the admin app · 🟡 Normal

**Goal.** The route reaches the admin app as a typed client method, not merely as a link in the chain. No shipped code calls it, so this case adds a caller, proves the type, and removes it again.

**Steps**

1. Open `.dev/playground/apps/admin/src/routes/index.tsx` in an editor. Add these two lines at the end of the file. `api` is the `hc<AppType>` client from `src/lib/api.ts`; import it if the file does not already.

```ts
const probe = await api.admin.users.$get();
const probeBody = await probe.json();
```

2. Hover `probeBody` in the editor.

   - [ ] The inferred type carries a `users` array and a `total` number
     - `any`, `unknown`, or an error on `api.admin` means the route never reached `AppType`

3. Typecheck the admin app.

```sh
(cd .dev/playground/apps/admin && pnpm exec tsc --noEmit)
```

   - [ ] The output holds the same two `../api/src/index.ts` errors and nothing about the two added lines

4. Break the call on purpose. Change `api.admin.users` to `api.admin.userz` and run the same command.

   - [ ] A third error appears, and it names `userz`
     - no new error means the client is untyped and step 2 proved nothing

5. Remove both added lines and the import if you added one. Run the typecheck once more.

   - [ ] The output is back to the two `../api/src/index.ts` errors

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Discard the edit to `index.tsx` if any of it survives. Scenario 2 rebuilds the playground from scratch, so nothing else needs undoing.

## Scenario 2: a playground on the old schema, with account rows

This scenario covers the one path the 08-29 plan lists as not covered: the `account.issuer` migration applied to a real D1 through `db:migrate:local`. The sequence in `modules/auth/skills/saasaloy-auth/SKILL.md` was measured against a standalone SQLite database on drizzle-kit 0.31.10. Nothing has run it against D1.

A fresh project never meets this. Its `account` table is empty when the migration lands, and the generated SQL applies as emitted. The case exists for the project that installed `auth` before this branch.

**Setup.** Run once, for every case in this scenario.

1. Build a fresh playground with `auth`.

```sh
pnpm play:reset
```

```sh
(cd .dev/playground && ./saasaloy add admin --yes)
```

```sh
pnpm -C .dev/playground install
```

2. Put the pre-1.7.2 snapshot in place, so the database starts on the old shape.

```sh
git show main:modules/auth/files/db/schema/auth.ts > .dev/playground/packages/db/src/schema/auth.ts
```

3. Give the api its dev origin.

```sh
printf 'BETTER_AUTH_URL=http://localhost:4000\n' >> .dev/playground/apps/api/.dev.vars
```

4. Create the old tables.

```sh
pnpm -C .dev/playground --filter @repo/db db:generate && pnpm -C .dev/playground --filter @repo/db db:migrate:local
```

5. Start the api Worker in its own terminal. Leave it running.

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

6. Write one credential account by signing up.

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H "Origin: http://localhost:3001" -H "Content-Type: application/json" -X POST http://localhost:4000/auth/sign-up/email -d '{"email":"upgrade@example.com","password":"Password123!","name":"Upgrade"}'
```

7. Write one social account by hand, because an OAuth round trip needs a provider this plan does not set up. The four columns below are every NOT NULL column the old `account` table has without a default.

```sh
pnpm -C .dev/playground --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "insert into account (id, account_id, provider_id, user_id) select 'acct-gh', 'gh-42', 'github', id from user limit 1"
```

8. Stop the api Worker with Ctrl-C.

- [ ] Setup complete: the sign-up printed `200`, and the `select` below returns two rows, one with `provider_id` `credential` and one with `github`

```sh
pnpm -C .dev/playground --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select id, provider_id from account"
```

### TC-2.1: The `account.issuer` migration keeps the existing rows · 🟡 Normal

**Goal.** The procedure the auth skill publishes upgrades a populated `account` table on a real D1, fills both rows with the values better-auth would have written, and leaves drizzle-kit reporting no drift.

**Steps**

1. Restore this branch's snapshot and generate the migration.

```sh
git checkout HEAD -- modules/auth/files/db/schema/auth.ts && cp modules/auth/files/db/schema/auth.ts .dev/playground/packages/db/src/schema/auth.ts && pnpm -C .dev/playground --filter @repo/db db:generate
```

   - [ ] drizzle-kit writes a new file under `.dev/playground/packages/db/migrations/`

2. Read the emitted SQL. Open the newest file in that directory.

   - [ ] It holds exactly these two statements for `account`, and they match what the skill quotes

```sql
ALTER TABLE `account` ADD `issuer` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_account_id_uidx` ON `account` (`issuer`,`account_id`);
```

3. Apply it unedited, to see the failure the skill warns about. The command must fail.

```sh
pnpm -C .dev/playground --filter @repo/db db:migrate:local
```

   - [ ] The command exits non-zero and the error reads `Cannot add a NOT NULL column with default value NULL`
     - a success here means D1 accepts what standalone SQLite refuses, and the skill's whole procedure is unnecessary; record that, it is a finding either way

4. Edit the emitted migration to the three statements the skill publishes. Replace the two statements from step 2 with these.

```sql
ALTER TABLE `account` ADD `issuer` text DEFAULT 'local:credential' NOT NULL;--> statement-breakpoint
UPDATE `account` SET `issuer` = 'local:oauth:' || `provider_id` WHERE `provider_id` != 'credential';--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_account_id_uidx` ON `account` (`issuer`,`account_id`);
```

5. Apply the edited migration.

```sh
pnpm -C .dev/playground --filter @repo/db db:migrate:local
```

   - [ ] The command exits 0
     - a partial apply leaves the table half-migrated; if it fails here, say which statement it stopped on

6. Read the two rows back.

```sh
pnpm -C .dev/playground --filter @repo/db exec wrangler d1 execute DB --local --config ../../apps/api/wrangler.jsonc --persist-to ../../apps/api/.wrangler/state --command "select id, provider_id, issuer from account"
```

   - [ ] Both rows survived and both carry the right `issuer`
     - the credential row reads `local:credential`
     - the `github` row reads `local:oauth:github`
     - a lost row means the migration recreated the table instead of altering it

7. Confirm the hand edit does not read back as drift.

```sh
pnpm -C .dev/playground --filter @repo/db db:generate
```

   - [ ] The output says there is nothing to migrate
     - a new migration file here means the `DEFAULT` clause leaked into the diff, and every later `db:generate` on a real project would fight it

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the api Worker if it is still running. Confirm `git status --short` is clean in the repository; step 1 checked out a tracked file, and nothing in this scenario should have changed the repository itself. The playground is now a scratch project, so run `pnpm play:destroy` when you finish.

## Scenario 3: reading, no servers needed

An agent confirmed these documents exist and name what they claim to name. A human judges whether an author who follows them writes working code.

**Setup.** Run once, for every case in this scenario.

1. Open `modules/auth/skills/saasaloy-auth/SKILL.md`, `modules/admin/skills/saasaloy-admin/SKILL.md`, `modules/auth/files/src/server.ts` and `modules/auth/files/src/authorize.ts` in an editor.

- [ ] Setup complete

### TC-3.1: The auth skill's gate table matches what ships · 🟡 Normal

**Goal.** An author who picks a helper from the skill's table gets the behaviour the table promises, and the skill's narrower-than-better-auth role rule is stated where it will be read.

**Steps**

1. Read the four-row table under "Protect a route" against `server.ts` and `authorize.ts`.
   - [ ] Every row is true of the code
     - `getSession` returns the session or `null` and throws nothing
     - `requireSession` throws 401 with the message `sign in first`
     - `requireRole` throws 401 when signed out, then 403 with `role required: <role>`
     - `requireAdmin` is `requireRole(request, ADMIN_ROLE)` and nothing else
   - [ ] The worked example under the table compiles as written, and it names no file, export or field that does not exist

2. Read the paragraph on the one-role contract.
   - [ ] It states the divergence and where both halves live
     - better-auth's plugin splits `user.role` on `,`, so `"admin,support"` is an admin to `auth.api.listUsers`
     - `hasRole` in `packages/auth/src/authorize.ts` compares with `===`, so the same string gets a 403
     - it names the second half, `isAdmin` in `apps/admin/src/lib/auth.ts`, and says to change both together
   - [ ] Judge whether an author would understand the divergence fails closed rather than open

3. Read the "Auth schema" section's paragraph about the version guard.
   - [ ] It says what the guard does check and what it cannot
     - it fails `pnpm test` on a header and `package.json` disagreement
     - it cannot check a column, and the text says so rather than implying coverage it has not got

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: The admin skill pairs the browser guard with the api gate · 🟡 Normal

**Goal.** An author adding an admin screen learns that the screen's guard is not authorization, and gets both halves of the pattern in one place.

**Steps**

1. Read the section "This guard is the second half of the gate".
   - [ ] The two code blocks show the api route and the screen, and the prose says why the screen needs no guard of its own
     - the screen inherits `beforeLoad` from `__root.tsx`
     - that inheritance is named as the reason a missing server check looks correct in a browser
   - [ ] The `curl` it publishes is runnable as written, with a real URL and no placeholder to guess at
   - [ ] Judge the claim it makes about a `200`: an author reading this knows a `200` from that call is the defect, whatever the browser shows

2. Read the paragraph on the first admin in the same skill.
   - [ ] It agrees with the auth skill and with the hook: the first sign-up becomes the admin, every account after it keeps `"user"`, and the recovery SQL lives in the auth skill
     - the older claim "Nothing promotes the first admin" must be gone; it is now false

3. Read the "Boundaries to honor" list.
   - [ ] The rule about `requireAdmin` on every admin endpoint is there and reads as a rule, not a suggestion

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself, at commit `c81492a`, on 2026-09-01. No action needed from the tester; listed here for context and sign-off. The results are transcribed from the run record in `.afkkit/verified.md`, which holds the full output._

The repository gate, all four commands executed:

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
pnpm build
```

The helpers and their tests:

```sh
grep -n "export async function require" modules/auth/files/src/server.ts
```

```sh
pnpm test:modules
```

The scaffolded playground:

```sh
pnpm play:reset
```

```sh
(cd .dev/playground && ./saasaloy add admin --yes)
```

```sh
grep -n "adminUsers" .dev/playground/apps/api/src/index.ts
```

```sh
(cd .dev/playground/packages/auth && pnpm exec tsc --noEmit)
```

The documentation and the snapshot:

```sh
grep -rn "first sign-up\|first user\|FIRST USER WINS\|first account" modules/auth/files/src/auth.ts modules/auth/registry-item.json modules/auth/skills/saasaloy-auth/SKILL.md
```

```sh
grep -n "better-auth@" modules/auth/files/db/schema/auth.ts
```

```sh
grep -n "admin/users\|403\|first sign-up\|simultaneous" docs/qa/qa-admin-app-module-2026-08-29.md
```

Results:

- ✅ `pnpm lint` → exits 0. Four passes: `oxlint --type-aware`, `oxlint` plain, Stylelint, then "All matched files use Prettier code style!". One violation surfaced during the fix round, `unicorn(no-useless-undefined)` on `decide(undefined)` in `server.test.ts:136`, and it carries a one-line `oxlint-disable-next-line` with its reason. `--fix-suggestions` was never run.
- ✅ `pnpm test` → exits 0. 63 tests, 12 suites, 0 fail, up from 37 at the branch point.
- ✅ `pnpm typecheck` → exits 0.
- ✅ `pnpm build` → exits 0. `packages/cli/dist/index.js`, 159.90 KB.
- ✅ The three helpers ship → `requireSession` at line 40, `requireRole` at 60, `requireAdmin` at 69 of `modules/auth/files/src/server.ts`. `getSession` stays exported beside them.
- ✅ The gate rule is executed under test → the rule lives in `decide()` in `authorize.ts`, and each helper is three lines around it. Proven by mutation against copies in `/tmp`, never the repository: inverting `if (!session)` fails 6 assertions, inverting the role check fails 5, and hand-writing an extra `if` into `server.ts` fails the wiring test with "server.ts must branch on nothing but decide()'s answer".
- ✅ The route is registered and typed → `.dev/playground/apps/api/src/index.ts` line 1 imports `adminUsers`, and line 156 reads `const app = base.route("/health", health).route("/admin", adminUsers);`, inside the chain `export type AppType = typeof app` reads.
- ✅ `packages/auth` typechecks clean on its own in the playground, so the new `authorize.ts` and the rewritten `server.ts` add no type error.
- ✅ The open-signup warning is in all three places → a comment block above `databaseHooks` in `auth.ts` lines 67-82; the `envVars.BETTER_AUTH_URL` value in `modules/auth/registry-item.json` line 9, which reaches the scaffolded `apps/api/.dev.vars.example` line 12; and `modules/auth/skills/saasaloy-auth/SKILL.md` line 184. The recovery SQL survives at lines 203 and 208.
- ✅ The snapshot names `better-auth@1.7.2` and no longer names `1.6.25`. The re-verification record is in commit `db591a9`: `npm pack` of the three packages at 1.7.2, `getAuthTables({ plugins: [admin()] })` diffed across versions, then `generateDrizzleSchema({ provider: "sqlite" })`. One column moved, `account.issuer`, NOT NULL, with a unique index over (`issuer`, `accountId`) replacing the one over (`providerId`, `accountId`).
- ✅ A version mismatch fails the suite → editing the header to `better-auth@9.9.9` in a copied tree makes `schema-version.test.ts` exit 1 with "the snapshot says it was verified against better-auth@9.9.9, but package.json pins 1.7.2". Restoring the header makes it pass. The repository copy was never edited.
- ✅ The 08-29 plan carries the new scenarios → TC-2.4 at line 298, TC-5.1 at 541, TC-5.2 at 615, TC-5.3 at 628, each with tick boxes in that file's style.
- ✅ The `account.issuer` migration sequence was measured, not reasoned → run in a scratch project pinned to drizzle-kit 0.31.10 and drizzle-orm 0.45.2. The generated `ALTER` fails on a populated table with "Cannot add a NOT NULL column with default value NULL"; a hand backfill first fails with "duplicate column name: issuer"; the published three-statement edit applies cleanly to both a populated and an empty table, and a later `db:generate` reports no drift. This ran against standalone SQLite, never a real D1, which is why TC-2.1 exists.
- ❌ `pnpm -C .dev/playground typecheck` → exits 1 on the two `createLogger(c.env)` errors at `apps/api/src/index.ts` lines 120 and 146. **Pre-existing, not from this branch.** `Bindings` in `modules/api/files/src/index.ts` declares no index signature; `LoggerEnv` in `modules/logger/files/src/provider.ts` requires `[key: string]: unknown`. `git diff --stat main...HEAD` shows this branch touches no file under `modules/api` or `modules/logger`, and a playground built with `add api` alone reproduces the identical pair. Acceptance criterion 3's last clause is therefore unmet from repository state; the rest of the criterion passes.
- ❌ `pnpm deps:check` → exits 1 with 12 outdated items. None of them names `hono`, so the new `hono: 4.13.5` pin raises no violation. All 12 sit in files this branch never touched: astro, `@astrojs/react`, shadcn, `@cloudflare/workers-types` across seven descriptors, and `@hono/zod-validator` twice.
- ❌ `pnpm verify:preset` → exits 1 on a DESIGN.md fingerprint mismatch. Unrelated to this branch and cleared before the run.

## Not covered / needs human judgment

- **The runtime refusal.** No `curl` in this plan reaches `GET /admin/users` on a running Worker. TC-2.4 of the 08-29 plan is the only place a real 403, a real 401 and a real 200 are observed.
- **The first-admin hook running.** `noUsersYet()` and the `create.before` hook were read, never executed. Scenario 5 of the 08-29 plan is the only place they run.
- **`requireSession` and `requireRole` at runtime.** `GET /admin/users` calls `requireAdmin`, so it is the only helper any request reaches. The other two are covered by `decide` under test and by inspection, not by execution.
- **The three-line helper bodies.** No test imports `server.ts`, because it pulls `hono` and `better-auth` and resolves only inside a scaffolded project. The rule they apply runs under test through `decide`; the wiring around it does not.
- **The concurrent race under real load.** TC-5.3 of the 08-29 plan fires two sign-ups from one shell on one machine. It records a count; it does not bound the window on a deployed Worker where the two requests may land on different isolates.
- **The migration against remote D1.** TC-2.1 runs `db:migrate:local`. `db:migrate:prod` against a real Cloudflare D1 is untested, and a remote apply has no local rollback.
- **A social account written by a real OAuth round trip.** Scenario 2's setup inserts the `github` row with SQL, because setting up a provider is out of scope. The `issuer` value the migration computes is checked; the value better-auth itself would write on a genuine link is not.
- **The schema snapshot column by column.** The 1.7.2 re-verification is accepted from commit `db591a9`'s record. No case here re-runs `getAuthTables` or `generateDrizzleSchema`.
- **The codemod's output formatting.** The playground's `apps/api/src/index.ts` line 1 reads `import {adminUsers} from "./routes/admin-users";` with no spaces inside the braces. A scaffolded project is not Prettier-checked by this repository's gate. Whether other `chained-route` patches produce the same spacing is unknown.
- **Accessibility, dark mode, responsive layout and performance.** This branch ships no UI. Every screen it touches belongs to `apps/admin`, which the 08-29 plan covers, and that plan lists the same four as not covered there.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
