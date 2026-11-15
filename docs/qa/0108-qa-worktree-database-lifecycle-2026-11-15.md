# QA Plan: Worktree database lifecycle

_Generated 2026-11-15 · against `c213c2e6` (clean) · covers issue #339 Phases 1 to 4: the copied-URL guard, `db:drop` and the test database, the database mapping, `pnpm db:prune`, and the `## Worktree setup` section_

## Summary

- A new worktree gets a migrated, seeded branch database from one gitkit `prepare`, and `pnpm db:prune` drops the databases of closed branches.
- Working means a worktree never drops the main database, teardown leaves no database behind, and prune drops only the databases of closed branches.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-339-set-up-tear-down-and-prune-each-worktrees-dev` at `c213c2e6`, stacked on PR #322.
- Playground: `.dev/playground`, made with `pnpm play:init`, then `./saasaloy add api database-postgres feature-flags --yes` and `pnpm install`. The agent left it at that state, with `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/playground_dev` in `packages/env/.env`.
- Docker must start a container. On devaloy at `c213c2e6` it does not: `docker compose up -d` fails with `cannot read IP forwarding setup from '/proc/sys/net/ipv4/ip_forward'`, and `docker run` fails with an overlay mount error. Scenarios 1 to 3 need a box where Docker works.
- `psql` is not on devaloy. The steps below run `psql` inside the container.
- Database names in the playground: the main database is `playground_dev`. A branch `feat-a` gets `playground_dev_feat_a`.

Launch the container and the main database with:

```sh
cd .dev/playground && pnpm db:generate && pnpm db:setup
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Main database up, worktree with a copied URL | A worktree `db:drop` keeps the main database | 🔴 Critical |
| TC-1.2 | 1: Main database up, worktree with a copied URL | `db:drop` removes the branch and test databases | 🔴 Critical |
| TC-2.1 | 2: Mixed databases on the container | `db:prune` lists only closed-branch databases | 🔴 Critical |
| TC-2.2 | 2: Mixed databases on the container | `--apply` skips a database with a session | 🟡 Normal |
| TC-2.3 | 2: Mixed databases on the container | `--apply` drops only the candidates | 🔴 Critical |
| TC-3.1 | 3: A worktree from gitkit | `prepare` gives a ready worktree with no typed command | 🔴 Critical |
| TC-3.2 | 3: A worktree from gitkit | gitkit removal drops both databases | 🔴 Critical |
| TC-3.3 | 3: A worktree from gitkit | prune cleans a worktree made by hand | 🟡 Normal |
| TC-4.1 | 4: d1 project, no Docker | setup and teardown run with `database-d1` | 🟡 Normal |
| TC-4.2 | 4: Postgres project, no server | the guards and refusals work without a server | 🔴 Critical |

## Scenario 1: Main database up, worktree with a copied URL

**Setup.** Run once, for every case in this scenario. Run from `.dev/playground`.

1. Create a worktree on a new branch and copy the main env file into it, as `pnpm env:setup` does in a fresh worktree.

```sh
git worktree add -b feat-copy ../wt-copy && cp apps/api/.env ../wt-copy/apps/api/.env && cd ../wt-copy && pnpm install --frozen-lockfile
```

- [ ] Setup complete

### TC-1.1: A worktree `db:drop` keeps the main database  ·  🔴 Critical

**Goal.** A copied `DATABASE_URL` never makes the main database a drop target.

**Steps**

1. Stop the container, then run `db:drop` in the worktree.

   ```sh
   docker compose -f ../playground/compose.yaml stop && pnpm db:drop
   ```

   - [ ] The output is "This checkout has no development database. Nothing to drop." and `apps/api/.env.db` does not exist
2. Start the container again and list the databases.

   ```sh
   docker compose -f ../playground/compose.yaml start && docker compose -f ../playground/compose.yaml exec postgres psql -U postgres -l
   ```

   - [ ] `playground_dev` is still in the list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _The agent ran step 1 with no server on devaloy (TC-4.2). Step 2 needs a working container._

### TC-1.2: `db:drop` removes the branch and test databases  ·  🔴 Critical

**Goal.** Teardown leaves neither the branch database nor its test database.

**Steps**

1. Create the branch database. It prints one line that ignores the copied URL.

   ```sh
   pnpm db:setup
   ```

   - [ ] The first line names `playground_dev` as ignored, and the summary names `playground_dev_feat_copy`
