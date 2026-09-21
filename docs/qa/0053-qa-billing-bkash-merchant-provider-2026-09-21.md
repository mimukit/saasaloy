# QA Plan: the bKash merchant billing provider

_Generated 2026-09-21 · against `67956ea` plus the uncommitted working tree · covers `modules/billing-bkash-merchant` and the Phase 1 provider env port in `modules/billing`_

## Summary

- `billing` gains `setBillingProviderEnv(env)` and `billingProviderEnv()`, so a provider's scheduled job can reach the Worker environment. `billing-bkash-merchant` adds bKash Tokenized Checkout behind the existing provider contract, and holds its gateway token on a quarter-hour job.
- Working means a project sets `BILLING_PROVIDER=bkash-merchant`, pays a real sandbox payment, gets an `active` row, is asked to pay again when the period ends, and never makes more than two bKash token calls in an hour.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-157-add-the-bkash-merchant-billing-provider-module`. Build: the working tree, uncommitted.
- You need a free bKash **sandbox** merchant app. Register at <https://developer.bka.sh>. Keep the app key, the app secret, the username and the password.
- You need bKash's sandbox wallet number, its PIN `12121` and its OTP `123456`.
- You need a public https tunnel to the api. bKash sends the customer's browser back to your api from the internet.
- You need no webhook listener. bKash provisions one by hand and offers none in sandbox. See _Not covered_.

Build the playground and install the modules:

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add queue-memory --yes && ./saasaloy add kv-memory --yes && ./saasaloy add billing-bkash-merchant --yes && pnpm install
```

Start the tunnel in its own terminal, and keep the https URL it prints:

```sh
cloudflared tunnel --url http://localhost:4000
```

Write `apps/api/.dev.vars`. Replace the four credentials:

```sh
cat >> apps/api/.dev.vars <<'VARS'
BILLING_PROVIDER=bkash-merchant
BILLING_APP_URL=http://localhost:3001/billing
BILLING_LOCKOUT_DAYS=14
QUEUE_PROVIDER=memory
KV_PROVIDER=memory
EMAIL_PROVIDER=console
EMAIL_FROM=billing@example.test
BKASH_MERCHANT_APP_KEY=<your app key>
BKASH_MERCHANT_APP_SECRET=<your app secret>
BKASH_MERCHANT_USERNAME=<your username>
BKASH_MERCHANT_PASSWORD=<your password>
BKASH_MERCHANT_MODE=sandbox
VARS
```

There is no callback URL to set. The provider builds it from the request's own origin, so the tunnel host is picked up on its own.

Price the `pro` plan in BDT. Open the plan table and give `pro` a `price`, and add a second paid plan priced in USD for TC-1.5:

```sh
$EDITOR packages/billing/src/plans.ts
```

```ts
{
  id: "pro",
  name: "Pro",
  features: { export: true, prioritySupport: true },
  limits: { projects: -1, seats: 10 },
  price: { monthly: { amount: 49_900, currency: "BDT" } },
},
{
  id: "dollars",
  name: "Dollars",
  price: { monthly: { amount: 4900, currency: "USD" } },
},
```

Set the database client once. Every query below runs through it.

```sh
export DB_CMD='pnpm --silent -C .dev/playground exec wrangler d1 execute DB --local --json --command'
```

Start the api and the admin app:

```sh
pnpm dev
```

