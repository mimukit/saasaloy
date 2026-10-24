# QA Plan: User-owned API keys and the api-keys owner split

_Generated 2026-10-22 · against `4a6b615` (clean tree), with the A1 and B2 fixes rechecked on the next commit · covers #229: the `api-keys` core, `api-keys-organization`, `api-keys-user`, and the CLI `requiresOneOf` fixes in `update`, `add` and `doctor`_

## Summary
- A project with no organizations installs `api-keys-user`, and a user issues scoped keys that a route reads through `requireCaller` and `requireScope`.
- "Working" means user mode passes on D1 and Postgres, organization mode is unchanged, and an old `api-keys` project moves to `api-keys-organization` with no lost file.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-229-let-a-user-own-an-api-key-with-no-organization` at `4a6b615`.
- Every `saasaloy` run uses this checkout's CLI and `modules/` folder. Every project is under `.dev/`.
- The API base URL is `http://localhost:4000`. Better Auth answers under `/auth/*`.
- The agent left the test projects from its run under `.dev/`: `qa229-user-d1`, `qa229-user-pg`, `qa229-old`, `qa229-old-control`, `qa229-org-d1`, `qa229-pick`.

Set the repo path and build the CLI:

```sh
export REPO=/home/dev/worktrees/saasaloy/issue-229-let-a-user-own-an-api-key-with-no-organization && cd $REPO && pnpm --filter saasaloy build
```

Point the CLI at this checkout:

```sh
export CLI=$REPO/packages/cli/dist/index.js && export SAASALOY_REGISTRY_DIR=$REPO/modules && export B=http://localhost:4000
```

Set the database client once, for the D1 project. Run it from `apps/api` of that project. Every query below runs through it.

