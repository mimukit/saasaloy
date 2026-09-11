# QA Plan: Billing capability with entitlements

_Generated 2026-09-08 · against `045127d` · covers `modules/billing`, `modules/billing-stripe`, `modules/billing-console`, `modules/entitlements`, and the `drizzle-column` patch kind in `packages/cli`_

## Summary

- The `billing` capability adds a vendor-blind core, a Stripe provider, a console provider, and an `entitlements` reader over a projection table.
- "Working" means a real Stripe test-mode subscription reaches the local `billing_subscription` row through a signed webhook, and the row drives the plan the app grants.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-126-provider-agnostic-billing-with-entitlements`, commit `045127d`. The branch is stacked on `issue-125-add-queue-capability`.
- Work in `.dev/playground`. It already has `billing`, `billing-console` and `entitlements` installed. `billing-stripe` is not installed.
- You need a Stripe account in test mode, the `stripe` CLI, and a browser.
- API base URL is `http://localhost:4000`. Admin base URL is `http://localhost:3001`.

Add the Stripe provider:

```sh
cd .dev/playground && ./saasaloy add billing-stripe --yes && pnpm install
```

Create two test-mode products in the Stripe dashboard, one monthly price and one yearly price for a plan named `pro`. Copy each price id into `packages/billing/src/plans.ts`.

Write `apps/api/.dev.vars` with these values, and put your own keys in the last two:

```sh
cd .dev/playground/apps/api && printf 'BILLING_PROVIDER=stripe\nQUEUE_PROVIDER=memory\nEMAIL_PROVIDER=console\nLOGGER_PROVIDER=console\nSTRIPE_SECRET_KEY=sk_test_...\nSTRIPE_WEBHOOK_SECRET=whsec_...\n' > .dev.vars
```

Apply the database migrations:

```sh
cd .dev/playground && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate:local
```

Start the API:

```sh
cd .dev/playground/apps/api && pnpm dev
```

Start the admin app in a second terminal:

```sh
cd .dev/playground/apps/admin && pnpm dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: New user, no subscription, Stripe test mode | Checkout completes and the admin page shows the plan | 🔴 Critical |
| TC-1.2 | 1: New user, no subscription, Stripe test mode | The customer portal opens from the admin page | 🔴 Critical |
| TC-2.1 | 2: Subscribed user, `stripe listen` forwarding | A signed webhook updates the row | 🔴 Critical |
| TC-2.2 | 2: Subscribed user, `stripe listen` forwarding | An unsigned event is rejected | 🔴 Critical |
| TC-2.3 | 2: Subscribed user, `stripe listen` forwarding | A replayed event sends no second email | 🟡 Normal |

## Scenario 1: New user, no subscription, Stripe test mode

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001` in the browser.
2. Sign up with a new address, for example `qa-stripe-1@example.com`.
3. Confirm the app signs you in and shows the dashboard.

- [ ] Setup complete

### TC-1.1: Checkout completes and the admin page shows the plan · 🔴 Critical

**Goal.** A Stripe test-mode checkout writes a live `pro` row that the admin page reads back.

**Steps**

1. Click **Billing** in the navigation.
   - [ ] The Billing page opens and reads as a deliberate page, not a raw form
     - the current plan shows `free`
     - the status badge is present and legible
     - the plan picker lists `pro` monthly and `pro` yearly
     - the invoice list shows an empty state, not a blank area
2. Pick `pro` monthly. Click the checkout button.
   - [ ] The browser lands on a Stripe-hosted checkout page for the `pro` monthly price
3. Pay with the test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
   - [ ] Stripe accepts the payment and redirects the browser back to the admin app
4. Wait for the Billing page to load.
   - [ ] The page shows the `pro` plan with a live status (`active` or `trialing`)
5. Read the row from the API.

   ```sh
   curl -i -b /tmp/qa-cookies.txt http://localhost:4000/billing/subscription
   ```

   - [ ] The response is `200` and names `plan: "pro"` with a Stripe subscription id

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The customer portal opens from the admin page · 🔴 Critical

**Goal.** The portal button reaches the Stripe customer portal for this user only.

**Steps**

1. On the Billing page, click the portal button.
   - [ ] The browser opens the Stripe customer portal
   - [ ] The portal names the same `pro` subscription that TC-1.1 created
