# 0039 — Billing owns a provider-callback surface and a manual renewal mode

`packages/billing` owns an unauthenticated provider-callback route, a provider may mint events for an operation its vendor has no counterpart for, and manual renewal is a first-class renewal mode. Settled while planning `docs/plans/0061-plan-billing-sslcommerz-provider-2026-09-21.md` for issue #156.

## Status
accepted.

## Context

`billing` was built around one vendor's shape. `billing-stripe` reaches the project through a Better Auth plugin that owns a signature-verified endpoint under `/auth/*`, and Stripe carries a subscription object that charges a stored card on its own schedule. Nothing in `packages/billing` owned an inbound HTTP surface, and nothing in the contract said what to do with a vendor that never renews anything.

SSLCOMMERZ is the gateway a Bangladeshi project actually installs, and Stripe does not serve Bangladesh at all. It breaks all three assumptions:

- **No subscription primitive.** The v4 API opens a session, validates a payment, queries a transaction and refunds one. There is no recurring object and no documented merchant-initiated charge.
- **No signed webhook and no auth plugin.** It POSTs an unauthenticated IPN plus three browser returns to URLs the merchant names. The only proof of payment is a server-to-server validation call the merchant makes itself.
- **No hosted price object.** It is handed a figure. `PlanConfig` carried only `providerIds`, a map of vendor price ids, so there was no honest place to put an amount.

A provider module is one runtime file plus its registration (AGENTS.md). Two shapes were rejected against that rule. A route file in `apps/api` would put vendor code where ADR 0020 forbids it and break the one-file rule. A Better Auth plugin that exists only to own a URL would make every future gateway depend on the auth package to receive a POST.

## Decision

Three claims, recorded together because a provider for a gateway of this kind needs all three or none.

**1. The core owns an unauthenticated provider-callback surface.** `apps/api/src/routes/billing.ts` serves `POST|GET /billing/callback/:provider/*` outside `guard`, and `BillingProvider` gains an optional `handleCallback(env, request, path)` returning `{ kind: "event" }`, `{ kind: "redirect" }` or `{ kind: "ignored" }`. The route refuses any `:provider` that is not the active `BILLING_PROVIDER`, answers 404 for a provider with no handler, enqueues a returned event and answers a returned redirect with a 303.

The route parses nothing. It hands the raw `Request` over, because a gateway's callback is form-encoded rather than JSON and the core must not learn any vendor's wire format.

Unauthenticated is safe only under a rule the contract states and every provider must keep: **nothing on the request is evidence**. A provider verifies every fact it acts on against the vendor's own API, over a connection the caller cannot forge, before it mints an event. `billing-sslcommerz` reads one field off a callback — `val_id` — and treats it as a lookup key.

**2. A provider may mint events for an operation the vendor has no counterpart for.** `billing-console` already did this for every method. The rule is now general: `cancel`, `restore` and a trial checkout may return a `CheckoutResult.event` built from `SubjectInput.current`, because a gateway with no subscription object has nothing to tell and nothing to be told by. The projection keeps one writer either way — the event path (ADR 0034) — so no provider writes a row.

**3. Manual renewal is a renewal mode, not a workaround.** `BillingProvider.renewal` is `"vendor"` unless a provider declares `"manual"`. Manual means nothing is stored and nothing recurs; each period is a fresh checkout the subject pays. Four things support it in the core:

- `billing_subscriptions.provider`, written by `applyEvent` from `BillingEvent.provider` and never settable through `SubscriptionInput`, so no provider can name another on a row and take its renewals.
- `billing.renewal-due`, a daily job that sets `past_due` on a manually renewed row whose paid period has ended, and sends one `renewal_due` notification per row.
- `POST /billing/renew`, which opens a fresh checkout for the plan already on the row, and refuses while the period end is in the future.
- `PlanConfig.price`, `{ amount, currency }` per interval in the currency's minor unit, for a provider that is handed a figure. A plan carrying either price field counts as paid, so the default plan is the one that carries neither.

## Consequences

- A gateway with no plugin and no recurring object is now a one-file provider, which is what the module rule asks for. A second such gateway — bKash's own API, a Nepali or Sri Lankan aggregator — adds one file and nothing else.
- `billing` now has an unauthenticated public route. It is the only one, and its safety rests entirely on providers verifying against the vendor. A provider that believed a callback body would let anyone on the internet write a paid subscription. That rule is stated in the contract's doc comment, in the capability skill, and here.
- `renewal_due` is a fourth notification kind with its own template. Reusing `payment-failed` was rejected: under manual renewal nothing was charged and no card was refused, so the dunning notice would be untrue for every reader.
- The lockout path is unchanged and is reused whole. The renewal job only has to produce the `past_due`; `billing.past-due-lockout` still takes the plan away after `BILLING_LOCKOUT_DAYS`.
- A plan change mid-period costs full price, with the days left on the old period added to the new one. There is no proration primitive at a gateway like this and no credit concept in the core.
- Rows written before the `provider` column existed carry no provider. The renewal sweep leaves them alone, which is the right answer: they belong to whatever was installed then, and a vendor-renewing provider wants no sweep.

## Alternatives rejected

- **A route file in `apps/api` shipped by the provider module.** Breaks the one-file provider rule and puts vendor code in a workspace ADR 0020 keeps it out of.
- **A Better Auth plugin that exists only to own a URL.** Makes receiving a POST a reason to depend on the auth package, for every future gateway.
- **Smuggling the amount into `providerIds`** as `{ sslcommerz: { monthly: "499.00" } }`. The field is a map of vendor price *ids*, and a figure in it would be a float in a string with no currency beside it.
- **A reconciliation job over the Transaction Query API.** The browser return already closes a lost IPN. The residual gap — IPN lost *and* the subject closes the tab — is documented in the provider's skill and is a follow-up if it ever appears in practice.