```sh
export DB_CMD='pnpm exec wrangler d1 execute DB --local --persist-to .wrangler/state --command'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh D1 project with `api-keys-user` | An agent wires a route from the skill alone | 🔴 Critical |
| TC-1.2 | 1: Fresh D1 project with `api-keys-user` | The owner prompt and the conflict message read clearly | 🟡 Normal |
| TC-2.1 | 2: Old `api-keys` project | The move instructions are clear to a project owner | 🟡 Normal |
| TC-3.1 | 3: Mindaloy checkout | Mindaloy issues a key and a script reaches a route with it | 🔴 Critical |
| TC-4.1 | 4: Organization project with `admin` | The `/api-keys` admin screen still works | 🟢 Low |

## Scenario 1: Fresh D1 project with `api-keys-user`

**Setup.** Run once, for every case in this scenario.

1. Make a new project with only base, api, database-d1 and auth.

```sh
cd $REPO/.dev && node $CLI init qa-manual-user --no-install </dev/null && cd qa-manual-user && node $CLI add database-d1 -y </dev/null && node $CLI add auth -y </dev/null
```

- [ ] Setup complete

### TC-1.1: An agent wires a route from the skill alone  ·  🔴 Critical

**Goal.** The `saasaloy-api-keys` skill is enough to install user mode and protect a route, with no reading of module source.

**Steps**

1. Install the user owner.

   ```sh
   node $CLI add api-keys-user -y </dev/null
   ```

2. Open `.agents/skills/saasaloy-api-keys/SKILL.md` in the project. Read the sections on picking an owner and on user mode.
   - [ ] The skill tells you which owner to pick for a project with no organizations, and why
     - the difference between the core and the two owners
     - the command for each owner
3. Give a coding agent only this instruction: "Using the saasaloy-api-keys skill, let a key with `cards:read` call `GET /cards`, and declare `cards: [read, write]` as the key vocabulary."
   - [ ] The agent edits `packages/auth/src/api-key-scopes.ts` and writes a route with `requireCaller` and `requireScope` from `@repo/auth/caller`, with no wrong turn
     - the route checks data ownership on `caller.userId`, or the agent says why it does not need to
     - the agent does not call `requirePermission` or `requireTenant`
4. Read the failure-mode and removal sections.
   - [ ] Each 401 and 403 message in the skill matches the messages in the Automated verification section below

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The owner prompt and the conflict message read clearly  ·  🟡 Normal

**Goal.** A person at a real terminal understands the owner choice and the conflict refusal at first read.

**Steps**

1. Make a second new project, then run `add api-keys` in a real terminal, not through an agent.

   ```sh
   cd $REPO/.dev && node $CLI init qa-manual-pick --no-install </dev/null && cd qa-manual-pick && node $CLI add database-d1 -y </dev/null && node $CLI add auth -y </dev/null
   ```

   ```sh
   node $CLI add api-keys
   ```

   - [ ] The prompt "api-keys needs one of these — pick one" lets you choose an owner, and the two names are clear without the docs
2. Pick `api-keys-user`. Then try the other owner.

   ```sh
   node $CLI add api-keys-organization
   ```

   - [ ] The refusal names the conflict and the exact command that removes it

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before you start Scenario 2.

```sh
rm -rf $REPO/.dev/qa-manual-user $REPO/.dev/qa-manual-pick
```

## Scenario 2: Old `api-keys` project

**Setup.** Run once, for every case in this scenario. It copies the agent's untouched old project, which was made from the registry at `11c81a97`.

```sh
cp -a $REPO/.dev/qa229-old-control $REPO/.dev/qa-manual-old && cd $REPO/.dev/qa-manual-old
```

- [ ] Setup complete

### TC-2.1: The move instructions are clear to a project owner  ·  🟡 Normal

**Goal.** An owner of an old `api-keys` project knows what to do from the CLI output and the release note.

**Steps**

1. Run `update` with the new registry.

   ```sh
   node $CLI update -y </dev/null
   ```

   - [ ] The refusal tells you that nothing changed, and which `add` command to run next
2. Read the `BREAKING CHANGE:` footer of commit `4a6b615`.

   ```sh
   git -C $REPO log -1 --format=%B 4a6b615
   ```

   - [ ] The footer tells you to pick `api-keys-organization`, the command order, and that the table does not change
3. Follow the footer. Run the `add`, then `update`.

   ```sh
   node $CLI add api-keys-organization -y </dev/null
   ```

   ```sh
   node $CLI update -y </dev/null
   ```

   - [ ] The output does not suggest that you lost data or must act on `api_keys`
     - the second `update` exits 3 and lists merges in other modules; the agent showed that the old registry gives the same exit 3

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before you start Scenario 3.

```sh
rm -rf $REPO/.dev/qa-manual-old
```

## Scenario 3: Mindaloy checkout

**Setup.** Run once. Use a Mindaloy branch that you can throw away.

1. Clone or open https://github.com/mimukit/mindaloy and make a new branch.
2. Point the CLI at this checkout, as in **Environment**.

- [ ] Setup complete

### TC-3.1: Mindaloy issues a key and a script reaches a route with it  ·  🔴 Critical

**Goal.** User mode fits Mindaloy's Phase 3, with Mindaloy's own per-collection checks on top.

**Steps**

1. In the Mindaloy checkout, install the user owner.

   ```sh
   node $CLI add api-keys-user -y </dev/null
   ```

   - [ ] Mindaloy keeps only base, api, database-d1, auth, api-keys and api-keys-user, and nothing from multitenant, teams or admin
2. Declare Mindaloy's pairs in `packages/auth/src/api-key-scopes.ts`. Protect one Mindaloy route with `requireCaller`, `requireScope`, and Mindaloy's collection check on `caller.userId`.
3. Sign in, create a key with `authClient.apiKey.create`, and call the route from a script with `Authorization: Bearer <key>`.
   - [ ] The script reaches the route, and a key for a different user's collection is refused by Mindaloy's own check
4. Deploy, or run with `wrangler` on the free-tier settings that Mindaloy uses.
   - [ ] The synchronous `lastRequest` write on each bearer call is acceptable for Mindaloy's request volume

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Delete the Mindaloy branch, or keep it as the start of Mindaloy Phase 3.

## Scenario 4: Organization project with `admin`

**Setup.** Run once. Use the agent's organization project, `.dev/qa229-org-d1`. Sign in as the first user, who gets `superadmin`, and create one organization.

```sh
cd $REPO/.dev/qa229-org-d1 && pnpm install && pnpm turbo run build --force
```

- [ ] Setup complete

### TC-4.1: The `/api-keys` admin screen still works  ·  🟢 Low

**Goal.** The organization owner's screen behaves as before the split.

**Steps**

1. Open `/api-keys` in the admin app. Create a key with one scope, copy it, then revoke it.
   - [ ] The list, the create form, the one-time key display and the revoke work as before
     - the sidebar has no "API keys" link on this branch, because `admin` here has no `NAV_ITEMS`; open the URL directly

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** No reset is necessary. The project is scratch data under `.dev/`.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

The agent ran every command at `4a6b615` with a clean tree. The CLI and runtime checks ran on new scratch projects under `.dev/qa229-*`, which the agent created for this run. `rm -rf $REPO/.dev/qa229-*` removes them. The Postgres checks used a temporary `postgres:17-alpine` container on `127.0.0.1:5545`, which the agent removed after the run. The full record, with every command and output, was `/tmp/qa229-results.md`.

### Failures found, then fixed

The first run at `4a6b615` found two failures. The fix round after it changed `packages/cli/src/commands/add.ts`, `packages/cli/src/commands/add.test.ts` and `packages/cli/src/lib/doctor.test.ts`. The agent then ran the gates and A1 again.

- ✅ **A1, fixed.** Before the fix, `add api-keys` with no TTY and no `-y` exited 2 with "No terminal to confirm in — re-run with `--yes`". That message did not name the owners, and `--yes` cannot pick an owner. Now the `requiresOneOf` check runs before the no-TTY refusal. Two new tests cover it: "names the owners of an unmet requiresOneOf, not the --yes flag" (red before the fix) and "still refuses a module with nothing to pick for want of a terminal".

  ```sh
  node $CLI add api-keys </dev/null
  ```

  Observed after the fix, on the new project `.dev/qa229-a1`: "api-keys needs one of: api-keys-organization, api-keys-user, and none is installed." and exit 2. Nothing was installed.

- ✅ **B2, kept as a known limit and documented.** `doctor` on an old `api-keys` project prints "No problems found.", because the old lock has no `requiresOneOf` field and `doctor` does not go online. `update` is the guard for that project, and it refuses with exit 2 (B1). The test comment in `packages/cli/src/lib/doctor.test.ts` said that `doctor` catches such a project. It now states the limit. `doctor` still catches an owner that is removed after the split.

  ```sh
  node $CLI doctor </dev/null
  ```

  Observed on `.dev/qa229-old` before the add: "No problems found." and exit 0, as documented.

### Repo gates

```sh
pnpm test
```

```sh
pnpm typecheck
```

```sh
pnpm build
```

```sh
pnpm lint
```

- ✅ `pnpm test` → after the fix round, 1315 CLI tests (1313 at `4a6b615`), 587 module tests and 166 script tests pass, 0 fail.
- ✅ `pnpm typecheck` → exit 0.
- ✅ `pnpm build` → exit 0.
- ✅ `pnpm lint` → exit 0, all four passes, "All matched files use Prettier code style!".

### Owner choice (CLI), `.dev/qa229-pick`

```sh
node $CLI add api-keys -y </dev/null
```

```sh
node $CLI add api-keys-user -y </dev/null
```

```sh
node $CLI add api-keys-organization -y </dev/null
```

```sh
node $CLI doctor </dev/null
```

- ✅ `add api-keys -y`, and after the fix also `add api-keys` with no `-y` → exit 2, "api-keys needs one of: api-keys-organization, api-keys-user, and none is installed". Nothing installed.
- ✅ A real TTY (through `script`) → the prompt "api-keys needs one of these — pick one" opens.
- ✅ `add api-keys-user -y` → "Applied api-keys, api-keys-user (8 files)". `installed` has no multitenant, teams or admin.
- ✅ `add api-keys-organization -y` beside it → exit 2, "declares a conflict with api-keys-user … Run `saasaloy remove api-keys-user` first."
- ✅ `doctor` → 64 files match, 8 modules, "No problems found.", exit 0.
- ✅ After `remove api-keys-user` on a copy → `doctor` reports "api-keys needs one of …" and exits 2.

### Migration of an old project, `.dev/qa229-old`

```sh
node $CLI update -y </dev/null
```

```sh
node $CLI add api-keys-organization -y </dev/null
```

```sh
jq -r '.managed | to_entries[] | select(.key|test("api-key")) | "\(.value.module)\t\(.key)"' .saasaloy/manifest.json
```

```sh
cd packages/db && pnpm db:generate
```

- ✅ The first `update` → exit 2, names `saasaloy add api-keys-organization` and `saasaloy add api-keys-user`, says "Nothing was changed." The tree sha256 is `849b9236…` before and after.
- ✅ `add api-keys-organization -y` → exit 0. The schema file and the route are unchanged. The plugin, the resolver and the workspace are overwritten (clean files; the workspace differs by one comment line).
- ✅ The manifest moves the 5 owner files and the `apiKeyTenant` patch to `api-keys-organization`. The client file, the skill and the 4 shared patches stay under `api-keys`.
- ✅ The second `update` → removes no file and writes `api-key-options.ts`. It exits 3. An untouched control project on the old registry also exits 3, with the same 9 drift files, so exit 3 predates this change.
- ✅ `db:generate` → "No schema changes, nothing to migrate".

### User mode on D1, `.dev/qa229-user-d1`

The project has `API_KEY_SCOPES = { cards: ["read", "write"] }` and a scratch route file, `apps/api/src/routes/qa-caller.ts`. `/qa/read` demands `cards:read`, and `/qa/write` demands `cards:write`. The server ran with `vite dev` on port 4000, because plain `wrangler dev` cannot run `import.meta.glob`.

Static facts, read only:

```sh
$DB_CMD "SELECT name, type, \"notnull\" FROM pragma_table_info('api_keys')"
```

```sh
$DB_CMD "PRAGMA foreign_key_list(api_keys)"
```

```sh
$DB_CMD "PRAGMA index_list(api_keys)"
```

```sh
$DB_CMD "SELECT name FROM d1_migrations"
```

- ✅ `user_id` is `TEXT`, not null. The table has no `organization_id`.
- ✅ The foreign key is `user_id → users.id`, `ON DELETE CASCADE`.
- ✅ The index `api_keys_user_id_idx` exists, beside `api_keys_key_idx` and `api_keys_config_id_idx`.
- ✅ `d1_migrations` lists `0000_shallow_lady_ursula.sql`.

Runtime. The agent captured `$COOKIE` from the sign-up cookie jar and `$KEY` from the create response.

```sh
curl -s -i -c /tmp/qa-jar1.txt -H 'Content-Type: application/json' -H 'Origin: http://localhost:4000' -X POST $B/auth/sign-up/email -d '{"email":"qa1@example.com","password":"qa229-password-1","name":"QA One"}'
```

```sh
curl -s -w '\nHTTP %{http_code}\n' -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -H 'Origin: http://localhost:4000' -X POST $B/auth/api-key/create -d '{"name":"reader","metadata":{"scope":{"cards":["read"]}}}'
```

```sh
curl -s -w '\nHTTP %{http_code}\n' -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -H 'Origin: http://localhost:4000' -X POST $B/auth/api-key/create -d '{"name":"wide","metadata":{"scope":{"reviews":["read"]}}}'
```

```sh
curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer $KEY" $B/qa/read
```

```sh
curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer $KEY" $B/qa/write
```

```sh
curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer " -H "Cookie: $COOKIE" $B/qa/write
```

```sh
curl -s -w ' HTTP %{http_code}\n' -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -H 'Origin: http://localhost:4000' -X POST $B/auth/api-key/delete -d "{\"keyId\":\"$KEYID\"}"
```

```sh
$DB_CMD "PRAGMA foreign_keys; DELETE FROM users WHERE id = 'RTmqxiuJkKmGzpVmiwfiHMszQ57oTpaa'; SELECT count(*) AS n FROM api_keys WHERE user_id = 'RTmqxiuJkKmGzpVmiwfiHMszQ57oTpaa';"
```

- ✅ Sign-up → 200 with a session cookie.
- ✅ Create `reader` with `cards:read` → 200. The row has `permissions` `{"cards":["read"]}` and `user_id` equal to the user's id.
- ✅ Create with `reviews:read` → 403 `{"message":"permission required: reviews:read"}`. The row count stays at 1.
- ✅ Create with no scope → 200 with `permissions` `{}`. That key gets 403 on `/qa/read`.
- ✅ List → 200 with 2 keys and no `key` field.
- ✅ Bearer `/qa/read` → 200 `{"userId":"RTmq…","kind":"apiKey"}`.
- ✅ Bearer `/qa/write` → 403 `permission required: cards:write`, also when a cookie comes with it.
- ✅ Cookie `/qa/write` → 200 with `kind` `user`. No credential → 401 `sign in first`.
- ✅ An empty `Bearer ` header with a cookie → 401 `invalid api key`. A wrong key with a cookie → 401 `invalid api key`.
- ✅ A second user gets 404 `KEY_NOT_FOUND` on get, update and delete of the first user's key, and an empty list.
- ✅ The owner deletes the key → `{"success":true}`. Then the key gets 401 `invalid api key`, with or without a cookie. The cookie alone still gets 200.
- ✅ `DELETE FROM users` with `foreign_keys` on → the user's key count goes from 2 to 0. The second user remains.

### User mode on Postgres, `.dev/qa229-user-pg`

```sh
psql "postgres://qa@127.0.0.1:5545/qa229" -c "SELECT conname||' '||pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='api_keys'::regclass AND contype='f';"
```

```sh
psql "postgres://qa@127.0.0.1:5545/qa229" -c "SELECT indexdef FROM pg_indexes WHERE tablename='api_keys' ORDER BY indexname;"
```

- ✅ `user_id` is `text`, not nullable. The foreign key `api_keys_user_id_users_id_fk` references `users(id)` `ON DELETE CASCADE`. The index `api_keys_user_id_idx` exists. The drizzle migration table has one row.
- ✅ The runtime gives the same answers as D1: create 200 with the stored scope, an out-of-vocabulary create 403, bearer read 200, bearer write 403, revoke then 401, and the user delete takes the key count to 0.

### Organization regression, `.dev/qa229-org-d1`

- ✅ `add api-keys-organization -y` installs on D1. Typecheck passes in 6 of 7 packages. The one failure is the `@repo/db` `tenant.typecheck.ts` error (TS2578, TS2353), and the old registry gives the same error.
- ✅ The `api_keys` SQL from `db:generate`, and the whole migration, are byte-identical to the old registry's.

### Browser checks
_No browser check ran._ `playwright-cli` is on this box, but no screen in this change is new. The organization `/api-keys` screen differs by one comment line, and user mode ships no screen. TC-4.1 covers the screen by hand.

## Not covered / needs human judgment
- Skill quality, CLI message clarity and release-note clarity are judgments. TC-1.1, TC-1.2 and TC-2.1 cover them.
- Mindaloy's own collection checks and its free-tier traffic are outside this repo. TC-3.1 covers them.
- Concurrency: the agent did not run two creates or two revokes at the same time. The plugin owns those writes, and this change does not alter them.
- Performance: the agent did not measure the synchronous `lastRequest` write under load. This change does not alter it.
- Compatibility and accessibility: user mode ships no UI, and the organization screen did not change. TC-4.1 is the only UI case.
- The owner switch procedure (revoke every key, remove one owner, add the other) did not run end to end.
- Known deviations that predate this change: `NAV_ITEMS` never applies on this branch, and `add` empties the `.dev.vars.example` descriptions of modules that are already installed.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
