# QA Plan: Simplify the code that works around D1 limits

_Generated 2026-11-21 · updated 2026-11-21 · against `b4b19ab6` (clean; the fix commit changed one descriptor row after the run at `65da3357`) · covers issue #372, plan 0120: 4 correctness sites, 10 clarity sites, notes and docs · the branch was rebased onto `main` at `4e9d1759`, which adds PR #376 (the database split change); the SHAs here are the rebased ones_

## Summary

- The branch closes four partial-write windows with Postgres transactions and removes code that only existed for D1.
- Working means each window rolls back on a failure, every existing test passes, and a 0.10.0 project updates with no conflict marker.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-372-simplify-the-code-that-works-around-d1-limits` at `b4b19ab6`.
- No UI changes. No dev server, credentials or feature flag is necessary.
- No screenshots. The change has no screen to judge.

Check out the branch with:

```sh
git switch issue-372-simplify-the-code-that-works-around-d1-limits
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Branch checked out, no project | The update notes tell a project owner what to do | 🟡 Normal |
| TC-1.2 | 1: Branch checked out, no project | The changelog lines read correctly for 0.11.0 | 🟢 Low |

## Scenario 1: Branch checked out, no project

**Setup.** Run once, for every case in this scenario.

1. Open the three new update notes and the changelog in the editor.

- [ ] Setup complete

### TC-1.1: The update notes tell a project owner what to do  ·  🟡 Normal

**Goal.** A project owner can act on each new update note without reading the code.

**Steps**

1. Read `modules/database-postgres/update-notes/0001-transaction-is-atomic.md`, `modules/payment/update-notes/0005-store-transaction.md` and `modules/subscription/update-notes/0003-store-transaction.md`.
   - [ ] Each note says what changes, what update merges, and what the owner does
     - the `What you do` steps work for a project-owned store or test fake
     - the `Verify` command proves the work is done

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The changelog lines read correctly for 0.11.0  ·  🟢 Low

**Goal.** The `## Unreleased` lines describe this change correctly for a release reader.

**Steps**

1. Read the `## Unreleased` section of `packages/cli/CHANGELOG.md`.
   - [ ] The breaking line and the four `Bug Fixes` lines are correct and easy to read

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. The cases only read files.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

The real-Postgres tests ran in a test scaffold at `.dev/afk-372/mvp`. It holds the MVP modules plus `cms`, `payment`, `payment-console`, `subscription`, `subscription-console`, `notification` and `storage-memory`, with testing on. Its Postgres ran in a private Docker container. Each fail-first run used the new test against the `origin/main` source of its site.

Commands run (one per block):

```sh
cd .dev/afk-372/mvp && pnpm exec vitest run apps/api/src/routes/cms.test.ts
```

```sh
cd .dev/afk-372/mvp && pnpm exec vitest run apps/api/src/subscription-store.test.ts
```

```sh
cd .dev/afk-372/mvp && pnpm exec vitest run apps/api/src/payment-store.test.ts
```

```sh
cd .dev/afk-372/mvp && pnpm exec vitest run apps/api/src/routes/auth.test.ts
```

```sh
cd .dev/afk-372/mvp && pnpm exec vitest run apps/api
```

```sh
pnpm test
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
SCAFFOLD_DATABASE_SERVER=postgres://postgres:postgres@127.0.0.1:55373/postgres pnpm scaffold:check
```

```sh
pnpm release:smoke --upgrade-only
```

```sh
git grep -n -E "TRANSACTION_IS_ATOMIC|ROWS_PER_INSERT|sqlite-core|UNIQUE constraint failed" -- 'modules/*/files' 'modules/*/skills' 'modules/*/registry-item.json'
```

```sh
git diff --quiet origin/main...HEAD -- modules/multitenant/files/db/tenant.ts modules/database/files/src/seed/id.ts modules/database-postgres/files/scripts/lib/seed.ts
```