2. Run the tests, so the test setup creates the test database.

   ```sh
   pnpm test
   ```

3. Drop the database and list what is left.

   ```sh
   pnpm db:drop && docker compose -f ../playground/compose.yaml exec postgres psql -U postgres -l
   ```

   - [ ] The output names `playground_dev_feat_copy` and `playground_dev_feat_copy_test`, and neither is in the list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd ../playground && git worktree remove --force ../wt-copy && git branch -D feat-copy
```

## Scenario 2: Mixed databases on the container

**Setup.** Run once, for every case in this scenario. Run from `.dev/playground`.

1. Make a mapped database for an open branch `feat-a`, and one for a branch `feat-b` that you then delete.

```sh
git worktree add -b feat-a ../wt-a && cp apps/api/.env ../wt-a/apps/api/.env && (cd ../wt-a && pnpm install --frozen-lockfile && pnpm db:setup)
```

```sh
git worktree add -b feat-b ../wt-b && cp apps/api/.env ../wt-b/apps/api/.env && (cd ../wt-b && pnpm install --frozen-lockfile && pnpm db:setup && pnpm test) && git worktree remove --force ../wt-b && git branch -D feat-b
```

2. Make a database mapped by another clone, one with no mapping, and one mapped by another project whose name the prefix also matches.

```sh
docker compose exec postgres psql -U postgres -c "CREATE DATABASE playground_dev_feat_x" -c "COMMENT ON DATABASE playground_dev_feat_x IS '{\"saasaloy\":1,\"prefix\":\"playground_dev\",\"branch\":\"feat-x\",\"worktree\":\"/elsewhere\",\"clone\":\"000000000000\"}'" -c "CREATE DATABASE playground_dev_old" -c "CREATE DATABASE playground_dev_tools_dev_feat_y" -c "COMMENT ON DATABASE playground_dev_tools_dev_feat_y IS '{\"saasaloy\":1,\"prefix\":\"playground_dev_tools_dev\",\"branch\":\"feat-y\",\"worktree\":\"/other\",\"clone\":\"000000000000\"}'"
```

- [ ] Setup complete

### TC-2.1: `db:prune` lists only closed-branch databases  ·  🔴 Critical

**Goal.** The dry run names exactly the `feat-b` databases and drops nothing.

**Steps**

1. Run the dry run from the main checkout.

   ```sh
   pnpm db:prune
   ```

   - [ ] The `prune` lines are `playground_dev_feat_b` and `playground_dev_feat_b_test`, each with a size
   - [ ] The `keep` lines give `playground_dev` as `default`, `playground_dev_feat_a` as `branch open`, `playground_dev_feat_x` as `foreign, no merged PR` (or `foreign, gh missing`) `playground_dev_old` as `unmapped`, and `playground_dev_tools_dev_feat_y` as `other project`
   - [ ] The last line says nothing was dropped and names `pnpm db:prune --apply`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `--apply` skips a database with a session  ·  🟡 Normal

**Goal.** Prune never ends an open session.

**Steps**

1. Open a session on a candidate in a second terminal, and leave it open.

   ```sh
   docker compose exec postgres psql -U postgres -d playground_dev_feat_b
   ```

2. Run the dry run, then `--apply`, in the first terminal.

   ```sh
   pnpm db:prune && pnpm db:prune --apply
   ```

   - [ ] `playground_dev_feat_b` shows as `in use`, and `--apply` keeps it and names it
3. Close the session with `\q`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: `--apply` drops only the candidates  ·  🔴 Critical

**Goal.** `--apply` drops the closed-branch databases and keeps every other one.

**Steps**

1. Apply, then list the databases.

   ```sh
   pnpm db:prune --apply && docker compose exec postgres psql -U postgres -l
   ```

   - [ ] Both `feat-b` databases are gone, and `playground_dev`, `playground_dev_feat_a`, `playground_dev_feat_x` `playground_dev_old` and `playground_dev_tools_dev_feat_y` are still in the list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
(cd ../wt-a && pnpm db:drop) && git worktree remove --force ../wt-a && git branch -D feat-a && docker compose exec postgres psql -U postgres -c "DROP DATABASE playground_dev_feat_x" -c "DROP DATABASE playground_dev_old" -c "DROP DATABASE playground_dev_tools_dev_feat_y"
```

