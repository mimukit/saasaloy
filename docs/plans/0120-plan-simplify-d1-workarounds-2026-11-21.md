# Plan: simplify the code that works around D1 limits

Grilled: 2026-11-21

Issue: [#372](https://github.com/mimukit/saasaloy/issues/372). Sources: [`0117-plan-postgres-only-2026-11-20.md`](0117-plan-postgres-only-2026-11-20.md) (the row "Code that works around a D1 limit"), ADR 0065, and the comment rewrites of PR #374 (`git diff cf74ae83^1 cf74ae83 -- 'modules/*/files/**'`).

## Context

#366 kept every code shape that D1 forced and rewrote only the comments. Postgres now gives an interactive transaction, 65,535 bound parameters a statement, and `ilike`. Some of the old shapes leave a partial write that a transaction would close. The others only cost a reader time.

An inventory of `origin/main` at `cf74ae83` found 21 sites in 9 modules, not "about 50 places in 14 modules". The issue counted the 46 files whose comments PR #374 rewrote. `feature-flags`, `waitlist`, `file-uploads`, `sms`, `teams`, `api-keys-*` and `ecommerce` have no code that D1 shaped.

Every module file is class `merged` unless its entry carries `seed: true` (`engine/classes.ts`). None of the files below is `seed: true`. So `update` merges each change three ways into a project, and a project edit survives.

Goal: no module keeps a partial-write window that exists only because D1 had no transaction, and no code reads as if a second dialect could return.

Target: 4 correctness sites closed and each proved by a test that fails before the change on real Postgres; 0 readers of `TRANSACTION_IS_ATOMIC` in `modules/` (baseline 2 files, 6 lines).

## The call sites

| # | Site (`origin/main`) | Shape today | Change | Class |
|---|---|---|---|---|
| 1 | `cms/files/db/repositories/cms.ts:411-497` `publishEntry` | Insert the revision, version-checked update, a compensating `delete` on a lost race, then the redirect writes and a prune | One `db.transaction`. Drop the compensating delete. | Correctness: a failed compensating delete leaves an orphan revision; a failed redirect write after the update leaves the entry live, a 5xx answer, and stale redirects. |
| 2 | `subscription/files/src/subscription.ts:149-223` `applyEvent` | `recordEvent` commits the dedupe row first, then upsert, patch and `markEventProcessed` | One transaction over `recordEvent`, the upsert, the `lockedAt` patch and `markEventProcessed`. The email goes after the commit, and the `reminderSentAt` patch after the email. | Correctness: if `upsertSubscription` throws, the vendor redelivery reads as a duplicate and the projection never gets the event. |
| 3 | `payment/files/src/define.ts:171-201` `move` | `transition` commits, then `appendEvent` | A narrow transaction over the two writes, never over a vendor call | Correctness: outside `staffWrite`, a failed event insert leaves a status change with no `payment_events` row. |
| 4 | `auth/files/src/auth.ts:117` `drizzleAdapter(authDb, …)` | No `transaction` option, so Better Auth writes sign-up user and account, or organization and member, as separate statements | `transaction: true`. The `authDb` proxy already binds `transaction` to the request client (`db-scope.ts` about line 102). better-auth 1.7.7 then wraps email sign-up, OAuth user creation, verification consume, account link, invitation accept and the team writes. Organization create plus its owner member stays outside a transaction, because 1.7.7 does not call `runWithTransaction` there (`crud-org.mjs:74`). Rewrite the comment at `db-scope.ts:73`. | Correctness |
| 5 | `database-postgres/files/src/client.ts:194` `TRANSACTION_IS_ATOMIC` | A constant `true` | Delete it, with a CHANGELOG line | Clarity |
| 6 | `admin/files/api/lib/admin-write.ts:193-200, 324-334` `adminWrite` | `if (TRANSACTION_IS_ATOMIC) throw` else keep the answer as `unaudited` | Always rethrow. Drop the `unaudited` kind. | Clarity: the else branch is dead. |
| 7 | `admin/files/api/routes/admin-write.vitest.ts:140, 181` | Test names and expectations branch on the flag | Fixed expectations | Clarity |
| 8 | `admin/files/db/repositories/audit.ts:35, 59-64` `insertAuditEvents` | `ROWS_PER_INSERT = 9` loop for the 100-parameter cap | One insert | Clarity in `adminWrite`; closes a small gap in `adminAuthWrite`, where more than 9 rows run as several statements |
| 9 | `audit.ts:117-119` | `lower(x) like … escape` | `ilike` | Clarity |
| 10 | `notification/files/db/repositories/notifications.ts:213-224` `setPreferences` | One statement per category, no transaction | One `db.transaction`, no new test | Clarity: a client retry already repairs a half-applied body |
| 11 | `notifications.vitest.ts:201-204` | Splits 21 rows into 11 and 10 for the cap | One insert | Clarity |
| 12 | `payment/files/api/payment-store.ts:414-438` `isUniqueViolation` | Also matches SQLite's `UNIQUE constraint failed` | `code === "23505"` only | Clarity |
| 13 | `database/files/src/seed/apply.ts:18-33` | One insert a row, typed "ready to await or to batch" | One multi-row insert a plan step, typed for a Postgres database or transaction | Clarity |
| 14 | `database/files/src/seed/table.ts:4, 18-39` | A SQLite branch and a `drizzle-orm/sqlite-core` import | The Postgres branch only | Clarity |

Kept as they are, because the shape is right on Postgres too: `adminAuthWrite` (Better Auth commits its own write), `cms.ts:705` `rerenderLiveRevisions` (an idempotent script), the `CAST(… AS TEXT)` in `payment-store.ts:252` (Postgres has no `uuid = text` operator), the refund reserve and release in `define.ts:458-471` (no transaction may span the vendor call), `seed/id.ts` (slices need the ids for cross-references) and `database-postgres/files/scripts/lib/seed.ts:149` (already a transaction).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Scope | The 14 sites above. The 6 kept sites and `multitenant/files/db/tenant.ts:46` `DialectTable` (a type name only) get no change (grill Q8, defaulted). A comment that still explains a D1 shape after its code changes is rewritten in the same commit. |
| One transaction rule | A transaction never spans a vendor call (payment gateway, email, Better Auth's own write). The plan follows the rule that `define.ts` and `ecommerce` checkout already follow. |
| Proof per correctness site | A real-Postgres `.vitest.ts` test that injects a failure after the first write and asserts no partial row. The test fails on `origin/main` and passes after the change. The harness (`@repo/db/testing`) runs each test in a transaction, and a nested `transaction()` becomes a savepoint (`client.ts:174-176`), so a rollback test works. |
| Outward actions | The build of #372 takes an issue branch, commits, a push, and one pull request. No merge, and no comment on another issue (grill Q11, asked). |
| Test runner | Vitest on real Postgres through the existing `.vitest.ts` harness, beside each source. `payment` and `subscription` have no real-Postgres store test yet; Phase 1 adds one each, in the shape of `admin-write.vitest.ts`. |
| Schema | No schema change. |
| Release | 0.11.0, with the Postgres-only change and plan 0119. The 0.11.0 tag waits for this build (grill Q4, asked). |
| Order against plan 0119 | Independent. Plan 0119 keeps both modules and moves no file, so the two builds share only `packages/cli/CHANGELOG.md`. |
| Email in `applyEvent` | After the commit. At most one email goes out, and a crash after the commit loses that one email. A dunning email sent twice costs more trust than one lost reminder (grill Q5, asked). |
| Better Auth transactions | In scope, proved by a real-Postgres test on email sign-up that fails the account insert and finds no `users` row. Organization create stays an upstream gap (grill Q6, defaulted). |

## Approach

Close the correctness sites first, each behind a test that fails first. Then do the clarity sites as one sweep. Then write the notes. No phase needs a person.

Rejected: a clarity-only sweep that leaves the four windows open (it skips the only part with user value); one transaction around every request handler (it would span vendor calls and Better Auth writes).

### Phase 1: the correctness sites

- Sites 1 to 4, each with its failing test first.
- New real-Postgres tests: `payment` store (`payment/files/api/payment-store.vitest.ts`) and `subscription` store (`subscription/files/api/subscription-store.vitest.ts`), registered in each descriptor under `when: { testing: true }`.

Done when: each of the 4 new tests fails on a checkout of `origin/main` with only the test added, and passes after the change; `pnpm test:modules` and `pnpm scaffold:check` with `testing` on pass.

### Phase 2: the clarity sweep

- Sites 5 to 14.
- Rewrite each comment that still names the old shape.

Done when: `git grep -n -E "TRANSACTION_IS_ATOMIC|ROWS_PER_INSERT|sqlite-core|UNIQUE constraint failed" -- modules` prints nothing; `pnpm test:modules`, `pnpm lint` and `pnpm scaffold:check` pass.

### Phase 3: notes and docs

- One update note in each module whose public surface changes: `database-postgres` for the removed `TRANSACTION_IS_ATOMIC`, and `auth` if site 4 changes how sign-up writes. A merged file needs no note for a change the merge carries.
- The module skills that describe a changed shape (`saasaloy-admin`, `saasaloy-payment`, `saasaloy-subscription`, `saasaloy-cms`, `saasaloy-database`).
- `docs/wiki/why-postgres.md` section 2 names the D1 shapes; mark which ones this change removed.
- `packages/cli/CHANGELOG.md` entry, and `pnpm docs:generate`, `pnpm docs:check`, `pnpm docs:stale`.

Done when: `pnpm docs:check` and `pnpm docs:stale` pass, and `release:smoke` updates a 0.10.0 project with `admin`, `cms`, `payment` and `subscription` with 0 conflict markers.

## Open questions

None. The grill of 2026-11-21 settled them.

## Non-goals

- The merge of the two database modules (plan 0119, #371).
- Any schema change.
- New `SELECT … FOR UPDATE` locks. Each race outside `ecommerce` is already closed by a conditional `UPDATE … WHERE`.