2. Click the portal's return link.
   - [ ] The browser lands back on the admin Billing page, still signed in

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Cancel the subscription in the Stripe dashboard before Scenario 2 only if TC-2.1 needs a clean state. Otherwise keep the user and the row.

## Scenario 2: Subscribed user, `stripe listen` forwarding

**Setup.** Run once, for every case in this scenario.

1. Keep the user and the `pro` subscription from Scenario 1.
2. Start the webhook forwarder in a third terminal.

   ```sh
   stripe listen --forward-to http://localhost:4000/auth/stripe/webhook
   ```

3. Copy the `whsec_...` value the CLI prints into `apps/api/.dev.vars` as `STRIPE_WEBHOOK_SECRET`. Restart the API.
4. Watch the API log in a fourth terminal. The console email provider prints every send there.

- [ ] Setup complete

### TC-2.1: A signed webhook updates the row · 🔴 Critical

**Goal.** A real signed Stripe event reaches `applyEvent` and changes the stored row.

**Steps**

1. In the Stripe dashboard, cancel the `pro` subscription at period end.
   - [ ] The `stripe listen` terminal prints a `customer.subscription.updated` event with `200` from the forward target
2. Read the row back.

   ```sh
   curl -i -b /tmp/qa-cookies.txt http://localhost:4000/billing/subscription
   ```

   - [ ] The response is `200` and `cancelAtPeriodEnd` is now `true`
3. Reload the admin Billing page.
   - [ ] The page states the plan stays live and names the date it ends

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: An unsigned event is rejected · 🔴 Critical

**Goal.** The webhook route refuses a body that carries no valid Stripe signature.

**Steps**

1. Post a hand-made event with no signature header.

   ```sh
   curl -i -X POST http://localhost:4000/auth/stripe/webhook -H 'Content-Type: application/json' -d '{"id":"evt_qa_unsigned","type":"customer.subscription.deleted","data":{"object":{"id":"sub_qa","status":"canceled"}}}'
   ```

   - [ ] The response status is `400` or `401`, and never `200`
2. Post the same body with a wrong signature.

   ```sh
   curl -i -X POST http://localhost:4000/auth/stripe/webhook -H 'Content-Type: application/json' -H 'stripe-signature: t=1,v1=deadbeef' -d '{"id":"evt_qa_unsigned","type":"customer.subscription.deleted","data":{"object":{"id":"sub_qa","status":"canceled"}}}'
   ```

   - [ ] The response status is again `400` or `401`
3. Read the row back.

   ```sh
   curl -i -b /tmp/qa-cookies.txt http://localhost:4000/billing/subscription
   ```

   - [ ] The row is unchanged by both posts, and the plan is still the one TC-2.1 left

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A replayed event sends no second email · 🟡 Normal

**Goal.** The `(provider, providerEventId)` dedupe stops a redelivered event from sending a second email.

**Steps**

1. Trigger a trial-ending event through the Stripe CLI.

   ```sh
   stripe trigger customer.subscription.trial_will_end
   ```

   - [ ] The API log prints exactly one trial reminder email from the console provider
2. Find the event id in the `stripe listen` output. Resend it.

   ```sh
   stripe events resend evt_REPLACE_WITH_THE_ID
   ```

   - [ ] The `stripe listen` terminal shows the forward target answers `200` again
   - [ ] The API log prints no second trial reminder email
3. Trigger a payment failure.

   ```sh
   stripe trigger invoice.payment_failed
   ```

   - [ ] The API log prints exactly one payment-failed email
4. Resend that event id too.

   ```sh
   stripe events resend evt_REPLACE_WITH_THE_ID
   ```

   - [ ] The API log prints no second payment-failed email

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop `stripe listen`. Stop the API and the admin app. Remove the provider.

```sh
cd .dev/playground && ./saasaloy remove billing-stripe --yes
```

Note: `remove` leaves `stripe` and `@better-auth/stripe` in `packages/billing/package.json`. That is issue #36, not a fault of this branch.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. These outcomes are transcribed from the run's record; nothing was re-run to write this plan._

The full gate:

```sh
pnpm lint && pnpm typecheck && pnpm test
```

The module suites:

```sh
node --import ./scripts/ts-resolve-hook.ts --test "modules/*/files/**/*.test.ts"
```

