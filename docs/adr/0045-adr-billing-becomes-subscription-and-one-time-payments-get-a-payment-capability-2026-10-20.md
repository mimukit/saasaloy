# 0045 — `billing` becomes `subscription`, and one-time payments get a `payment` capability

`billing` models recurring plans: trials, seats, past-due lockout, a customer portal. It has no way to take one payment for one order, and plan 0050 lists one-time purchases as a non-goal. primeshopr, a shop that sells one order at a time, needs exactly that (its plan 0018). The name `billing` reads as "every money flow", so a second capability beside it would leave a reader guessing which one takes a payment for an order. Settled on 2026-10-20 while planning primeshopr's backend in saasaloy (`docs/plans/0073-plan-payment-and-subscription-capabilities-2026-10-20.md`).

## Status

accepted. Renames the capability [ADR 0034](adr-0034-billing-tables-are-a-projection-of-the-vendors-record-2026-09-08.md) describes; its reasoning still holds under the new name. Withdraws two ADRs that only exist on unmerged branches and were never accepted: `0039-adr-billing-owns-a-provider-callback-surface-and-a-manual-renewal-mode` (PR #169) and `0040-adr-a-payment-method-with-no-api-is-a-billing-provider` (PR #170). Keeps the third, `0040-adr-a-provider-may-depend-on-a-capability-and-own-a-scheduled-job` (PR #171), as an idea to carry into the `payment-bkash` provider under a new number.

## Two capabilities, split by what the contract tracks

- **`subscription`** (renamed from `billing`) tracks a relationship over time: which plan a subject is on, whether it is live, when it renews. Its contract is `createCheckout`, `createPortal`, `changePlan`, `cancel`, `restore`, `setQuantity`, `listInvoices`.
- **`payment`** (new) tracks one amount moving once, linked to app data by an opaque `reference_type` and `reference_id`. Its contract creates a payment, records a shopper's submission, confirms, rejects, refunds and handles the vendor's callback.

One capability with a recurring mode was rejected. It would put plan state, lockout and the portal into every project that only sells orders, which is the confusion the rename removes.

`payment` takes providers, not drivers, by [ADR 0037](0037-adr-an-alternate-implementation-that-adds-one-file-is-a-provider-2026-09-08.md)'s third question: a gateway adds one file. A swap moves no rows either. Every `payments` row carries its `provider`, old rows stay as history, and new payments go to the new provider.

## Module names are singular, table names are plural

The capabilities are `subscription` and `payment`, and so are their prefixes: `subscription-stripe`, `payment-manual`. Most capability names are already singular (`email`, `sms`, `storage`, `queue`). Table names stay plural snake_case by [ADR 0038](0038-adr-table-names-are-plural-snake-case-2026-09-12.md): `subscriptions`, `subscription_events`, `payments`, `payment_events`, `payment_refunds`. `@better-auth/stripe` names its model `subscription`, and with `usePlural` it finds the `subscriptions` export without the `modelName` override `billing-stripe` needs today.

## A vendor gets one provider module per capability it serves

Paddle, Polar and PayPal sell both subscriptions and one-time payments. Each gets up to two modules, `subscription-<vendor>` and `payment-<vendor>`, the way Cloudflare already has `email-cloudflare`, `kv-cloudflare`, `queue-cloudflare` and `storage-cloudflare`. Five rules keep the pair from confusing anyone:

1. **`subscription-<vendor>` exists only when the vendor has a subscription object of its own.** Stripe, Paddle, Polar and PayPal have one. SSLCOMMERZ and bKash do not, so they get `payment-<vendor>` only, and `subscription` renews a plan for them by creating a payment through the installed `payment` provider.
2. **The pair shares its env keys.** Both Paddle modules declare `PADDLE_API_KEY`, and the applier merges `envVars` by key, so the developer types it once.
3. **Each module owns its callback path**, `/subscription/callback/<vendor>` and `/payment/callback/<vendor>`. The vendor dashboard gets two webhook destinations, and no shared dispatcher exists.
4. **The pair shares no code.** A shared vendor package would let one capability import another's vendor code, which [ADR 0020](0020-adr-capability-owns-its-vendor-packages-2026-07-24.md) forbids. The duplicate is an auth header and a signature check.
5. **Each provider skill names its partner.** `subscription-paddle`'s skill says to add `payment-paddle` for one-time payments, and the reverse.

One `paddle` module that registers into both capabilities was rejected. It needs two runtime files, depends on both capabilities, and installs a capability the project may not use. AGENTS.md reads that shape as a broken contract.

## A payment method with no API is a `payment` provider

The unmerged PR #170 made bKash Send Money a `billing` provider with a submissions table in the billing core. Under this decision the same flow is `payment-manual`: the shopper pays outside the site, submits the transaction ID, and staff confirm or reject it. The review queue belongs to the `payment` core, because confirm and reject are contract methods every provider answers, even if only `payment-manual` waits on a person.

## `PAYMENT_PROVIDER` is a list

A shop takes bKash through `payment-manual` and card through `payment-sslcommerz` in the same week, so more than one payment provider must be live at once. `PAYMENT_PROVIDER` takes a comma list in priority order. A new payment goes to the first listed provider that supports the method the shopper chose, and the row records that provider, so confirm, refund and the callback always reach the provider that created it. An unset, empty or unknown value still throws at construction; nothing falls back to a default. This is the one `<CAP>_PROVIDER` that takes a list, and AGENTS.md says so. `SUBSCRIPTION_PROVIDER` stays a single value, because a subject has one live subscription with one vendor.

## Money is minor units plus a currency

`amount` is an integer in the currency's minor unit with an ISO 4217 `currency`, as `billing`'s `Invoice` already does. ৳500 is `50000` poisha. A merchant of record (Paddle, Polar) adds tax, so a payment stores the amount the app asked for and the amount the vendor settled. An app that only deals in whole taka keeps that rule in its own code.

## Consequences

- Every `billing` name moves: the modules (`billing`, `billing-console`, `billing-stripe`), `packages/billing` to `packages/subscription`, the tables, `BILLING_*` env keys to `SUBSCRIPTION_*`, `BillingError` to `SubscriptionError`, the `/billing` routes, the admin page and the skills. A project with `billing` installed follows a runbook: remove the old modules, add the new ones, and generate a migration that renames the tables.
- PRs #169, #170 and #171 close unmerged. Their code moves into `payment-sslcommerz`, `payment-manual` and `payment-bkash`, and the renewal parts of #169 move into `subscription`'s renewal through `payment`.
- `CONTEXT.md` renames the billing terms and adds **Payment**, **Payment reference** and **Settled amount**.
- ADR 0034 keeps its number and its file name. Its body gains a note that `billing` is now `subscription`.