Sign in to the admin app at <http://localhost:3001>, and copy your session cookie out of the browser's dev tools. Every `curl` below needs it.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: sandbox merchant, no subscription | A sandbox payment grants one period | 🔴 Critical |
| TC-1.2 | 1: sandbox merchant, no subscription | The token is minted once and then held | 🔴 Critical |
| TC-1.3 | 1: sandbox merchant, no subscription | A cancelled payment grants nothing | 🔴 Critical |
| TC-1.4 | 1: sandbox merchant, no subscription | A second return on the same payment grants no second period | 🟡 Normal |
| TC-1.5 | 1: sandbox merchant, no subscription | A non-BDT plan is refused at checkout | 🟡 Normal |
| TC-1.6 | 1: sandbox merchant, no subscription | An unset credential is named before anything is sent | 🟡 Normal |
| TC-1.7 | 1: sandbox merchant, no subscription | A forged callback grants nothing | 🔴 Critical |
| TC-1.8 | 1: sandbox merchant, no subscription | A plan change extends the period it interrupts | 🟢 Low |
| TC-2.1 | 2: a paid period that has run out | The renewal sweep asks the subject to pay again | 🔴 Critical |
| TC-2.2 | 2: a paid period that has run out | Renewing grants a fresh period under a new trxID | 🟡 Normal |
| TC-2.3 | 2: a paid period that has run out | The lockout takes the plan away when nobody pays | 🟡 Normal |
| TC-3.1 | 3: the console provider | The console provider still works unchanged | 🟡 Normal |

## Scenario 1: sandbox merchant, no subscription

**Setup.** Run once, for every case in this scenario.

1. Confirm the environment above is ready and `pnpm dev` is running.
2. Confirm the subject has no subscription row.

```sh
$DB_CMD "select count(*) as subscriptions from billing_subscriptions;"
```

- [ ] Setup complete

### TC-1.1: A sandbox payment grants one period · 🔴 Critical

**Goal.** A real sandbox payment writes one `active` row for the plan and interval the subject bought.

**Steps**

1. Open the admin app's billing page. Click subscribe on the `pro` plan, monthly.

   - [ ] The browser lands on a bKash hosted page showing 499.00 BDT

2. Pay with the sandbox wallet number, PIN `12121` and OTP `123456`.

   - [ ] bKash confirms the payment and returns the browser to the admin billing page
   - [ ] The page shows the `pro` plan as active, with a renewal date about 30 days out

3. Read the row the payment wrote.

   ```sh
   $DB_CMD "select plan, status, provider, billing_interval, period_start, period_end, metadata from billing_subscriptions;"
   ```

   - [ ] One row: plan `pro`, status `active`, provider `bkash-merchant`, interval `month`, `period_end` about 30 days after `period_start`
     - `metadata` carries `paymentID`, `trxID`, `customerMsisdn`, `paymentExecuteTime` and `rawStatus` `0000`
     - `provider_subscription_id` starts `bkash_sub_`

4. Read the event the payment wrote.

   ```sh
   $DB_CMD "select provider, provider_event_id, type, processed_at from billing_events;"
   ```

   - [ ] One event: provider `bkash-merchant`, type `payment.succeeded`, `processed_at` set
     - `provider_event_id` is bKash's own `trxID`, not a UUID

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The token is minted once and then held · 🔴 Critical

**Goal.** Request code reads a stored token. It does not call bKash's token endpoints, which allow two calls an hour.

**Steps**

1. Watch the api terminal while you run this case. Every outbound call is logged there.

2. Start a second checkout and stop at the hosted page without paying.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/checkout" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The answer carries a `bkashURL`
   - [ ] The api log shows a call to `/tokenized/checkout/create` and **no** call to `/token/grant` or `/token/refresh`

3. Repeat the same `curl` twice more.

   - [ ] Still no token call in the log

