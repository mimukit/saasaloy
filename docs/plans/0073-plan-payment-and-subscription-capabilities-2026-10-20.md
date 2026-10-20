# Plan: rename `billing` to `subscription`, add the `payment` capability, and move the open gateway PRs

## Context

primeshopr sells one order at a time and needs one-time payments: a shopper pays by bKash, Nagad, Rocket or bank transfer outside the site and submits the transaction ID, staff confirm it, and a card gateway comes later (primeshopr plan 0018, Phase 6). saasaloy's `billing` capability models subscriptions only, and plan 0050 lists one-time purchases as a non-goal.

Three open PRs tried to fit Bangladeshi gateways into `billing` anyway: #169 (`billing-sslcommerz`), #170 (`billing-bkash-personal`, a manual transaction-ID flow) and #171 (`billing-bkash-merchant`). They renew a subscription by charging one-off payments, and they put a payment submissions table into the billing core. Their branches also add ADRs that reuse the numbers 0039 and 0040.

ADR 0045 settles the shape: `billing` becomes `subscription`, a new `payment` capability takes one-time payments, module names are singular and table names plural, and a vendor gets one provider module per capability it serves. This plan carries that out and moves the work in the three PRs to where it now belongs.

Success: `saasaloy add payment payment-manual` on a fresh project with either database driver gives a working manual payment flow with a staff review queue; `payment-sslcommerz` and `payment-bkash` take the same contract with no change to an app's routes; `subscription` and its providers replace `billing` with no `billing` name left in the registry; and a subscription can renew through the installed payment provider.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Capability names | `subscription` (renamed from `billing`) and `payment`, both singular. Providers are `subscription-console`, `subscription-stripe`, `payment-console`, `payment-manual`, `payment-sslcommerz`, `payment-bkash`. See ADR 0045. |
| Table names | Plural snake_case (ADR 0038). `billing_subscriptions` becomes `subscriptions`, `billing_events` becomes `subscription_events`. `payment` owns `payments`, `payment_events` and `payment_refunds`. |
| Order of work | #166 (merge `entitlements` into `billing`) rebases and merges before the rename, so the rename moves one module, not two. The rename and the `payment` core have no shared files and run in parallel. |
| What happens to #169, #170, #171 | They close unmerged, with a comment that links the new issue. Their code is the starting point for `payment-sslcommerz`, `payment-manual` and `payment-bkash`. The renewal parts of #169 (`PlanConfig.price`, the renewal-due job, `POST /billing/renew`) move into the `subscription` renewal phase. Issues #156, #157 and #158 close as superseded. |
| `payment` contract | `create`, `submit`, `confirm`, `reject`, `refund`, `handleCallback`, and `methods()`. The factory is `createPayment(env)`, so the contract method is `create`, not `createPayment`. Every method takes `env` whole. |
| Several gateways at once | `PAYMENT_PROVIDER` takes a comma list in priority order (`manual,sslcommerz`). `create({ method })` picks the first listed provider whose `methods()` has that method, and stores it on the row. Every later call on that payment goes to the stored provider. Unset, empty or unknown names still throw at construction. AGENTS.md's `<CAP>_PROVIDER` rule gains one sentence for this. |
| `create` result | One of three kinds: `instructions` (manual: the account to pay and the fields to submit), `redirect` (a hosted checkout URL), or `client` (a token for an embedded form). |
| Link to app data | An opaque `reference_type` and `reference_id` pair, plus a nullable `user_id`. The core never reads app tables and does not authorize the reference. The app's own routes do that and then call the module. |
| Routes the core ships | The public callback route `/payment/callback/:provider/*` (outside the session guard), and the staff review routes `GET /admin/payment/payments` and `POST /admin/payment/payments/:id/review`. The core ships no shopper routes, because every app authorizes its reference differently. The skill shows the shopper route pattern. |
| Admin UI | A **Payments** review page in `apps/admin`, taken from #170. |
| Status | `pending`, `submitted`, `successful`, `failed`, `cancelled`. `confirm` and `reject` are conditional updates on `status = 'submitted'`, so two staff racing get one success and one `conflict`. Every change appends a `payment_events` row. |
| Duplicate transaction IDs | A partial unique index on `(provider, transaction_id_normalized)` where `status` is not `failed` or `cancelled`, from #170. A rejected submission does not burn its transaction ID. |
| Money | `amount` in minor units plus an ISO 4217 `currency`, and a nullable `settled_amount` the provider fills from the vendor's report. |
| Errors | One `PaymentError` with `code`, `retryable` and `providerCode`. Codes: `invalid_request`, `not_found`, `conflict`, `duplicate_transaction`, `method_unavailable`, `declined`, `callback_invalid`, `rate_limited`, `provider_error`. |
| Local provider | `payment-console` simulates a hosted checkout: `create` returns a redirect to a local page that posts back to the callback route. It needs no account and no network, and it tests the redirect path that `payment-manual` never takes. |
| Manual method config | `payment-manual` takes its accounts as options in the registration call (`manual({ methods: { bkash: { account, kind: "personal" }, bank: { … } } })`), the same shape as `storage-memory`'s `seed` option. Account numbers are checked in, not env values (ADR 0039). |
| Subscription renewal | A plan with a `price` and `renewal: "payment"` renews by calling `payment.create` with `reference_type = "subscription"`. A successful payment extends the period through the existing event path, so `applyEvent` stays the single writer (ADR 0034). |
| Installed projects | The rename is breaking. A project with `billing` installed follows a runbook in the `saasaloy-subscription` skill: remove the three old modules, add the new ones, and accept drizzle-kit's rename prompt for each table. The CLI does not migrate it. |

