# QA Plan: payment-bkash provider

_Generated 2026-10-25 · against `a66e0e5e` (clean) · covers issue #215: the `payment-bkash` module, the payment provider env port, and ADR 0057_

## Summary

- `payment-bkash` takes one-off payments on bKash Tokenized Checkout, settles them from bKash's own answers, refunds them, and keeps its token in `kv` on a schedule.
- Working means a sandbox payment, a cancel and a refund each leave the right row state, and the token job ticks every 15 minutes.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-215-add-the-bkash-payment-provider` at `a66e0e5e` or later.
- bKash sandbox credentials from <https://developer.bka.sh>: app key, app secret, username, password.
- A bKash sandbox wallet number. The sandbox PIN is `12121` and the OTP is `123456`.

Scaffold the playground from the worktree root:

```sh
pnpm play:init
```

Add the modules from inside `.dev/playground`:

```sh
./saasaloy add database-d1 payment payment-bkash kv-memory queue-memory -y && pnpm install
```

Enter the env values. Use `PAYMENT_PROVIDER=bkash`, `KV_PROVIDER=memory`, `QUEUE_PROVIDER=memory`, the four `BKASH_*` credentials, and leave `BKASH_MODE` unset:

```sh
./saasaloy env && pnpm env:setup
```

Migrate the local database and start the app:

```sh
pnpm db:generate && pnpm db:migrate:local && pnpm run dev
```

Sign in to the admin app as a staff user. Get a session cookie for the api and export it with the api origin:

```sh
export API=http://localhost:8787 COOKIE='better-auth.session_token=<your session token>'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Sandbox configured, no payments | A sandbox payment completes and settles | 🔴 Critical |
| TC-1.2 | 1: Sandbox configured, no payments | A refund succeeds | 🔴 Critical |
| TC-1.3 | 1: Sandbox configured, no payments | A cancelled checkout leaves the payment cancelled | 🔴 Critical |
| TC-1.4 | 1: Sandbox configured, no payments | The token job runs on its schedule | 🔴 Critical |

## Scenario 1: Sandbox configured, no payments

**Setup.** Run once, for every case in this scenario.

1. Confirm that the api answers and lists the `bkash` method. The app needs a shopper route that calls `createPayment(c.env).create(...)`; the `saasaloy-payment` skill shows one. Add it to `apps/api` if the project has none.

- [ ] Setup complete

### TC-1.1: A sandbox payment completes and settles  ·  🔴 Critical

**Goal.** A bKash sandbox payment moves its row from `pending` to `successful` with bKash's trxID.

**Steps**

1. Through your shopper route, create a payment with method `bkash`, amount `49900`, currency `BDT`, and a `returnUrl` on `http://localhost`.
   - [ ] The answer is a redirect to a `sandbox.bka.sh` page
2. Open that URL. Pay with the sandbox wallet, PIN `12121` and OTP `123456`.
   - [ ] bKash sends the browser back through `/payment/callback/bkash/return/<id>` to your `returnUrl`
3. Open the payment on the admin Payments page.
   - [ ] The payment reads `successful`, amount 499.00 BDT, with a transaction id that matches bKash's trxID

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A refund succeeds  ·  🔴 Critical

**Goal.** A refund of a settled bKash payment goes through bKash's refund API and records bKash's refund id.

**Steps**

1. On the admin Payments page, refund 100.00 BDT on the payment from TC-1.1, with the note `qa refund`.
   - [ ] The page shows the refund with a bKash refund transaction id, and the refunded amount reads 100.00 BDT
2. Find the payment in the bKash sandbox merchant portal.
   - [ ] The portal shows the refund against the original trxID

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A cancelled checkout leaves the payment cancelled  ·  🔴 Critical

**Goal.** A payer who cancels on bKash's page leaves the row `cancelled`, not `pending`.

**Steps**

1. Create a second payment as in TC-1.1, step 1, and open the bKash URL.
2. Click the cancel button on bKash's page.
   - [ ] bKash sends the browser back to your `returnUrl`
3. Open the payment on the admin Payments page.
   - [ ] The payment reads `cancelled`, and its history shows `pending → cancelled`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: The token job runs on its schedule  ·  🔴 Critical