## Scenario 3: A worktree from gitkit

**Setup.** Run once, for every case in this scenario. Commit the playground so the worktree gets the migrations.

```sh
git add -A && git commit -m "chore: migrations"
```

- [ ] Setup complete

### TC-3.1: `prepare` gives a ready worktree with no typed command  ·  🔴 Critical

**Goal.** One gitkit `prepare` leaves a migrated, seeded branch database.

**Steps**

1. In an agent session in `.dev/playground`, say "make me a worktree for branch feat-g". gitkit creates it and runs `prepare`.
   - [ ] gitkit reports `setup:` with exit 0 and writes the `gitkit-prepared` marker
2. Check the worktree.

   ```sh
   cd <worktree path> && ls -l packages/env/.env && pnpm db:status
   ```

   - [ ] `packages/env/.env` is a symlink to `.dev/playground/packages/env/.env`, and `db:status` shows `playground_dev_feat_g` with 0 pending migrations
   - [ ] The seed output in the gitkit log lists rows for `feature_flags` and `users`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: gitkit removal drops both databases  ·  🔴 Critical

**Goal.** gitkit teardown removes the branch and test databases.

**Steps**

1. Run `pnpm test` in the worktree, then say "tear down this worktree" in the agent session.
   - [ ] gitkit reports `teardown:` with exit 0, and the worktree is gone
2. List the databases.

   ```sh
   docker compose exec postgres psql -U postgres -l
   ```

   - [ ] Neither `playground_dev_feat_g` nor `playground_dev_feat_g_test` is in the list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.3: prune cleans a worktree made by hand  ·  🟡 Normal

**Goal.** A worktree removed without teardown leaves nothing after `db:prune --apply`.

**Steps**

1. Make a worktree by hand, set up its database, then remove it and delete its branch.

   ```sh
   git worktree add -b feat-h ../wt-h && cp apps/api/.env ../wt-h/apps/api/.env && (cd ../wt-h && pnpm install --frozen-lockfile && pnpm db:setup) && git worktree remove --force ../wt-h && git branch -D feat-h
   ```

2. Prune from the main checkout.

   ```sh
   pnpm db:prune && pnpm db:prune --apply
   ```

   - [ ] The dry run lists `playground_dev_feat_h` as `prune`, and `--apply` drops it

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
docker compose down -v && cd ../.. && pnpm play:destroy
```

## Scenario 4: d1 and no-server checks · run by the agent on `.dev` at `c213c2e6`

**Setup.** The agent made `.dev/playground-d1` (`init`, `add api database-d1 feature-flags`, `db:generate`) and used `.dev/playground` with no Postgres server.

- [x] Setup complete

### TC-4.1: setup and teardown run with `database-d1`  ·  🟡 Normal

**Goal.** The same blocks run on d1 with no error and touch nothing outside the worktree.

**Steps**

1. Read the `## Worktree setup` blocks as gitkit `prepare` does, then run `setup:` in a new worktree `feat-d1` with the three `GITKIT_*` variables.
   - [x] `setup:` exits 0: the symlink is made, `db:setup` applies `0000_careless_catseye.sql`, and `db:seed` writes rows
2. Run `pnpm db:prune`, then `teardown:`, then `git worktree remove`.
   - [x] `db:prune` drops nothing and says why, `teardown:` exits 0, and the main checkout keeps its `packages/env/.env`

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** Seed output: `feature_flag_overrides 2 rows`, `feature_flags 3 rows`, `users 4 rows`, `accounts 4 rows`. Prune output: "D1 keeps each local database in apps/api/.wrangler/state inside its own worktree, so it goes when the worktree goes. Nothing to prune." Teardown output: "dev:stop: nothing runs in this checkout." and "Dropped the local D1 database (…/wt-d1/apps/api/.wrangler/state/v3/d1)". That path is inside the worktree. The first `setup:` run failed with "No migrations present" because the fresh d1 project had no migrations; this is the d1 driver's existing behavior, and the run after `db:generate` passed.

### TC-4.2: the guards and refusals work without a server  ·  🔴 Critical

**Goal.** A copied URL infers nothing, and prune refuses or exits clearly when it has no server.

**Steps**

