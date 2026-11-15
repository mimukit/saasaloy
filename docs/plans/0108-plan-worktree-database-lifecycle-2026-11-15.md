# Plan: worktree database lifecycle

Grilled: 2026-11-15

## Context

A generated project with `database-postgres` gives each branch its own development database (`<project>_dev_<branch>`), but two steps stay manual. Nothing runs `pnpm db:setup` when a worktree is created, and a worktree removed without `pnpm db:drop` leaves its database on the server. The research on 2026-11-15 compared PGX (`pgrundev/pgx`) and NeonD (`matisiekpl/neond`) and rejected both: PGX is not PostgreSQL and conflicts with how we deliver `DATABASE_URL`, and NeonD has no PG 18 and no documented API. This plan closes the two gaps inside our own flow.

The code reading found two more defects that this plan must fix first:

- **The inferred state block can name another checkout's database.** In a fresh worktree, `pnpm env:setup` copies the main checkout's `DATABASE_URL` (for example `acme_dev`) into `apps/api/.env`, because `apps/api/.env` does not exist yet. The next `db:*` command calls `resolveState` (`modules/database-postgres/files/scripts/lib/context.ts`), which infers a block for `acme_dev` and writes it to `apps/api/.env.db`. If `db:setup` fails before it creates the branch database, `pnpm db:drop` in that worktree drops the main checkout's database.
- **`db:drop` leaves the test database.** `drop.ts` drops the development database only. The checkout's `<database>_test`, which `test-setup.ts` creates, stays on the server.

Goal: a new worktree is ready to run after one gitkit `prepare`, and no development database outlives its closed branch.