## Approach

Rename first in name only, with no change in behaviour, so the diff a reviewer reads is mechanical. Build the `payment` core in parallel, then add one provider per issue, each starting from the code in the PR it replaces. Finish with the subscription renewal, which needs both.

What it reuses:

- `modules/billing` for the capability shape: `define.ts`, `provider.ts`, the env preset, the admin page, the email templates and the `HostContext` pattern.
- `modules/sms` and `modules/email` for the `define<Cap>({ providers })` registry and the error normalization (`define.ts` `normalize()`).
- PR #170 for the submission queue: the partial unique index, the conditional review update, the admin Payments page, the `conflict` code.
- PR #169 for the callback route shape and `handleCallback(env, request, path)` returning `event`, `redirect` or `ignored`, and for the SSLCOMMERZ session and IPN validation.
- PR #171 for the bKash tokenized checkout, the grant token in `kv` and its refresh job.
- `@repo/validators/phone` (`bangladeshMobile`, plan 0059) for the sender number, in place of #170's inline rule.
- The schema twin convention (`files/db/schema/<name>.{pg,sqlite}.ts` with `onlyWith`) for the three tables.
- The seed slice convention from plan 0072, once #207 lands, for example rows in each new table.

Rejected, one line each: one capability with a recurring mode (puts plan state into every shop); one `paddle`-style module per vendor registering into both capabilities (two runtime files, ADR 0045); keeping #169 to #171 and renaming them in place (their core changes are the wrong shape, so a rebase rewrites most of each diff).

### Phase 1: rename `billing` to `subscription` (#211)

- Merge #166 first.
- Rename `modules/billing`, `billing-console` and `billing-stripe` to `subscription`, `subscription-console` and `subscription-stripe`, and `packages/billing` to `packages/subscription` (`@repo/subscription`).
- Rename the tables, the Drizzle export keys, `BILLING_*` env keys to `SUBSCRIPTION_*`, `BillingError` to `SubscriptionError`, `defineBilling` to `defineSubscription`, the `/billing` routes to `/subscription`, the admin route and nav label, the email templates and the skill names. Drop the `modelName` override in the Stripe provider.
- Update `CONTEXT.md`, both READMEs, `docs/wiki/`, AGENTS.md's provider list, `.agents/skills/create-provider/`, and the CLI test fixtures that name `billing`. Add the ADR 0045 note to ADR 0034.
- Write the runbook for a project that has `billing` installed.

Done when: `rg -i billing modules packages/cli/src scripts docs/wiki CONTEXT.md AGENTS.md README.md` prints only the runbook and history notes, `pnpm lint`, `pnpm test` and `pnpm test:modules` pass, and on a fresh `.dev` project `saasaloy add subscription subscription-console` then `db:generate` produces `subscriptions` and `subscription_events`, and the console checkout flow works in the admin app as it did under `billing`.

### Phase 2: the `payment` core and `payment-console` (#212)

- `modules/payment`: the provider contract, `definePayment`, `createPayment(env)`, `PaymentError`, the three tables in both dialects, the store, the callback route, the review routes, the admin Payments page, the env preset (`PAYMENT_PROVIDER` as a comma list), the method-to-provider selection, the AGENTS.md sentence for a list-valued `<CAP>_PROVIDER`, and the `saasaloy-payment` skill with the shopper route pattern.
- `modules/payment-console`: one runtime file, the local hosted checkout page, and its registration patch.

