# QA Plan: the SSLCOMMERZ billing provider

_Generated 2026-09-21 · against `b09242c` plus the uncommitted working tree · covers `modules/billing-sslcommerz` and the Phase 1 changes to `modules/billing`_

## Summary

- `billing` gains a provider-callback route, a `price` field on a plan, a `provider` column, a manual renewal mode, a daily renewal sweep and `POST /billing/renew`. `billing-sslcommerz` adds SSLCOMMERZ behind that contract.
- Working means a project sets `BILLING_PROVIDER=sslcommerz`, pays a real sandbox payment, gets an `active` row, is asked to pay again when the period ends, and loses the plan only if nobody pays.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-156-add-the-sslcommerz-billing-provider-module`. Build: the working tree, uncommitted.
- You need a free SSLCOMMERZ **sandbox** store. Register at <https://developer.sslcommerz.com/registration/>. Keep the store id and the store password.
- You need a public https tunnel to the api. The gateway posts to your api from the internet.

Build the playground and install the modules:

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add queue-memory --yes && ./saasaloy add billing-sslcommerz --yes && pnpm install
```

Start the tunnel in its own terminal, and keep the https URL it prints:

```sh
cloudflared tunnel --url http://localhost:4000
```

Write `.dev/playground/apps/api/.dev.vars`. Replace the two credentials and the tunnel host:

```sh
cat >> apps/api/.dev.vars <<'VARS'
BILLING_PROVIDER=sslcommerz
BILLING_APP_URL=http://localhost:3001/billing
BILLING_LOCKOUT_DAYS=14
QUEUE_PROVIDER=memory
EMAIL_PROVIDER=console
EMAIL_FROM=billing@example.test
SSLCOMMERZ_STORE_ID=<your store id>
SSLCOMMERZ_STORE_PASSWORD=<your store password>
SSLCOMMERZ_MODE=sandbox
SSLCOMMERZ_CALLBACK_URL=<your tunnel https URL>
SSLCOMMERZ_RECEIPT_EMAIL=<a mailbox you own>
VARS
```

Price the `pro` plan in BDT. Open `packages/billing/src/plans.ts` and give `pro` a `price` beside its `providerIds`, and add a second paid plan priced in USD for TC-1.4:

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

Note that `pro` above drops `trialDays`. A plan carrying `trialDays` never reaches the gateway, which is TC-1.5's case.

Register the IPN URL in the SSLCOMMERZ merchant panel, under **My Stores → IPN Settings**:

```
<your tunnel https URL>/billing/callback/sslcommerz/ipn
```

Create the database and apply the schema:

```sh
pnpm db:generate && pnpm db:migrate:local
```

The database client for every query below is the playground's local D1 file:

```sh
export DB_CMD='pnpm --silent -C .dev/playground exec wrangler d1 execute DB --local --json --command'
```

Start the api and the admin app:

```sh
pnpm dev
```

- [ ] The api answers on `http://localhost:4000` and the admin app on `http://localhost:3001`
- [ ] The tunnel URL reaches the api from a phone or another network

Sign in to the admin app once, and keep the browser session. Every route below needs it.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: no subscription | A sandbox payment writes an active row | 🔴 Critical |
| TC-1.2 | 1: no subscription | The browser return and the IPN together write one row, not two | 🔴 Critical |
| TC-1.3 | 1: no subscription | A cancelled payment leaves no subscription | 🟡 Normal |
| TC-1.4 | 1: no subscription | A plan priced outside BDT is refused before the subject pays | 🟡 Normal |
| TC-1.5 | 1: no subscription | A plan with a trial starts without touching the gateway | 🟡 Normal |
| TC-1.6 | 1: no subscription | The callback route refuses a provider it is not running | 🟡 Normal |
| TC-2.1 | 2: a period that has ended | The sweep marks the row past_due and emails a pay-now link | 🔴 Critical |
| TC-2.2 | 2: a period that has ended | The subject pays for the next period | 🔴 Critical |
| TC-2.3 | 2: a period that has ended | Renew refuses a period that is still running | 🟡 Normal |
| TC-2.4 | 2: a period that has ended | Nobody pays, and the lockout takes the plan | 🟡 Normal |
| TC-3.1 | 3: the console provider | The local provider still runs the whole flow | 🔴 Critical |
| TC-3.2 | 3: the console provider | Renew refuses a provider that renews at the vendor | 🟢 Low |

## Scenario 1: no subscription

**Setup.** Run once, for every case in this scenario.

1. Confirm the projection is empty for your signed-in user.

```sh
$DB_CMD "select id, plan, status, provider from billing_subscriptions;"
```

- [ ] The table has the `provider` column and no rows

- [ ] Setup complete

### TC-1.1: A sandbox payment writes an active row  ·  🔴 Critical