Target: after `gitkit prepare`, a new worktree has a migrated, seeded `<project>_dev_<branch>` database with zero manual commands. After `pnpm db:prune --apply`, the server holds zero mapped databases from this clone whose branch is closed, test databases included, and every database from another clone without a merged PR is still there. Both are checked in the playground in Phase 4.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the worktree setup lives | A `## Worktree setup` section in `packages/cli/templates/base/AGENTS.md`, in the format gitkit `prepare` reads (`setup:`, `update:`, `teardown:`, `watch:`). `AGENTS.md` is a managed file (not in `seedFiles` or `ownedFiles` of `_saasaloy-base.json`), so `saasaloy update` delivers the section to existing projects. |
| How a database-agnostic base calls database scripts | `pnpm run --if-present db:setup` (and `db:seed`, `db:drop`). The base has no database module, and no patch kind can add a section to `AGENTS.md`. One static block then works with no database, with `database-d1` and with `database-postgres`. |
| `packages/env/.env` in a worktree | `setup:` symlinks it to `"$GITKIT_REPO/packages/env/.env"` when the worktree has none. The file never drifts, because the file holds no per-worktree value (`DATABASE_URL` lives in `apps/api/.env`), and both writers follow the link (`writeFileSync` in `packages/env/src/env-file.ts`, `writeFile` in `packages/cli/src/commands/env.ts`). When the main checkout has no file, `setup:` stops and names `saasaloy env`. (Asked, Q2.) |
| Seed on setup | `setup:` runs `db:seed`; `update:` does not. `db:seed` is an idempotent upsert, so a re-run of `setup:` is safe, and `update:` never resets rows a person edited. (Owner, planning.) |
| Inference rule | `resolveState` infers a block only when the URL's database is this checkout's own name (`context.database`). Any other URL infers nothing, so a copied `DATABASE_URL` can never become a drop target. |
| `db:drop` and the test database | `db:drop` also drops `testDatabaseName(state.database)` on the same server, through `assertManagedDatabase`. Teardown then leaves nothing behind. |
| The database mapping | `db:setup` (and `--reset`) writes `COMMENT ON DATABASE "<db>" IS '<json>'` on the development database, and `test-setup.ts` writes the same on the test database. The JSON is `{"saasaloy":1,"branch":"<branch>","worktree":"<abs path>","clone":"<clone id>"}`. The clone id is a short SHA-1 of the hostname plus `git rev-parse --git-common-dir` as an absolute path, so every worktree of one clone shares it and a second clone on the same machine differs. Prune reads it with `shobj_description(oid, 'pg_database')`. A comment, not a table, so the drizzle schema stays clean. (Defaulted, Q10, from the owner's Q1 answer.) |
| The prune rule | Prune drops a database only when its mapped branch is merged and closed. For a database whose `clone` matches this clone: closed means the branch is absent from `refs/heads/*` and from every `refs/remotes/*/*`, and closed is enough, so an abandoned branch is pruned too. For a database from another clone: drop only when `gh pr list --state merged --head <branch>` finds a merged PR; without `gh`, or with no merged PR, skip it and say why. The default `<prefix>` database is never a candidate. (Asked, Q1 and Q9.) |
| Databases made before the mapping | Prune lists them as "unmapped" and skips them. `--include-unmapped` applies the old ref-based rule to them: no local or remote ref computes to that name through `branchDatabaseName`. (Defaulted, Q11.) |
| `db:prune` default | Dry run. With no flags it lists the candidates and the skipped databases with the reason for each, and drops nothing; `--apply` drops the candidates. This matches `devaloy clean`, gitkit `clean` and `pgx git prune`. (Owner, planning.) |
| `db:prune` backends | `docker` and `server`. `neon` prints that neon.new deletes each database when it expires, then exits 0. (Owner, planning.) |
| Which server prune reads | The state block's backend. With no block, the local container when it answers; otherwise refuse and name `--server`, which reads the server `DATABASE_URL` names. The main checkout after `db:drop` can then still prune the container. (Defaulted, Q6.) |
| Remote refs | Prune does not fetch. On `server` it prints "run `git fetch --prune` first". A stale remote ref only keeps a database. (Defaulted, Q4.) |
| A database in use | Prune skips a database with rows in `pg_stat_activity` and reports it, because `dropDatabase` uses `WITH (FORCE)` and would end the session. |
| A branch switched in place | The old branch's database stays until prune closes the branch. `db:setup` already prints that it leaves the old database alone. (Defaulted, Q3.) |
| A teardown that `db:drop` refuses | The failure stands: gitkit keeps the worktree and reports the exit code, because the worktree is the only handle on the database. (Defaulted, Q7.) |
| `database-d1` | It ships `db:prune` as a script that drops nothing and says why: each D1 database lives in `apps/api/.wrangler/state` and goes with the worktree. Both drivers then expose the same `db:*` commands. |
| Delivery order | Phase 1 is its own issue and PR, filed and built first, because it fixes a live data-loss path. (Defaulted, Q5.) |
| Tests | Unit tests with `node:test` beside the source in `modules/database-postgres/files/scripts/lib/`, run by `pnpm test:modules`, as `branch-name.test.ts` does. They stay out of `scaffolds[].files`. The end-to-end check runs in the `.dev/playground` with the local Docker daemon. |
| Attended phases | None. Every phase, Phase 4 included, can run unattended. (Defaulted, Q12.) |

## Approach

Fix the two defects first, because the worktree flow makes the inference defect likely to fire. Then write the mapping and add `db:prune` beside `db:drop`. Then declare the worktree setup, which calls the fixed scripts.

Reuse:

- `assertManagedDatabase`, `branchDatabaseName`, `testDatabaseName` and `databasePrefix` in `lib/branch-name.ts` for every name.
- `loadContext`, `resolveState`, `withSql`, `readFlags`, `run` and `say` in `lib/context.ts`.
- `server.createDatabase`, `server.dropDatabase`, `server.adminUrl`, `docker.adminUrl` and `docker.ensureRunning` in `backends/`.
- gitkit `prepare` for when the blocks run, and its `gitkit-prepared` marker for when teardown may run.

Rejected: a git `post-checkout` hook that runs `db:setup`. It conflicts with husky, runs on every branch switch in place, and duplicates what gitkit `prepare` already does with a marker and a teardown. Rejected for the prune rule: proof of merge from git alone (a recorded tip SHA, or parsing merge and squash commit text), because a squash merge never makes the branch an ancestor of the default branch.

### Phase 1: make the guards safe for worktrees

- Change `resolveState` so it infers a block only when the URL's database equals `context.database`, for the neon.new rule too.
- Make `db:setup` print one line when it ignores a copied `DATABASE_URL` for another database, then create this branch's database as now.
- Change `drop.ts` so it also drops `testDatabaseName(state.database)` on the same admin URL, and says so in its output. On neon, drop the test database in the same project.
- Add unit tests: inference from a URL for another managed database returns nothing; inference for this checkout's database returns a block; the test database name passes `assertManagedDatabase`.
- Update the "The state block" and "`db:drop` refuses; it does not ask" sections of `modules/database-postgres/skills/saasaloy-database-postgres/SKILL.md`, and the state block entry in `CONTEXT.md`.

Done when: in a playground worktree on a branch, with `apps/api/.env` copied from the main checkout and `db:setup` stopped before `create` (container down), `pnpm db:drop` prints "This checkout has no development database. Nothing to drop." and the main database still exists. After a normal `db:setup` and `pnpm test`, `pnpm db:drop` removes both `<db>` and `<db>_test` (`psql -l` shows neither). `pnpm test:modules` passes.

### Phase 2: write the mapping and add `pnpm db:prune`

- Add `lib/mapping.ts`: `cloneId(root)`, `formatMapping(...)` and `parseMapping(comment)`, which returns `undefined` for a comment that is not a saasaloy mapping. Add `lib/mapping.test.ts`.
- Make `db:setup` write the mapping after it creates or reuses the database, and make `test-setup.ts` write it on the test database. A re-run rewrites it, so a database made before this change gets mapped on its next `db:setup`.
- Add a pure function in `lib/prune.ts`: given the prefix, this clone's id, each database with its parsed mapping and session count, the local and remote branch names, and a merged-PR lookup, return the candidates and the skipped databases, each with a reason (`default`, `branch open`, `foreign, no merged PR`, `foreign, gh missing`, `unmapped`, `in use`). Add `lib/prune.test.ts` with a case for each reason.
- Add `scripts/prune.ts`: read the flags `--apply`, `--include-unmapped` and `--server`; pick the server as the decisions table says; list `pg_database` names that pass `assertManagedDatabase` with their comments, sizes and session counts; read branches with `git for-each-ref refs/heads refs/remotes`; call `gh` only for foreign mapped databases, and only when `command -v gh` succeeds.
- Without `--apply`, print each candidate with its size, each skipped database with its reason, and the command to drop the candidates. With `--apply`, drop each candidate through `server.dropDatabase` and print what it dropped.
- Register the scripts: `db:prune` in `packages/db/package.json` (`node scripts/prune.ts`) and the root `package.json` (`pnpm --filter @repo/db db:prune`), with `package-json-script` patches in `modules/database-postgres/registry-item.json`, and the new files in `scaffolds[].files`.
- In `modules/database-d1`, add `scripts/prune.ts` that prints why there is nothing to prune, plus the same two script patches.
- Add a "`db:prune`" section to both driver skills, and a glossary entry for the database mapping in `CONTEXT.md`.

Done when: in the playground on the docker backend, with mapped databases for `main`, an open branch `feat-a`, a deleted branch `feat-b` (development and test), a database whose mapping names another clone and a deleted branch, and one unmapped database, `pnpm db:prune` lists only the two `feat-b` databases as candidates and lists the foreign and unmapped databases as skipped with their reasons. `pnpm db:prune --apply` drops the two `feat-b` databases, and `psql -l` still shows every other one. With a `psql` session open on a candidate, `--apply` skips it and names it. `pnpm test:modules` passes.

### Phase 3: declare the worktree setup

- Add a `## Worktree setup` section to `packages/cli/templates/base/AGENTS.md`:
  - `setup:` stops with a message naming `saasaloy env` when `"$GITKIT_REPO/packages/env/.env"` is missing; symlinks `packages/env/.env` to it when the worktree has none; then runs `pnpm install --frozen-lockfile`, `pnpm env:setup`, `pnpm run --if-present db:setup` and `pnpm run --if-present db:seed`.
  - `update:` runs `pnpm install --frozen-lockfile`, `pnpm env:setup` and `pnpm run --if-present db:setup`.
  - `teardown:` runs `pnpm run --if-present db:drop`.
  - `watch:` lists `packages/db/migrations/**` and `packages/env/.env.example`.
- Add one paragraph under the section: gitkit runs these blocks; a person without gitkit runs the same commands by hand; `pnpm db:prune` cleans up after worktrees that gitkit did not prepare.
- Point to the section from the lifecycle section of both driver skills.

Done when: `saasaloy init` in `.dev` writes an `AGENTS.md` whose `## Worktree setup` section gitkit `prepare` reads with no "broken declaration" error. `saasaloy update` on an existing playground adds the section. `pnpm lint` passes.

### Phase 4: prove the lifecycle end to end

- In a playground with `database-postgres` on the docker backend: create a worktree with gitkit, let `prepare` run, then run `pnpm dev` and `pnpm test` in it. Check that `packages/env/.env` in the worktree is a symlink to the main checkout's file.
- Remove the worktree with gitkit and check that teardown drops both databases.
- Create a second worktree by hand with `git worktree add` (no marker), run `db:setup` there, remove the worktree and delete its branch, then run `pnpm db:prune` and `pnpm db:prune --apply` from the main checkout.
- Repeat the first two steps with `database-d1`, where teardown and prune drop nothing.
- Write the QA record under `docs/qa/`.

Done when: after `prepare`, `pnpm db:status` in the worktree prints its own `<project>_dev_<branch>` with zero pending migrations and the seed rows exist, with no command typed by hand. After teardown and `pnpm db:prune --apply`, `psql -l` lists zero mapped databases from this clone whose branch is closed. The d1 run ends with no error.

## Open questions

None. The grill on 2026-11-15 settled every question, and none is deferred.

## Non-goals

- Adopting PGX, NeonD, or any copy-on-write branching engine.
- Copying data from the main database into a branch database. A branch starts from migrations and seed, as now.
- A git hook that runs setup on `git switch`.
- Pruning neon.new databases or stopping the docker container.
- Changing `db:drop` to prompt or to take `--yes`.
- Proof of merge from git history alone.