- ✅ C1 · cms `publishEntry` → "keeps no revision and leaves the entry a draft when a later publish write fails" fails on `origin/main` source (`current transaction is aborted`, after the partial write) and passes after `91d6c9a1`.
- ✅ C2 · subscription `applyEvent` → "keeps no event row when the upsert fails, so the redelivery applies" fails on `origin/main` source and passes after `7e980c31`. The same test redelivers the event and sees it apply.
- ✅ C3 · payment `move` → "leaves the status unchanged when the event insert fails" fails on `origin/main` source and passes after `34c7357c`.
- ✅ C4 · auth sign-up → "keeps no user when the sign-up's account insert fails" fails on `origin/main` source and passes after `45151932`.
- ✅ C5 · `payment/files/api/payment-store.vitest.ts` and `subscription/files/api/subscription-store.vitest.ts` exist, with descriptor rows `when: { testing: true }`. At `b4b19ab6` the payment row also needs `installed: ["payment-console"]`, because the test pays through the console provider (acceptance blocker B1). A fresh project with `payment` and `payment-manual` gets no `apps/api/src/payment-store.test.ts`; one with `payment-console` gets it.
- ✅ C6 · the grep over module code, skills and descriptors prints nothing. Over all of `modules` it prints 6 lines, all in the `database-postgres` update note that names the removed constant.
- ✅ C7 · `adminWrite` always rethrows and has no `unaudited` kind; the audit insert is one statement; the search uses `ilike` (`1590952a`). The admin route tests pass.
- ✅ C8 · `setPreferences` runs in one `transaction(db, …)`; the notifications test inserts 21 rows in one statement (`9266af4b`).
- ✅ C9 · `seed/apply.ts` writes one multi-row upsert per step, and `seed/table.ts` has no SQLite branch (`818d019b`). `pnpm --filter @repo/db db:seed` exits 0 twice on the scaffold, with the same row counts.
- ✅ C10 · at `65da3357`: `pnpm test` exits 0 (0 failures in each node pass), `pnpm lint` exits 0, `pnpm typecheck` exits 0. `pnpm scaffold:check` passes: 34 test files, 439 tests, then `pnpm check` green. `pnpm test:modules` gives 1701 passes.
- ✅ C10 · scaffold api suite → 20 files, 188 tests pass (baseline at `origin/main`: 18 files, 182 tests).
- ✅ C10 · at `b4b19ab6` (the B1 fix): `pnpm test` exits 0 with 0 failures, `pnpm lint` exits 0, `pnpm docs:check` exits 0. The other results above ran at `65da3357`; the fix changes only the payment descriptor row, which none of them reads except `scaffold:check` and C12, both of which install `payment-console`.
- ✅ C11 · `pnpm docs:check` exits 0 and `pnpm docs:stale` exits 0. The update notes, the five module skills, `docs/wiki/why-postgres.md` section 2 and the changelog are in `65da3357`.
- ✅ C12 · `pnpm release:smoke --upgrade-only` → "upgrade from 0.10.0 lists all 1 expected update notes", `database-postgres/0001-transaction-is-atomic` listed.
- ✅ C12 · a project made with `saasaloy@0.10.0` with `admin`, `cms`, `payment`, `payment-console`, `subscription` and `subscription-console`, then `saasaloy update --yes` with this branch's CLI → 130 files updated, 0 conflict markers, no `TRANSACTION_IS_ATOMIC` left.
- ✅ C13 · the kept files `tenant.ts`, `seed/id.ts` and `scripts/lib/seed.ts` are unchanged.

## Not covered / needs human judgment

- A real vendor webhook redelivery (Stripe) after a failed upsert. The test drives `applyEvent` with a normalized event. A live vendor account is necessary for the full path.
- Organization create plus its owner member stays outside a transaction. better-auth 1.7.7 does not wrap it, so the plan leaves it as an upstream gap.
- `payment` `create` still writes the payment row and its opening event as two statements. The plan scopes site 3 to `move`.
- Concurrency and performance. The change adds no lock, and the plan names no performance target.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