**Goal.** A real sandbox payment reaches the projection as an `active` row on the right plan, at the right price.

**Steps**

1. Open the admin app's Billing page at `http://localhost:3001/billing`. Start a monthly checkout on **Pro**.
   - [ ] The browser lands on an `sslcommerz.com` hosted page
     - the amount reads 499.00 BDT
     - the product name reads Pro
2. Pay with any method the sandbox page offers. The page lists its own test cards and test MFS accounts.
   - [ ] The gateway reports the payment as successful
3. Wait for the browser to come back.
   - [ ] The browser lands on `http://localhost:3001/billing?billing=paid`
   - [ ] The Billing page shows the Pro plan and a renewal date about 30 days out
4. Read the row.

   ```sh
   $DB_CMD "select plan, status, provider, billing_interval, period_start, period_end, metadata from billing_subscriptions;"
   ```

   - [ ] One row: plan `pro`, status `active`, provider `sslcommerz`, interval `month`
     - `period_end` is about 30 days after `period_start`
     - `metadata` carries `valId`, `bankTranId`, `rawStatus` and `storeAmount`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The browser return and the IPN together write one row, not two  ·  🔴 Critical

**Goal.** The gateway reports the same payment twice, and the second report changes nothing.

**Steps**

1. Read the event table after TC-1.1.

   ```sh
   $DB_CMD "select provider, provider_event_id, type, processed_at from billing_events;"
   ```

   - [ ] Exactly one row, type `payment.succeeded`, with the gateway's `val_id` as `provider_event_id`
     - the IPN and the browser return both arrived, and both named this id
2. Replay the return by hand. Copy the `provider_event_id` from the query above into `<VAL_ID>`.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/sslcommerz/ipn" -d "val_id=<VAL_ID>"
   ```

   - [ ] The api answers 204
3. Read both tables again.

   ```sh
   $DB_CMD "select count(*) as subscriptions from billing_subscriptions;"
   ```

   - [ ] Still one subscription row, and the `period_end` from TC-1.1 is unchanged

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A cancelled payment leaves no subscription  ·  🟡 Normal

**Goal.** A subject who backs out of the hosted page is not subscribed and is told nothing went wrong.

**Steps**

1. Clear the row TC-1.1 wrote, so this case starts from nothing.

   ```sh
   $DB_CMD "delete from billing_subscriptions; delete from billing_events;"
   ```

2. Start a monthly Pro checkout again. On the hosted page, press the gateway's own Cancel.
   - [ ] The browser lands on `http://localhost:3001/billing?billing=canceled`
   - [ ] The Billing page shows the free plan, with no error and no half-finished state
3. Read the tables.

   ```sh
   $DB_CMD "select count(*) as rows from billing_subscriptions;"
   ```

   - [ ] No subscription row

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: A plan priced outside BDT is refused before the subject pays  ·  🟡 Normal

**Goal.** A currency this store cannot take is refused at checkout, naming the plan, rather than after the subject has paid.

**Steps**

1. Start a monthly checkout on the **Dollars** plan from the admin Billing page.
   - [ ] The browser never reaches the gateway
   - [ ] The page shows an error naming the plan and the currency
2. Read the same refusal over the api. Use your signed-in browser's cookie, or run this from the browser console.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/checkout" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"planId":"dollars","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] HTTP 400, code `invalid_request`, and the message names `dollars` and `USD`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: A plan with a trial starts without touching the gateway  ·  🟡 Normal

**Goal.** A trial costs nothing and needs no merchant account, so it never opens a hosted page.

**Steps**

1. Give the `pro` plan a `trialDays: 14` in `packages/billing/src/plans.ts` and let the dev server reload.
2. Clear the projection and start a monthly Pro checkout.

   ```sh
   $DB_CMD "delete from billing_subscriptions; delete from billing_events;"
   ```

   - [ ] The browser never leaves `localhost:3001`
   - [ ] The Billing page shows Pro, trialing, with a trial end about 14 days out
3. Read the row.

   ```sh
   $DB_CMD "select plan, status, provider, trial_end, period_end from billing_subscriptions;"
   ```

   - [ ] Status `trialing`, provider `sslcommerz`, and `trial_end` equals `period_end`
4. Remove `trialDays` from `pro` again, so the later scenarios pay.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.6: The callback route refuses a provider it is not running  ·  🟡 Normal

**Goal.** A stale URL from another provider's dashboard cannot write events into this project.

**Steps**

1. Post to a provider that is not selected.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/stripe/ipn" -d "val_id=anything"
   ```

   - [ ] HTTP 404, code `not_found`
2. Post to a path this provider did not register.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/sslcommerz/whatever" -d "val_id=anything"
   ```

   - [ ] HTTP 204, and nothing is written