- ✅ `pnpm lint` → four passes clean, `All matched files use Prettier code style!`.
- ✅ `pnpm typecheck` → `Tasks: 1 successful`, plus `tsc -p tsconfig.scripts.json` clean.
- ✅ `pnpm test` → vitest `Test Files 52 passed (52)`, `Tests 1226 passed (1226)`; `test:modules` `pass 251 / fail 0`; `test:scripts` `pass 82 / fail 0`.
- ✅ Docs and glossary → ADR 0034 exists and is `accepted`; ADR 0033 gains the `billing` row; `CONTEXT.md` gains `Plan`, `Subscription`, `Billable subject`, `Entitlement`, `Projection table`.
- ✅ Vendor-blind core → `modules/billing/files/package.json` has `"dependencies": {}`, and no source file imports `stripe` or `@better-auth`.
- ✅ Provider selection → an unset `BILLING_PROVIDER` throws, an unknown value throws and lists the registered names, and one installed provider still does not become a default.
- ✅ Seven routes → `/checkout`, `/portal`, `/subscription`, `/cancel`, `/restore`, `/change-plan`, `/invoices`, registered through a `chained-route` patch.
- ✅ Console-provider playground run → sign-up `200`; `GET /billing/subscription` `200` with the `free` plan; checkout `200` then `status trialing, plan pro`; portal, cancel, restore, change-plan and invoices all `200`; an unauthenticated `GET` `401`.
- ✅ Double checkout → `HTTP 400 invalid_request`, naming `POST /billing/portal`.
- ✅ Replay dedupe (unit) → `is a no-op on a redelivered event`, `applies a redelivered event exactly once`, `dedupes per provider, so two vendors may share an event id`.
- ✅ Entitlements → the bought plan resolves, a deleted subscription falls back to the default, a `past_due` row keeps the paid plan, a `lockedAt` row falls back, and the projection is read once per request.
- ✅ Jobs → one trial reminder per subscription with `reminderSentAt` stamped, no second reminder on a repeat, the payment-failed email on each distinct failure, and the lockout job locks a `past_due` row past the window and locks nothing twice.
- ✅ Store scope → `opens its own store scope, so a consumer needs no route around it`, which proves a job runs with no route in scope.
- ✅ `drizzle-column` round trip → `packages/cli` `drizzle-column.test.ts` 25 passed, including a byte-for-byte round trip over the real `auth.sqlite.ts` and its `pg` twin.
- ✅ `add billing-stripe` then `pnpm typecheck` → `Tasks: 10 successful`. With `billing-stripe` installed, `BILLING_PROVIDER=console` and no `STRIPE_SECRET_KEY`, sign-up still returns `200`.
- ✅ Malformed bodies → `POST /billing/change-plan` with `null`, `[1,2]` and `{oops` each return `400`, never `500`.
- ⚠️ `saasaloy remove billing-stripe` → source files and `packages/auth/src/auth.ts` revert byte-identically, but `stripe` and `@better-auth/stripe` stay in `packages/billing/package.json`. `package-json-dependency` has no inverse. This is issue #36.
- ❌ Five follow-up issues (seats, `kv` entitlement cache, `billing-polar`, add-on subscriptions, `webhooks-in`) are **not filed**. `issuekit` needs a confirmation the unattended run could not give. A human must file them.

## Not covered / needs human judgment

- Anything against Stripe: checkout, the portal, signed and unsigned webhooks, and replay. Scenarios 1 and 2 above are exactly this gap.
- Whether `@better-auth/stripe` 1.7.3 writes through the `fields` map at a real webhook. The map was read against the plugin's 16 declared fields, not exercised.
- The admin `/billing` page in a browser. The run had no browser.
- `database-postgres`. Every runtime check ran on D1. `billing.pg.ts` and the pg half of the auth schema were read only.
- `queue-cloudflare` at runtime, and the daily cron tick. The store-scope fix is proved by a unit test, not by a live queue or a real tick.
- The `withDb`-over-`env` runner in `apps/api/src/billing-store.ts` under `database-postgres`. Its no-execution-context branch was read, not run.
- Real email delivery. Every email check used `EMAIL_PROVIDER=console`.
- `requireFeature` and `requireWithinLimit` at runtime. No scaffolded route mounts them, so only the 402 body was read.
- Concurrency and performance. No case drives two checkouts at once or a large invoice list. The dedupe is proved by unit test only.
- Accessibility of the admin Billing page. Not assessed; worth a keyboard pass if the page ships as-is.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
