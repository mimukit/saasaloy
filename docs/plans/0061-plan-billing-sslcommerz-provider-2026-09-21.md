# Plan: the SSLCOMMERZ billing provider

Grilled: 2026-09-21

Issue: [#156](https://github.com/mimukit/saasaloy/issues/156)

## Context

`billing` owns a provider contract with `billing-stripe` and `billing-console` behind it. Stripe does not serve Bangladesh, which is this project's primary market. SSLCOMMERZ is the country's main aggregator gateway and reaches cards, mobile financial services and net banking through one integration, so it is the provider a Bangladeshi project actually installs.

The gateway does not fit the contract as written. Three gaps decide the whole plan:

1. **No subscription primitive.** The v4 API has session open, IPN, Order Validation, Transaction Query and Refund. There is no recurring object and no documented merchant-initiated charge. Recurring billing has to be built on repeated one-off payments.
2. **No signed webhook and no auth plugin.** Stripe reaches the project through a Better Auth plugin that owns a signature-verified endpoint. SSLCOMMERZ POSTs an unauthenticated IPN plus three browser returns to URLs the merchant names, and the only proof of payment is a server-to-server validation call the merchant makes itself. Nothing in `packages/billing` owns an inbound HTTP surface today.
3. **No hosted price object and no portal.** Stripe checkout names a `price_…` id. SSLCOMMERZ is handed a figure. `PlanConfig` carries only `providerIds`, which is a map of vendor price ids, so there is no honest place to put an amount.

Success means a project runs `saasaloy add billing-sslcommerz`, sets `BILLING_PROVIDER=sslcommerz` and three env vars, and the existing billing routes, the admin billing page, the entitlement reads and the dunning emails all work against a real sandbox store with no change to any consumer.

A worked reference exists. `unishopr-reborn` integrates the same gateway for one-off order payments: `apps/api/src/payments/gateways/sslcommerz.ts` (session open, validation, transaction query, the amount and currency comparison), `apps/api/src/routes/payments-sslcommerz.ts` (the IPN and the three return endpoints), `apps/api/src/payments/scheduled.ts` (the reconciliation tick) and `packages/e2e/stub/sslcommerz.ts` (a local fake gateway). That code is the source of the gateway behaviour below. It is not the shape to copy: it writes rows from the route, which ADR 0034 forbids here.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| How a recurring plan renews | Manual renewal, no stored card. Each period is a fresh hosted checkout the subject pays. A daily job marks a row `past_due` once its period ends with no new payment, and the existing lockout job then sets `lockedAt`. Tokenized merchant-initiated charging is not in the public v4 docs and needs an account-level agreement, so it is out. |
| Where the IPN and the three returns live | `packages/billing` gains a generic, unauthenticated provider-callback route and `BillingProvider` gains an optional `handleCallback`. The core stays vendor-blind; the provider owns the validation call and returns either an event or a redirect. Rejected: a route file in `apps/api` (breaks the one-file provider rule and puts vendor code where ADR 0020 forbids it) and a Better Auth plugin that exists only to own a URL. |
| What this plan covers | Two phases. Phase 1 moves `billing` core. Phase 2 adds `modules/billing-sslcommerz`. |
| Where a BDT price comes from | `PlanConfig` gains an explicit `price` per interval, in minor units plus a currency, rather than smuggling `"499.00"` into `providerIds`. |
| Which currencies the provider accepts | BDT only. Any other currency on a plan's `price` throws `invalid_request` at checkout, naming the plan and the currency. An SSLCOMMERZ store is provisioned for a currency set, and a mismatch would otherwise surface only after the subject had paid. Widening to a configurable list later is additive. |
| Verification of a callback | The validation call, not the IPN body. The raw POST is a notification that something happened, never a statement of what. Every fact the provider acts on is read off the validation response, which carries `tran_id`, `val_id`, `amount`, `store_amount`, `currency_type`, `currency_amount`, `bank_tran_id`, `risk_level` and `value_a`–`value_d`. |
| How the subject travels | `value_a` carries the subject and `value_b` carries the plan and interval. The v4 docs confirm both come back on the Order Validation response, so the provider reads them off the validated answer and never off the raw POST. No lookup table and no pending-checkout record are needed. |
| What closes a lost IPN | The browser return validates too. `handleCallback` runs the identical validation call on `return/success` and returns the same event, and `val_id` as `providerEventId` makes whichever arrives second a no-op against the `billing_events` primary key. |
| How the renewal job knows a row is its business | `billing_subscriptions` gains a `provider` column, written by the core from `BillingEvent.provider`. A provider never sets it, so no provider can name another on a row. `billing_events` already carries `provider` as half its primary key, so the projection was the odd one out. |
| How a subject pays for the next period | A dedicated `POST /billing/renew`. It refuses unless the live row is `past_due` and the active provider declares `renewal: "manual"`, and it refuses while the period end is still in the future, so nobody pays twice inside one period. A locked or canceled row is not live, so those subjects re-subscribe through `/billing/checkout` and never reach this route. |
| What the subject hears at renewal | A fourth notification kind, `renewal_due`, with its own template and a pay-now link to `/billing/renew`. Sent once by the renewal job at the moment it writes `past_due`, guarded by `reminderSentAt` the way the trial reminder is. Reusing `payment-failed` would tell every subscriber a card failed when no card was ever charged. |
| How a trial starts with no card | A checkout for a plan carrying `trialDays` mints a `trialing` event and skips the gateway entirely, exactly as `billing-console` does. The renewal job sweeps `trialing` rows at `trialEnd` as well as `active` rows at `periodEnd`. |
| A plan change mid-period | Full price for the new plan, and `periodEnd` is extended by the days left on the old period. No proration primitive exists and the core has no credit concept, so this is the cheapest answer that takes nothing from the subject. Stated in the runbook. |
| Sandbox versus live | One `SSLCOMMERZ_MODE` env var picking between the two published hosts. Anything that is not exactly `live` resolves to the sandbox host, so a typo cannot send a test payment to the live gateway. |
| Where the provider is documented | A skill folder under `modules/billing-sslcommerz/skills/`, as issue #156 asks, plus a one-line row in `modules/billing/skills/saasaloy-billing/SKILL.md`'s provider table pointing at it. This diverges from `create-provider`'s "no skill folder" rule, and the divergence is deliberate and deliberately unrecorded. |

## Approach

### What it reuses

- `BillingProvider`, `BillingError`, `BillingEvent` and `SubscriptionInput` in `packages/billing/src/provider.ts`, unchanged in shape apart from the additions Phase 1 makes.
- `applyEvent` and the `(provider, providerEventId)` primary key in `billing_events`, which already make a redelivered IPN a no-op. `val_id` is the event id, so the gateway's own retry schedule and the browser-return path need no dedupe of their own.
- `pastDueLockoutJob` and the `account-locked` email, which already turn a `past_due` row into a locked one after `BILLING_LOCKOUT_DAYS`. The renewal job only has to produce the `past_due`.
- `notifyBilling`, `setBillingNotifier` and the existing email render path, which the fourth template drops straight into.
- `billing-console`, which stays the local provider. No SSLCOMMERZ stub server is needed for `pnpm dev`, unlike in `unishopr-reborn`.
- The gateway behaviour proven in `unishopr-reborn`: the endpoint paths, the `VALID`/`VALIDATED` pair, the failure-status set, the `PENDING` case, the strict three-way comparison in minor units, and the rule that an unreachable gateway is never a failure.
- `resolveSubject` and `authorizeSubject` in `@billing/subject.ts`, so `teams` still switches the bill to an organization with no change here.
- The repo-only `provider.ts` re-export shim that `kv-memory` and `storage-memory` carry, so the provider file's tests run in place without shipping the shim.

### Phase 1: the callback contract in `billing` core

1. **`BillingProvider.handleCallback?`.** Signature `handleCallback(env, request, path)` returning a discriminated result: `{ kind: "event", event }`, `{ kind: "redirect", url }`, or `{ kind: "ignored" }`. It receives the raw `Request` because a gateway's callback is form-encoded, not JSON, and the core must not guess an encoding. It receives no database and no `HostContext`: there is no session on an IPN.
2. **The callback route.** `apps/api/src/routes/billing.ts` grows `POST` and `GET` on `/billing/callback/:provider/*`, outside `guard`. It refuses any `:provider` that is not the active `BILLING_PROVIDER`, answers 404 for a provider with no `handleCallback`, enqueues a returned event onto `billing.event`, and answers a returned redirect with a 303. The core reads nothing else out of the request.
3. **`PlanConfig.price`.** `{ amount: number, currency: string }` per interval, in the currency's minor unit. Optional, because Stripe plans carry a price id instead. `definePlans` validates that a non-default plan carries either a `providerIds` entry or a `price`.
4. **`BillingProvider.renewal?: "vendor" | "manual"`**, defaulting to `"vendor"`. It is what stops the renewal job from marking a healthy Stripe row `past_due` the moment its period ends.
5. **The `provider` column.** Added to `billing_subscriptions` in both the SQLite and Postgres schema files, written by `applyEvent` from `BillingEvent.provider`, surfaced on `Subscription`, and never settable through `SubscriptionInput`. `latestSubscription` and `pastDueSince` are unchanged; the renewal job's own query filters on it.
6. **The renewal-due job.** A daily scheduled job that sets `past_due` on every row whose `provider` names a provider declaring `renewal: "manual"` and whose period has ended — `periodEnd` for an `active` row, `trialEnd` for a `trialing` one — and sends the `renewal_due` notification once per row, guarded by `reminderSentAt`.
7. **The `renewal_due` notification and template.** A fourth `BillingNotificationKind`, a template beside `trial-ending`, and a link to `BILLING_APP_URL`.
8. **`POST /billing/renew`.** Inside `guard`. Reads the live row, refuses unless its status is `past_due` and the active provider declares `renewal: "manual"`, refuses while the period end is still in the future, then calls `createCheckout` with the row's own plan and interval and returns the url.
9. **One ADR** recording the three claims as one decision: the core owns an unauthenticated provider-callback surface, a provider may mint events for operations the vendor has no counterpart for, and manual renewal is a first-class renewal mode. Plus a `CONTEXT.md` glossary entry for **manual renewal**, beside "Billable subject", "Plan" and "Provider module". `domainkit` writes both.
10. **Tests.** The callback route's provider mismatch, its missing-handler case, and both result kinds. The renewal job's provider filter, its `periodEnd` and `trialEnd` branches, and its one-email guard. `/billing/renew`'s three refusals. `definePlans` with a `price`. `applyEvent` writing `provider` from the event and ignoring a `provider` on the input.

### Phase 2: `modules/billing-sslcommerz`

1. **The descriptor.** `type: saasaloy:feature`, `dependsOn: ["billing"]`, `scaffolds: []`. One `plugin-array` patch onto `packages/billing/src/index.ts`. No npm dependency — the whole integration is `fetch` and `URLSearchParams`. `envVars` declares `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` and `SSLCOMMERZ_MODE`, each with a description naming where to get it and what breaks without it. `agent.skills` names the module's own skill folder.
2. **The one runtime file, `files/sslcommerz.ts`.** Exports `sslcommerzBilling(): BillingProvider` with `name: "sslcommerz"` and `renewal: "manual"`.
   - `createCheckout` on a plan carrying `trialDays` mints a `trialing` event and returns `successUrl` without calling the gateway. Otherwise it reads the plan's `price` for the interval, refuses a non-BDT currency, mints an unguessable `tran_id`, POSTs the session form with `value_a` carrying the subject and `value_b` carrying the plan and interval, and returns `GatewayPageURL` with no event.
   - `changePlan` is a fresh checkout at the new plan's price, with `periodEnd` extended by the days left on the current row's period.
   - `cancel` and `restore` mint an event from `SubjectInput.current`, as `billing-console` does, because the gateway has no subscription to tell.
   - `createPortal` returns `input.returnUrl`. There is no vendor portal.
   - `listInvoices` returns `[]`. The gateway issues no invoice list.
   - `setQuantity` validates and returns. Seats are a later issue everywhere.
   - `handleCallback` branches on the path. `ipn` and `return/success` both run the validation call and return a `payment.succeeded` or `payment.failed` event, or `ignored` on `PENDING`; the return path additionally redirects. `return/fail` and `return/cancel` redirect and change nothing.
3. **Validation, ported from the reference.** Ask the Order Validation API what the `val_id` is worth. Treat `VALID` and `VALIDATED` alike. Compare `tran_id`, `currency_type` and `currency_amount` against what the session was opened for, in minor units, with no rounding towards agreement. Treat a status the file does not recognise as a mismatch and not a failure. Throw rather than settle when the gateway cannot be reached.
4. **The event a validated payment produces.** `providerEventId` is the `val_id`. `providerSubscriptionId` and `providerCustomerId` are derived from the subject, so a renewal converges on the row the first payment created. `periodStart` is now and `periodEnd` is now plus the interval. `metadata` keeps the raw status, `bank_tran_id`, `risk_level` and `store_amount`.
5. **Error mapping.** A refused session open, a mismatch and an unrecognised status map onto `provider_error` with the gateway's own word in `providerCode`. An unreachable gateway is `provider_error` with `retryable: true`. A validation answer in the failure set is `card_declined`, never retryable. A missing store credential or a non-BDT plan price is `invalid_request` naming the key or the plan.
6. **Tests.** The provider file against a stubbed `fetch`: session open success and refusal, a trial checkout that calls no gateway, a validated payment, each failure status, `PENDING`, each of the three mismatches, an unreachable gateway, the non-BDT refusal, and a `changePlan` that extends the period. Use the repo-only re-export shim and keep it out of `files[]`.
7. **The module skill,** `modules/billing-sslcommerz/skills/saasaloy-billing-sslcommerz/SKILL.md`: sandbox signup, the four callback URLs to register in the merchant panel, the three env vars, how to drive a sandbox payment end to end, the manual renewal model and what the subject sees, the no-proration rule, and BDT-only. The billing skill's provider table gains one row pointing here.
8. **Install proof.** `pnpm play:reset`, then `saasaloy add billing-sslcommerz` in `.dev/playground`, then the same command a second time with no change, then `saasaloy remove billing-sslcommerz` leaving every patched file byte-identical. Then `pnpm lint`.

## Open questions

None. Every branch raised in the grill is settled above.

## Non-goals

- Tokenized cards and merchant-initiated charging. Not in the public v4 docs, and it needs an account-level agreement that cannot be tested in sandbox.
- Refunds and the v4 Refund API. `BillingProvider` exposes no refund method, and adding one is a contract change with no consumer.
- Proration in the credit-and-balance sense. The period extension in Phase 2 is the whole of it.
- A reconciliation job over the Transaction Query API. The browser return covers a lost IPN. The residual gap — IPN lost *and* the subject closes the tab — is stated in the runbook and is a follow-up issue if it ever appears in practice.
- Seats. `setQuantity` validates and does nothing, as it does for every provider.
- A local SSLCOMMERZ stub server. `billing-console` is the offline path.
- Easy Checkout, the embedded gateway mode. Hosted redirect only.
- Any change to `apps/admin`'s billing page beyond the `renewal_due` state it already renders as `past_due`.
- Amending `.agents/skills/create-provider/SKILL.md`. Shipping a module skill contradicts its "no skill folder" rule. The contradiction is accepted and left unrecorded by decision, so the next provider author will meet it unannounced.