4. Fire the token schedule by hand and read the log.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=*/15+*+*+*+*"
   ```

   - [ ] The job makes no token call, because the stored token is good for more than 20 minutes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A cancelled payment grants nothing · 🔴 Critical

**Goal.** A subject who backs out on bKash's own page keeps the plan they already had, and gains none.

**Steps**

1. Start a checkout for a plan the subject does not hold, from the admin billing page.

2. On the bKash hosted page, cancel instead of paying.

   - [ ] The browser returns to the billing page and the page says the payment was cancelled
   - [ ] The plan shown is the one the subject already held, unchanged

3. Confirm nothing was written.

   ```sh
   $DB_CMD "select plan, status, period_end from billing_subscriptions;"
   ```

   - [ ] The row is the one TC-1.1 wrote, with the same `period_end`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: A second return on the same payment grants no second period · 🟡 Normal

**Goal.** A replayed browser return is a primary-key conflict, not a second period.

**Steps**

1. Find the return URL of the payment TC-1.1 made. Read `paymentID` out of the row's metadata.

   ```sh
   $DB_CMD "select metadata from billing_subscriptions;"
   ```

2. Replay that return by hand. Replace the payment id with the one you just read.

   ```sh
   curl -i "http://localhost:4000/billing/callback/bkash-merchant/return?paymentID=<PAYMENT_ID>&status=success"
   ```

   - [ ] The api answers 303

3. Confirm nothing changed.

   ```sh
   $DB_CMD "select count(*) as events from billing_events;"
   ```

   - [ ] The event count is unchanged, because the second arrival carries the same `trxID`

   ```sh
   $DB_CMD "select plan, status, period_end from billing_subscriptions;"
   ```

   - [ ] `period_end` is unchanged

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: A non-BDT plan is refused at checkout · 🟡 Normal

**Goal.** A plan priced in a currency bKash cannot settle is refused before the subject is sent anywhere.

**Steps**

1. Ask for the `dollars` plan.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/checkout" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"planId":"dollars","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The api answers 4xx and the message names both the plan `dollars` and the currency `USD`
   - [ ] The api log shows no call to bKash

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.6: An unset credential is named before anything is sent · 🟡 Normal

**Goal.** A missing secret reads as a missing secret, and a missing store reads as a missing store.

**Steps**

1. Comment out `BKASH_MERCHANT_APP_SECRET` in `apps/api/.dev.vars`. Restart `pnpm dev`.

2. Ask for a checkout.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/checkout" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The api answers 4xx and the message names `BKASH_MERCHANT_APP_SECRET`

3. Restore that line. Comment out `KV_PROVIDER` instead. Restart `pnpm dev`. Run the same `curl`.

   - [ ] The api answers 4xx and the message names `KV_PROVIDER`

4. Restore `KV_PROVIDER` and restart `pnpm dev`.

   - [ ] A checkout works again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.7: A forged callback grants nothing · 🔴 Critical

**Goal.** The callback route is unauthenticated on purpose. Nothing a stranger can post grants a period.

**Steps**

1. Post a return for a payment that does not exist.

   ```sh
   curl -i "http://localhost:4000/billing/callback/bkash-merchant/return?paymentID=made-up-by-a-stranger&status=success"
   ```

   - [ ] The api answers 303 and sends the browser to the failed page, or answers 4xx
   - [ ] The api log shows the provider asked bKash about that payment and bKash refused

2. Post a webhook body claiming a free upgrade.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/bkash-merchant/webhook" -H "content-type: application/json" -d '{"paymentID":"forged","trxID":"TRX_FAKE","amount":"1.00","transactionStatus":"Completed","merchantInvoiceNumber":"pro:yearly:0:x","payerReference":"user:<your user id>"}'
   ```

   - [ ] The api answers 204
   - [ ] The body's own claims were never believed; the log shows a `payment/status` call

3. Post a subscription confirmation naming a host that is not bKash's.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/bkash-merchant/webhook" -H "content-type: application/json" -d '{"Type":"SubscriptionConfirmation","SubscribeURL":"http://localhost:9999/pwned"}'
   ```

   - [ ] The api answers 204 and the log shows no outbound fetch to that URL

4. Post to another provider's callback path.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/stripe/webhook" -d "paymentID=anything"
   ```

   - [ ] The api answers 404, because `stripe` is not the selected provider

5. Confirm nothing was written by any of the four.

   ```sh
   $DB_CMD "select plan, status, period_end from billing_subscriptions;"
   ```

   - [ ] The row is unchanged

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.8: A plan change extends the period it interrupts · 🟢 Low

**Goal.** A change mid-period costs full price and adds the days left on the old period to the new one.

**Steps**

1. Note the current `period_end`.

   ```sh
   $DB_CMD "select plan, period_end from billing_subscriptions;"
   ```