Done when: on fresh `.dev` projects with `database-postgres` and with `database-d1`, `saasaloy add payment payment-console` installs cleanly, `db:generate` produces the three tables, an example route that calls `create` gets a redirect, following it posts to the callback and the payment becomes `successful` with two `payment_events` rows, an unset `PAYMENT_PROVIDER` throws at construction, and `pnpm test:modules` passes with tests for the status machine and the error normalization.

### Phase 3: `payment-manual` (#213)

- Port the provider half of #170: the instructions, the submission fields (transaction ID, sender account, amount), normalization and validation, with `bangladeshMobile` for the sender number.
- Methods `bkash`, `nagad`, `rocket` and `bank`. `methods()` reports `card` as unavailable.
- `refund` records a refund staff sent by hand as a `payment_refunds` row.

Done when: on a fresh `.dev` project, `create` with method `bkash` returns the configured account, `submit` moves the payment to `submitted`, a second payment with the same transaction ID answers `duplicate_transaction`, a confirm from the admin Payments page moves it to `successful`, two concurrent confirms produce one success and one 409, a rejected transaction ID can be submitted again, and `create` with method `card` throws `method_unavailable`.

### Phase 4: `payment-sslcommerz` (#214)

- Port the gateway half of #169: session init returning `redirect`, IPN validation through the validator API in `handleCallback`, amount and currency checks, refunds through the refund API, and the sandbox and live hosts by env.

Done when: against the SSLCOMMERZ sandbox, a `.dev` project creates a payment, completes the hosted checkout, receives a validated IPN that moves the payment to `successful` with `settled_amount` set, ignores a replayed IPN, refuses a tampered one with `callback_invalid`, and records a refund.

### Phase 5: `payment-bkash` (#215)

- Port #171: tokenized checkout returning `redirect`, execute on callback, status re-read in place of signature trust, the grant token in `kv` refreshed by a provider job, and refunds.
- Record the "a provider may depend on a capability and own a scheduled job" decision under a new ADR number.

Done when: against the bKash sandbox, a `.dev` project with `kv` installed completes a payment, a cancelled checkout leaves the payment `cancelled`, the token refresh job runs on its schedule, and a refund succeeds.

### Phase 6: subscription renewal through `payment` (#216)

- `PlanConfig.price` per interval in minor units plus a currency, and `renewal: "vendor" | "payment"`, from #169.
- A renewal-due job, a `POST /subscription/renew` route that calls `payment.create` with `reference_type = "subscription"`, and a payment listener that turns a successful renewal payment into the existing period-extending event.

Done when: on a `.dev` project with `subscription`, `subscription-console`, `payment` and `payment-manual`, a plan with `renewal: "payment"` shows a renew action as the period ends, a confirmed manual payment extends the period by one interval, and a rejected one leaves it to run past due as before.

## Migration and rollback

No saasaloy-registry data moves. A project with `billing` installed keeps working on its locked commit until it runs the runbook. The runbook's migration renames `billing_subscriptions` and `billing_events` in place (drizzle-kit's rename prompt), and its rollback is the reverse rename plus re-adding the `billing` modules at the old commit. The `payment` tables are new, so a rollback of Phases 2 to 5 drops them.

## Open questions

- How does the app react to a status change: a listener array in `definePayment` called after the write, a queue job like `subscription`'s event path, or both? On Postgres a listener could run in the same transaction as the status change; on D1 it cannot.
- Does `payment` depend on `admin`, as `billing` does, or ship the Payments page under `onlyWith: "admin"`?
- Does any project outside this repo have `billing` installed? If none, the runbook can be short.
- Does `users.billing_customer_id` become `subscription_customer_id`, or a vendor-neutral `customer_id` that a `payment` provider could also read?
- Which email templates move to `payment` (a `payment_rejected` notice from #170), and does `payment` then depend on `email`?

## Non-goals

- International providers (`payment-paddle`, `payment-polar`, `payment-paypal`, `subscription-paddle`, and the rest). ADR 0045 says where they go; each is its own later issue.
- Automatic verification of a manual transaction ID.
- Partial payments of one `payments` row, and multi-currency conversion.
- Shopper-facing routes in the `payment` core.
- Migrating an installed project's `billing` data automatically.
