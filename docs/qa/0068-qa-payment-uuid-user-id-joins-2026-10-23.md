# QA Plan: payment admin joins with a uuid `users.id`

_Generated 2026-10-23 · against `4ba277e` (clean) · covers the three `users` joins in `modules/payment/files/api/payment-store.ts` (issue #221)_

## Summary
- The payment admin queries now join `users` on `CAST(users.id AS TEXT)`, so a project whose `users.id` is a `uuid` gets the payer and staff emails.
- Working means `GET /admin/payment/payments`, `GET /admin/payment/payments/:id` and the review calls return 200 with emails on Postgres `uuid`, Postgres `text` and D1.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-221-the-admin-queries-fail-when-users-id-is-a-uuid`.
- A scaffolded project that has the `payment`, `payment-manual`, `admin` and `database-postgres` modules, and a staff user who can open the admin payments page.
- The project's `users.id` column is a `uuid` (Better Auth `generateId: "uuid"` with a `uuid` primary key). brainaloylabs/primeshopr is one such project once it removes its local `users.id::text` cast.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: uuid project with one submitted manual payment | The staff queue and the detail page show the emails | 🔴 Critical |
| TC-1.2 | 1: uuid project with one submitted manual payment | A confirm returns success, not a 500 | 🔴 Critical |

## Scenario 1: uuid project with one submitted manual payment

**Setup.** Run once, for every case in this scenario.

1. Sign in as a shopper and start a manual payment.
2. Submit a transaction id for that payment, so the payment status is `submitted`.
3. Sign in to the admin app as a staff user in a second browser.

- [ ] Setup complete

### TC-1.1: the staff queue and the detail page show the emails  ·  🔴 Critical

**Goal.** The admin payment reads work when `users.id` is a `uuid`.

**Steps**

1. Open the admin payments page and select the `submitted` filter.
   - [ ] The page loads, and the payment row shows the shopper's email
2. Open the payment detail.
   - [ ] The detail shows the shopper's email and the payment history

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: a confirm returns success, not a 500  ·  🔴 Critical

**Goal.** A staff review returns success, and the history names the staff member.

**Steps**

1. On the payment detail, confirm the payment.
   - [ ] The page shows the payment as `successful`, with no error message
   - [ ] The history row for the confirm shows the staff user's email

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** The confirm cannot be undone in the app. Start a new manual payment for the next run.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm run lint
```

```sh
pnpm run typecheck
```

```sh
pnpm run test
```

```sh
pnpm --filter saasaloy exec vitest run src/commands/update.test.ts
```

```sh
pnpm run test:modules && pnpm run test:base && pnpm run test:tooling && pnpm run test:scripts
```

- ✅ `pnpm run lint` → exit 0.
- ✅ `pnpm run typecheck` → exit 0.
- ❌ `pnpm run test` → exit 1. Two tests in `packages/cli/src/commands/update.test.ts` timed out at 5000 ms while a Postgres container ran beside the suite. 1441 of 1443 tests passed. The change does not touch the CLI.
- ✅ `update.test.ts` run alone → 34 of 34 passed.
- ✅ `test:modules`, `test:base`, `test:tooling`, `test:scripts` → exit 0 each. The `&&` chain in `pnpm run test` did not reach them after the timeout.

### Database checks
_A throwaway `postgres:17-alpine` container on `127.0.0.1:55221` and an in-memory `node:sqlite` database, removed after the run. The agent built the three queries with Drizzle 0.45.3 and the module's own `payment.pg.ts` and `payment.sqlite.ts` tables, with one payer row and one staff row in `users`._

The join SQL that Drizzle generates after the fix:

```sh
psql "$DATABASE_URL" -c "select p.id, u.email from payments p left join users u on CAST(u.id AS TEXT) = p.user_id;"
```

- ✅ Postgres `uuid` id, before the fix → `operator does not exist: uuid = text`. This reproduces the issue.
- ✅ Postgres `uuid` id, after the fix → `listPayments` and `paymentDetail` return `payer@x.test`; the events join returns `null` for the creation event and `staff@x.test` for the confirm.
- ✅ Postgres `text` id, after the fix → the same emails.
- ✅ SQLite (the D1 dialect), after the fix → the same emails. `CAST(... AS TEXT)` is valid SQLite, where `::text` is a syntax error.

## Not covered / needs human judgment
- The full admin flow in a real project with a `uuid` `users.id`. The base template's auth schema uses a `text` id, so no local scaffold has a `uuid` id without manual edits.
- Query speed on a large `users` table. The cast stops Postgres from using the `users` primary key index for the join. The admin queue reads at most one page of payments, so the agent judges the cost small.
- UI, accessibility and compatibility. The change touches no screen.
- Concurrency. The change touches reads only.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