2. Change to `pro` yearly from the admin billing page, and pay the sandbox payment.

   - [ ] The hosted page shows the yearly price, not a prorated figure

3. Read the row back.

   ```sh
   $DB_CMD "select plan, billing_interval, period_start, period_end, metadata from billing_subscriptions;"
   ```

   - [ ] `billing_interval` is `year`, and `period_end` is about 365 days out plus the days that were left on the old period
     - `metadata.carriedDays` holds that number

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
$DB_CMD "delete from billing_events; delete from billing_subscriptions;"
```

## Scenario 2: a paid period that has run out

**Setup.** Run once, for every case in this scenario.

1. Pay one sandbox payment for `pro` monthly, as TC-1.1 did, so there is an `active` row.
2. Move its period into the past, so the renewal sweep sees it.

```sh
$DB_CMD "update billing_subscriptions set period_end = datetime('now','-1 day'), updated_at = datetime('now','-30 days');"
```

- [ ] Setup complete

### TC-2.1: The renewal sweep asks the subject to pay again · 🔴 Critical

**Goal.** A manually renewed row whose period ran out turns `past_due`, the subject is emailed once, and the plan is still theirs.

**Steps**

1. Fire the renewal sweep.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=0+2+*+*+*"
   ```

   - [ ] The api log prints the `renewal_due` email, naming the `pro` plan and a lockout date

2. Read the row.

   ```sh
   $DB_CMD "select plan, status, locked_at, reminder_sent_at from billing_subscriptions;"
   ```

   - [ ] Status is `past_due`, `locked_at` is null

3. Open the admin billing page.

   - [ ] The page still shows the `pro` plan, and says a payment is due

4. Fire the same sweep again.

   - [ ] No second email is printed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: Renewing grants a fresh period under a new trxID · 🟡 Normal

**Goal.** `POST /billing/renew` opens a fresh checkout for the plan already on the row, and paying it returns the row to `active`.

**Steps**

1. Ask to renew.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/renew" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The answer carries a `bkashURL`

2. Open that URL and pay the sandbox payment.

   - [ ] The browser returns to the billing page and the plan reads active again

3. Read the row and the events.

   ```sh
   $DB_CMD "select plan, status, period_start, period_end from billing_subscriptions;"
   ```

   - [ ] One row still, status `active`, `period_end` about 30 days out

   ```sh
   $DB_CMD "select provider_event_id, type from billing_events;"
   ```

   - [ ] Two events, each with its own `trxID`, because these are two real payments

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: The lockout takes the plan away when nobody pays · 🟡 Normal

**Goal.** A `past_due` row that runs past `BILLING_LOCKOUT_DAYS` loses the plan, and the subject is told.

**Steps**

1. Put the row back to `past_due` and age it past the window.

   ```sh
   $DB_CMD "update billing_subscriptions set status = 'past_due', locked_at = null, updated_at = datetime('now','-30 days');"
   ```

2. Fire the lockout sweep.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=0+3+*+*+*"
   ```

   - [ ] The api log prints the account-locked email

3. Read the row.

   ```sh
   $DB_CMD "select plan, status, locked_at from billing_subscriptions;"
   ```

   - [ ] `locked_at` is set

4. Open the admin billing page.

   - [ ] The page shows the free plan, not `pro`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
$DB_CMD "delete from billing_events; delete from billing_subscriptions;"
```

## Scenario 3: the console provider

**Setup.** Run once, for the case in this scenario.

1. Set `BILLING_PROVIDER=console` in `apps/api/.dev.vars`.
2. Install the console provider and restart.

```sh
cd .dev/playground && ./saasaloy add billing-console --yes && pnpm install && pnpm dev
```

- [ ] Setup complete

### TC-3.1: The console provider still works unchanged · 🟡 Normal

**Goal.** Phase 1's provider env port broke nothing for a provider that owns no job.

**Steps**

1. Subscribe to `pro` from the admin billing page.

   - [ ] The page shows `pro` as active straight away, with no gateway in between