3. Post a `val_id` the gateway never issued.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/sslcommerz/ipn" -d "val_id=made-up-by-a-stranger"
   ```

   - [ ] The api refuses it, and the reason is a gateway answer rather than a trusted body
   - [ ] No new row appears in `billing_subscriptions`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
$DB_CMD "delete from billing_subscriptions; delete from billing_events;"
```

## Scenario 2: a period that has ended

**Setup.** Run once, for every case in this scenario.

1. Pay one sandbox payment on monthly Pro, exactly as TC-1.1 does, so a live `active` row exists.
2. Move its period into the past, so the sweep has something to find.

```sh
$DB_CMD "update billing_subscriptions set period_end = strftime('%s','now','-1 day') * 1000 where plan = 'pro';"
```

- [ ] One `active` row, on plan `pro`, whose `period_end` is yesterday
- [ ] Setup complete

### TC-2.1: The sweep marks the row past_due and emails a pay-now link  ·  🔴 Critical

**Goal.** A period that ran out with no payment moves the row to `past_due` and asks the subject to pay, without taking the plan away.

**Steps**

1. Run the daily renewal sweep. Wrangler's scheduled endpoint fires it without waiting for 02:00 UTC.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=0+2+*+*+*"
   ```

   - [ ] The api answers without an error
2. Read the api's terminal, where `email-console` prints the message.
   - [ ] One email printed, and its subject asks the reader to renew
     - the body names the Pro plan
     - the body names a lockout date about 14 days out
     - the body says no card was charged, rather than that a payment failed
3. Read the row.

   ```sh
   $DB_CMD "select status, locked_at, reminder_sent_at from billing_subscriptions;"
   ```

   - [ ] Status `past_due`, `locked_at` empty, `reminder_sent_at` set
4. Open the admin Billing page.
   - [ ] The page still shows Pro, so the plan is still entitled
5. Run the sweep a second time.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=0+2+*+*+*"
   ```

   - [ ] No second email is printed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The subject pays for the next period  ·  🔴 Critical

**Goal.** `POST /billing/renew` opens a fresh checkout for the plan already on the row, and paying it starts a new period on the same row.

**Steps**

1. Ask for the renewal checkout.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/renew" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] HTTP 200, with an `sslcommerz.com` url
2. Open that url in the browser and pay, as in TC-1.1.
   - [ ] The browser lands on `http://localhost:3001/billing?billing=paid`
3. Read the row.

   ```sh
   $DB_CMD "select id, plan, status, period_end, provider from billing_subscriptions;"
   ```

   - [ ] Still **one** row, and it is the same `id` as before
     - status is back to `active`
     - `period_end` is about 30 days from now
4. Open the admin Billing page.
   - [ ] The page shows Pro with the new renewal date

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Renew refuses a period that is still running  ·  🟡 Normal

**Goal.** Nobody can pay twice inside one period.

**Steps**

1. With the `active` row from TC-2.2 still in place, ask to renew again.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/renew" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] HTTP 400, and the message says the subscription is `active` rather than `past_due`
2. Put the row back to `past_due`, but leave its period end in the future.

   ```sh
   $DB_CMD "update billing_subscriptions set status = 'past_due';"
   ```

   ```sh
   curl -i -X POST "http://localhost:4000/billing/renew" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] HTTP 400, and the message names the date the current period runs until

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: Nobody pays, and the lockout takes the plan  ·  🟡 Normal

**Goal.** The existing dunning end-stop still works behind manual renewal, unchanged.

**Steps**

1. Age the `past_due` row past the 14-day grace window.

   ```sh
   $DB_CMD "update billing_subscriptions set status = 'past_due', period_end = strftime('%s','now','-40 day') * 1000, updated_at = strftime('%s','now','-20 day') * 1000;"
   ```

2. Run the lockout sweep.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=0+3+*+*+*"
   ```

   - [ ] The api's terminal prints the account-locked email
3. Read the row and the page.

   ```sh
   $DB_CMD "select status, locked_at from billing_subscriptions;"
   ```

   - [ ] `locked_at` is set
   - [ ] The admin Billing page now shows the free plan

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
$DB_CMD "delete from billing_subscriptions; delete from billing_events;"
```

## Scenario 3: the console provider

**Setup.** Run once, for every case in this scenario. This scenario is the regression check: the Phase 1 core changes must not move the local provider.

1. Install the local provider and select it.

```sh
cd .dev/playground && ./saasaloy add billing-console --yes
```

```sh
sed -i 's/^BILLING_PROVIDER=.*/BILLING_PROVIDER=console/' apps/api/.dev.vars
```

2. Restart `pnpm dev`.

- [ ] Setup complete

### TC-3.1: The local provider still runs the whole flow  ·  🔴 Critical

**Goal.** The callback route, the `provider` column and the new plan field leave `billing-console` exactly as it was.

**Steps**

1. On the admin Billing page, subscribe to Pro, change the plan, cancel, and restore.
   - [ ] Every action completes with no network and no error
   - [ ] The page shows the right plan and status after each one
2. Read the row.

   ```sh
   $DB_CMD "select plan, status, provider, provider_subscription_id from billing_subscriptions;"
   ```

   - [ ] One row, with provider `console` and a `console_sub_…` id
3. Post to the callback route.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/callback/console/ipn" -d "val_id=x"
   ```

   - [ ] HTTP 404: this provider declares no callback surface

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: Renew refuses a provider that renews at the vendor  ·  🟢 Low