1. In worktree `feat-copy` with `apps/api/.env` copied from the main checkout, run `pnpm db:drop` and `pnpm db:setup`.
   - [x] `db:drop` prints the "Nothing to drop" line and writes no `.env.db`; `db:setup` prints the ignore line for `playground_dev` and targets `playground_dev_feat_copy`
2. Run `pnpm db:prune`, `pnpm db:prune --server`, and `pnpm db:prune` with a neon state block.
   - [x] The plain run refuses and names `--server`; `--server` prints the `git fetch --prune` line first; neon prints that there is nothing to prune and exits 0

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** `db:drop` → "This checkout has no development database. Nothing to drop." (exit 0). `db:setup` → "Ignoring DATABASE_URL in apps/api/.env: it names playground_dev, not playground_dev_feat_copy, so it was copied from another checkout. Creating playground_dev_feat_copy." then exit 1 at `docker compose up -d`. `db:prune` → "This checkout has no state block and the local container does not answer. Run pnpm db:prune --server to read the server DATABASE_URL in apps/api/.env names." (exit 1). `db:prune --server` → "db:prune reads the remote refs as they are now and never fetches; run `git fetch --prune` first." then ECONNREFUSED (exit 1). Neon → "This checkout uses neon.new, which deletes each database when it expires. Nothing to prune." (exit 0).

**Reset.** The agent removed `wt-copy`, `wt-d1`, `.dev/playground-d1`, `.dev/playground-old` and the two Docker volumes that the failed `compose up` made. `.dev/playground` stays for Scenarios 1 to 3.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm run test:modules
```

```sh
pnpm exec turbo run test --concurrency=4
```

```sh
pnpm run test:base && pnpm run test:tooling && pnpm run test:scripts
```

```sh
pnpm lint
```

```sh
cd .dev/playground && pnpm typecheck
```

```sh
cd .dev/playground && pnpm exec oxlint -c oxlint.config.mjs --deny-warnings packages/db
```

```sh
cd .dev/playground && pnpm lint
```

- ✅ `pnpm run test:modules` → 1050 of 1050 pass at `c213c2e6`, with the new `mapping.test.ts`, `prune.test.ts` and the `inferState` and `testDatabaseName` cases. Each prune skip reason has a test that fails when its rule is broken.
- ✅ After the prefix fix, `pnpm run test:modules` → 1053 of 1053, `pnpm lint` → exit 0, and the playground `pnpm --filter @repo/db typecheck` → exit 0. The `other project` rule, for a mapped and an unmapped name, has tests that fail when the rule is broken.
- ❌ `turbo run test` → 1959 of 1960 pass. The one failure is `update-notes.test.ts > dates every base note at or before the CLI in this package` (`base/0002` and `base/0003` at 0.9.0). The acceptance check ran it at the base `73ab3aab` and confirmed that PR #322 causes it, not this branch.
- ✅ `test:base` 144/144, `test:tooling` 195/195, `test:scripts` 533/533.
- ✅ `pnpm lint` → exit 0 at `c213c2e6`.
- ✅ playground `pnpm typecheck` → 13 of 13 tasks pass, with the new `prune.ts`, `mapping.ts` and the changed `setup.ts`, `drop.ts`, `test-setup.ts`.
- ✅ playground `oxlint` on `packages/db` (the project's own `lint:code` rules) → exit 0.
- ❌ playground `pnpm lint` → exit 1 in its `lint:types` pass, in `packages/env/src/dev-ports*.ts`, `packages/tooling/src/dev-stop.ts`, `packages/tooling/src/vite/*` and `packages/ui/src/lib/random-id.ts`. All are base-template files this branch does not change.
- ✅ `saasaloy init` writes one `## Worktree setup` section, and a parser that follows gitkit `prepare.md` reads `setup`, `update`, `teardown` and `watch` with no broken declaration.
- ✅ `saasaloy update base` on a project made with the `73ab3aab` template → "update AGENTS.md", and the new section is the same as the template's.

## Not covered / needs human judgment

- Every check that needs a running Postgres server: Scenarios 1 to 3. Docker on devaloy cannot start a container at `c213c2e6`, and the agent did not get permission to run a Postgres binary it downloaded.
- The `gh` merged-PR lookup against a real merged PR. The unit tests cover the decision; no foreign database with a merged PR was available.
- The `server` backend on a shared server: same logic as docker, with the `git fetch --prune` line. Not run against a remote host.
- Browser, accessibility and visual checks: the change has no UI.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