2. Read the row.

   ```sh
   $DB_CMD "select plan, status, provider, provider_subscription_id from billing_subscriptions;"
   ```

   - [ ] One row: plan `pro`, status `active`, provider `console`, id starting `console_sub_`

3. Cancel, then restore, from the same page.

   - [ ] Cancel shows the plan ending at the period end, and restore clears that

4. Fire the token schedule, which is still registered.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=*/15+*+*+*+*"
   ```

   - [ ] The api answers 200 and the log shows no bKash call, because no bKash credential is set

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
cd .dev/playground && $DB_CMD "delete from billing_events; delete from billing_subscriptions;"
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

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
cd .dev/playground && ./saasaloy add billing-bkash-merchant --yes
```

```sh
cd .dev/playground && ./saasaloy remove billing-bkash-merchant --yes
```

```sh
cd .dev/playground && pnpm --filter @repo/billing typecheck && pnpm --filter @repo/queue typecheck
```

- ✅ `pnpm test` → 800 tests pass, 0 fail. 43 of them are the new `modules/billing-bkash-merchant/files/bkash-merchant.test.ts`, covering construction with each credential missing, the token job's four branches and its schedule, the cold-start grant and the marker that stops a second one, the steady-state call budget, checkout, the `2062` fall-through, both mismatches, every declined code, the webhook, the SNS host check and the callback paths. 2 of them are the new `billingProviderEnv` cases in `modules/billing/files/src/config.test.ts`.
- ✅ `pnpm lint` → all four passes green: oxlint type-aware, oxlint plain, Stylelint, `prettier --check`.
- ✅ `pnpm typecheck` → green.
- ✅ Install proof → `saasaloy add billing-bkash-merchant` applies all four patches. A second `add` refuses as already installed and changes no file. `saasaloy remove` restores `packages/billing/src/index.ts` and `packages/queue/src/index.ts` byte-identical to a playground that never installed the module.
- ⚠️ `packages/billing/package.json` keeps `"@repo/kv": "workspace:*"` after `remove`. That is the CLI's behaviour for every `package-json-dependency` patch, the same as `billing-stripe`'s npm packages, and the module's `removeWarnings` says so. Not a defect in this module.
- ✅ Playground typecheck → `@repo/billing` and `@repo/queue` both compile with the provider installed, which proves the shipped file's `../config`, `../jobs/*` and `@repo/kv` imports resolve in a real project.
- ❌ `pnpm --filter @repo/admin typecheck` fails in the playground on `src/routes/billing.tsx(59,38)`, because the playground has no generated TanStack route tree. Confirmed pre-existing: it fails identically with this module removed. Out of scope here.

## Not covered / needs human judgment

- **The webhook against real bKash.** bKash provisions a listener URL by hand during onboarding and offers none in sandbox, so the live notification path cannot be exercised before going live. TC-1.7 proves the endpoint believes nothing it is sent, which is the half that can be tested.
- **A real rate-limit block.** Tripping bKash's two-calls-an-hour limit on purpose blocks the sandbox app key for an hour and teaches nothing the design does not already assume. The cadence is proved by test instead, in `bkash-merchant.test.ts`.
- **A live payment.** Everything here runs against the sandbox. A live merchant account needs its own app key, and the module's skill carries the pre-flight checklist.
- **The manual-recovery path** for a payment bKash took that `execute` never settled. It needs a customer who closes the tab mid-redirect and a merchant portal to read the payment out of. The procedure is in the module's skill.
- **Concurrency.** Two simultaneous cold-start checkouts are proved by test, against a stubbed clock and store. Racing them by hand against the sandbox is not reproducible.
- **Accessibility, compatibility and performance.** This change adds no UI. The admin billing page is unchanged.
- **Database schema.** The change adds no table, column, index or migration. `billing_subscriptions` and `billing_events` are #156's, so the static introspection checks are skipped and the row-level facts are checkpoints inside the cases instead.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