**Goal.** The `payment.bkash.token` job fires every 15 minutes and keeps a usable token in `kv`.

**Steps**

1. With `pnpm run dev` running, trigger the scheduled handler at a quarter-hour minute. Wrangler serves it at `/__scheduled`:

   ```sh
   curl -i "$API/__scheduled?cron=*/15+*+*+*+*"
   ```

   - [ ] The api log shows the `payment.bkash.token` job run with no error
2. Create one more payment as in TC-1.1, step 1.
   - [ ] The create answers a bKash redirect, so the stored token works

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run in the worktree:

```sh
pnpm lint
```

```sh
pnpm test:modules
```

```sh
pnpm test:scripts
```

```sh
pnpm deps:check
```

Commands run on the declared disposable target `.dev/playground` (reset with `pnpm play:destroy` afterwards):

```sh
pnpm play:init
```

```sh
./saasaloy add database-d1 payment payment-console payment-bkash kv-memory queue-memory -y
```

```sh
pnpm exec turbo run typecheck --concurrency=2
```

```sh
pnpm run lint:code && pnpm run format:check
```

```sh
pnpm lint
```

- ✅ `pnpm lint` → exit 0, oxlint, Stylelint and Prettier clean.
- ✅ `pnpm test:modules` → 1020 pass, 0 fail, including 23 in `modules/payment-bkash/files/bkash.test.ts`.
- ✅ `bkash.test.ts` covers: create answers bKash's page and keeps the paymentID; a non-BDT payment fails; a create refusal maps to `invalid_request` with providerCode `2001`; a success return executes and settles with the trxID; `2062` falls through to `payment/status`; an underpayment throws `mismatch` and leaves the row `pending`; a cancel return re-reads status and moves the row to `cancelled`; a cancel that bKash reports completed settles; a failure return moves the row to `failed`; a wrong paymentID is refused as `callback_invalid`; the webhook settles from a status re-read; an unknown notification is ignored; a non-bKash SubscribeURL is never fetched; a refund sends the right body and stores `refundTrxID`; a refused refund maps its code; the schedule is `*/15 * * * *`; the job does nothing, refreshes, or grants by the token's age; the registered job reads env through `paymentProviderEnv()`; a concurrent cold start is told to retry.
- ✅ Three deliberate breaks (amount check, cancel mapping, refresh window) each turned one test red, and the restore turned them green.
- ✅ `pnpm test:scripts` → 469 pass, 0 fail, including the env-preset and descriptor checks for `payment-bkash`.
- ❌ `pnpm deps:check` → exit 1, "90 outdated · 83 up-to-date". `payment-bkash` declares no npm dependency; the acceptance check verifies this claim on `main`.
- ✅ playground `saasaloy add` → exit 0. `bkash()` is in `packages/payment/src/index.ts` providers, `bkashEnv()` in the payment preset, `bkashTokenJob()` and `bkashTokenSchedule()` in `packages/queue/src/index.ts`, `@repo/kv` in `packages/payment/package.json`, `@repo/payment` in `packages/queue/package.json`, and `setPaymentProviderEnv(env)` in `apps/api/src/payment-store.ts`.
- ✅ playground typecheck → 13 of 13 tasks pass.
- ✅ playground `lint:code` and `format:check` → exit 0.
- ❌ playground `pnpm lint` → `lint:types` exits 1 on `packages/ui/src/blocks/shell/data-table.tsx:271:5 consistent-return`. That file comes from `modules/shell`, which this branch does not change.

### Browser checks

_None. The change has no UI of its own, and the only pages it reaches are bKash's hosted checkout, which needs sandbox credentials._

## Not covered / needs human judgment

- Every sandbox case needs the owner's bKash credentials, so the agent ran none of them.
- The webhook cannot be tested in the sandbox. bKash registers a listener URL only during live onboarding.
- The two-calls-an-hour token limit is not tested live. A test that hits it blocks the app key for one hour.
- Accessibility, compatibility and UX: the module adds no screen.
- Performance: not relevant; each payment makes two or three bKash calls.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
