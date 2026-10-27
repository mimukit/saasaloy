# QA Plan: Ship unit, route and schema tests behind the testing mode

_Generated 2026-10-25 · against `c6f0916c` (clean) · covers issue #243, plan 0080 Phases 4–6_

## Summary
- With testing on, a project gets the module unit tests, a route test per route-owning module, and a `db:check` schema drift gate.
- Working means `pnpm test` passes in a project with every module on both drivers, and fails at `db:check` on a schema edit with no migration.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Worktree: `~/worktrees/saasaloy/issue-243-ship-unit-route-and-schema-tests-behind-the-testing`, branch `issue-243-ship-unit-route-and-schema-tests-behind-the-testing`.
- The playground is `.dev/playground`. It is disposable. `pnpm play:reset` rebuilds it.
- Docker must run for the Postgres scenario.

Build the CLI with:

```sh
pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh project with testing off | No module test ships | 🔴 Critical |
| TC-2.1 | 2: Every module on D1, testing on | Read the route tests | 🟡 Normal |

## Scenario 1: Fresh project with testing off

**Setup.** Run once, for every case in this scenario.

```sh
node packages/cli/dist/index.js init .dev/qa-off --no-install --testing=off
```

```sh
cd .dev/qa-off && cp ../../scripts/saasaloy-shim.sh saasaloy && chmod +x saasaloy && ./saasaloy add kv kv-memory waitlist database-d1 --yes
```

- [ ] Setup complete

### TC-1.1: No module test ships  ·  🔴 Critical

**Goal.** A project with testing off receives no module test file and no `test:prepare` script.

**Steps**

1. List the test files in the project.

   ```sh
   find apps packages -name '*.test.ts' -not -path '*/node_modules/*' -not -path 'packages/env/*' -not -path 'packages/tooling/*' -not -path 'packages/config/*'
   ```

   - [ ] The command prints nothing
2. Read the root scripts.

   ```sh
   grep -n '"test' package.json
   ```

   - [ ] `test` is present and `test:prepare` is absent

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
cd ../.. && rm -rf .dev/qa-off
```

## Scenario 2: Every module on D1, testing on

**Setup.** Run once. It scaffolds every module except `e2e`, `api-keys-user` and `database-postgres` with `--testing=tests-after`.

```sh
/tmp/i243/play.sh d1
```

- [ ] Setup complete

### TC-2.1: Read the route tests  ·  🟡 Normal

**Goal.** Each new route test reads as a fair test of its route, and each missing `401`, `403` or `400` case has an honest reason.

**Steps**

1. Open the nine new files under `.dev/playground/apps/api/src/routes/`: `admin-users`, `billing`, `feature-flags`, `tenant`, `projects`, `payment`, `admin-payment`, `storage`, `waitlist` (each `.test.ts`).
   - [ ] Every header states which of the four cases apply, and the reason for each one that does not
     - waitlist and payment callbacks: public, so no 401 and no 403
     - storage: a token, not a session, so no 401
     - billing: the subject is always the caller, so no 403
     - admin-users and tenant: no input, so no 400
   - [ ] The 403 "wrong role" trick, demoting the admin row behind a live session, is an acceptable test

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.**

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run in the repo at `c6f0916c` unless stated:

```sh
pnpm lint
```

```sh
pnpm test -- --concurrency=2
```

```sh
pnpm typecheck
```

```sh
node --test scripts/module-tests.test.ts scripts/route-tests.test.ts scripts/test-file-gates.test.ts
```

- ✅ C14 `pnpm lint` → exit 0 on all four passes (at `5e3d31ea`; `c6f0916c` changes one comment line only).
- ✅ C3 `pnpm test` → CLI 1817 tests, `test:modules` 69 files / 1060 tests on Vitest, `test:base` 91, `test:tooling` 111, `test:scripts` 637, 0 failed. `test:modules` makes no network call.
- ✅ C1 `find modules -path '*/files/*' -name '*.test.ts'` → nothing. 67 former `node:test` files are `.vitest.ts`. `main` ran 997 node tests plus 36 Vitest tests; the branch runs 1060, because the lint fixes split some tests.
- ✅ C2 each converted test has an entry targeting `<name>.test.ts` with `when: { testing: true }`, except five repo-only tests (four read both dialect variants or a descriptor pin; `env-infisical` lands in `packages/env`, which runs `node:test`). `scripts/test-file-gates.test.ts` passes.
- ✅ C4 `scripts/module-tests.test.ts` → passes on every descriptor; its fixture case fails a scaffold that drops one test entry. 51 scaffold files carry an `untested` reason.
- ✅ C9 `scripts/route-tests.test.ts` → every `@api/routes/<name>.ts` has a route test; its fixture case fails a descriptor that drops one.
- ✅ C5 `.agents/skills/create-module/SKILL.md` states the unit-test and route-test rule.
- ✅ C6 shim changes: 23 repo-only shim files and 5 `node:module` resolve hooks were removed. 3 tests needed an import moved to its project path (`api-key-rules`, `tenant-rules`, `entitlements`), and 1 test moved to `apps/api` because `packages/queue` already depends on `packages/billing`.
- ✅ C7, C8 nine route tests ship under `when: { testing: true }`, with `installed` where they need a local provider. `auth` and `health-db` were already gated.
- ✅ C10 D1 playground, every module, `--testing=tests-after`, at `c6f0916c`: `pnpm test` → `db:check` passes, 76 files / 1084 tests pass. `turbo run typecheck` → 0 errors.
- ✅ C10 Postgres playground at `5e3d31ea` + the payment type fix: `pnpm test` → 79 files / 1152 tests pass; `turbo run typecheck` → 0 errors. The later commits change test typing, two shell tests and the api timeout; each was re-checked on its own, not in a full Postgres rerun.
- ✅ C11, C12 both drivers ship `scripts/check.ts` and `db:check`; the root `test` runs `pnpm run --if-present test:prepare`, and the driver sets `test:prepare` to `pnpm db:check` only with testing on.
- ✅ C13 D1 playground: adding `note: text("note")` to `waitlist_entries` with no `db:generate` → `pnpm test` exits 1 with "db:check: the schema has changes no migration holds", and `packages/db/migrations/` keeps its one migration. After `pnpm --filter @repo/db db:generate`, `pnpm test` exits 0.
- ❌ Playground `pnpm lint` (`lint:types`) → `packages/ui/src/blocks/shell/data-table.tsx:271:5 typescript(consistent-return)`. This branch does not change that file. Claimed pre-existing; see `.afkkit/orientation.md`.

### Browser checks
_None. The change has no UI._

## Not covered / needs human judgment
- A real Cloudflare or vendor run: every test uses the local providers.
- Coverage numbers and the nightly playground run are out of scope (plan 0080, Phase 9).
- Compatibility, accessibility and performance do not apply: the change ships tests and a script, not a screen.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