**Goal.** `POST /billing/renew` is refused wherever manual renewal does not apply, and the message points somewhere useful.

**Steps**

1. Put the console row into `past_due`.

   ```sh
   $DB_CMD "update billing_subscriptions set status = 'past_due', period_end = strftime('%s','now','-1 day') * 1000;"
   ```

2. Ask to renew.

   ```sh
   curl -i -X POST "http://localhost:4000/billing/renew" -H "content-type: application/json" -H "cookie: <your session cookie>" -d '{"successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] HTTP 400, and the message says `console` renews at the vendor and points at the portal route
3. Run the renewal sweep.

   ```sh
   curl -i "http://localhost:4000/__scheduled?cron=0+2+*+*+*"
   ```

   - [ ] No renewal email is printed: no installed provider renews manually

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
$DB_CMD "delete from billing_subscriptions; delete from billing_events;"
```

```sh
cd /home/dev/worktrees/saasaloy/issue-156-add-the-sslcommerz-billing-provider-module && pnpm run play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm run test:modules
```

```sh
pnpm run test
```

```sh
pnpm run lint
```

```sh
pnpm run build
```

```sh
pnpm run play:reset && cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add billing-sslcommerz --yes && pnpm install && pnpm build && pnpm typecheck
```

```sh
cd .dev/playground && ./saasaloy add billing-sslcommerz --yes && ./saasaloy remove billing-sslcommerz --yes && ./saasaloy add billing-sslcommerz --yes
```

- ✅ `pnpm run test:modules` → 595 tests, 0 failures. Includes 33 new provider tests against a stubbed `fetch` (session open and refusal, the trial path, a validated payment, each failure status, `PENDING`, all three mismatches, an unreachable gateway, the non-BDT refusal, the period extension) and 10 new renewal-sweep tests.
- ✅ `pnpm run test` → the repo suite plus 160 script tests, 0 failures.
- ✅ `pnpm run lint` → all four passes clean: oxlint type-aware, oxlint plain, stylelint, prettier.
- ✅ `pnpm run build` → clean.
- ✅ Playground install and typecheck → `saasaloy add billing-sslcommerz` pulls in `billing` and its dependencies, applies 89 files, and `pnpm typecheck` passes across all 10 workspaces. This is the only place the new route, the store port, the provider file and the email template are type-checked against a real project.
- ✅ Idempotency and removal → a second `add` changes no byte of `packages/billing/src/index.ts`, `apps/api/src/routes/billing.ts` or `packages/queue/src/index.ts`; `remove` takes the registration back out; a third `add` restores the file byte-identical.
- ⚠️ `saasaloy add` prints one warning: the `const-array` patch on `apps/admin/src/components/app-shell.tsx` cannot find `NAV_ITEMS`. This comes from `modules/billing`'s existing descriptor and is unchanged by this work. It is worth a separate issue, not a blocker here.

Not run, and why: the agent applied no migration, opened no database and made no payment. Every static database fact this change adds — the `provider` column on `billing_subscriptions` — is confirmed in the plan's Scenario 1 setup instead, because confirming it needs a migration the agent must not run.

## Not covered / needs human judgment

- **Anything against a live SSLCOMMERZ store.** Every case here is the sandbox. A live store needs a registered Bangladeshi business.
- **The one gap the design accepts.** If the IPN is lost **and** the subject closes the tab before the browser return lands, a real payment is never reported. There is no reconciliation job, on purpose. See the module skill.
- **Concurrency.** Two browsers paying for the same subject at the same time. The `provider_subscription_id` unique index and the `billing_events` primary key should make the second one converge, but nothing here drives it.
- **Postgres.** Both schema files carry the new column, and the playground runs `database-d1`. Re-run Scenario 1 under `database-postgres` before relying on it there.
- **Accessibility, compatibility and performance.** This change adds no UI. The admin Billing page renders `past_due` exactly as it already did.
- **`teams`.** The subject stays a user throughout. Billing an organization is `subject.ts`'s swap and is untouched here.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
