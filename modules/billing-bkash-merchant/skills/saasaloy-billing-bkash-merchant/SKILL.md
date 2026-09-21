---
name: saasaloy-billing-bkash-merchant
description: Runbook for the billing-bkash-merchant provider — subscriptions on bKash Tokenized Checkout as repeated one-off payments, with the gateway token held on a scheduled job because bKash rate-limits the call that mints it. Use when setting up a sandbox or live merchant account, mapping the five BKASH_MERCHANT_* env vars, driving a sandbox payment end to end, reading a rate-limit block, or settling a payment bKash took that never reached the projection.
---

# billing-bkash-merchant — bKash Tokenized Checkout, with the token on a schedule

`saasaloy add billing-bkash-merchant` puts one file in `packages/billing/src/providers/bkash-merchant.ts`, appends `bkashMerchantBilling()` to the `providers` array, appends `bkashTokenJob()` and `bkashTokenSchedule()` to `packages/queue`'s tables, and adds `@repo/kv` to `packages/billing/package.json`. Set `BILLING_PROVIDER=bkash-merchant` and the existing billing routes, the admin billing page, the entitlement reads and the dunning emails all work against it with no change to any consumer.

Read `modules/billing/skills/saasaloy-billing/` first. This file covers only what differs.

## What this gateway cannot do, and what the module does instead

bKash Tokenized Checkout (v1.2.0-beta) creates a payment, sends the customer to a hosted `bkashURL`, and executes the payment when they come back. It has **no recurring object a merchant may charge on its own**.

Agreement mode looks like the answer and is not. `create-agreement` (mode `0000`) returns a `bkashURL` the customer must visit with a wallet number and an OTP, and `create-payment` in mode `0001` **also** returns a `bkashURL` where the customer enters a wallet number, an OTP and a PIN. The merchant cannot charge a stored agreement unilaterally, so an agreement buys a slightly shorter second form and no recurring billing. This module uses mode `0011` only, and stores no agreement.

So a subscription here is a run of one-off payments, one per period. The provider declares `renewal: "manual"`. `billing.renewal-due` marks a row `past_due` when its period ends and emails a pay-now link; `billing.past-due-lockout` takes the plan away `BILLING_LOCKOUT_DAYS` later if nobody pays.

There is also **no vendor portal** (`createPortal` returns the caller's own url), **no invoice list** (`listInvoices` returns `[]`), and **no refund path** — `BillingProvider` exposes no refund method. Refund in bKash's merchant portal instead, then cancel the row.

## The two-calls-an-hour limit, which shapes everything else

This is the fact to carry into every decision about this module.

An `id_token` lives 3600 seconds. bKash's own documentation carries this sentence on **both** the grant page and the refresh page:

> Do not call this API more than two times within an hour. If you exceed this limit, the API will return an error, and you will be blocked for one hour.

Nothing public says which of the two endpoints the limit governs. `refresh-token-3` separately states that the refresh token's lifetime "matches the `id_token`'s default expiration of 3600 seconds", which contradicts the 28-day figure every community package assumes. Both questions are unresolved, so the module is built to be safe under the worst reading of each: **at most two token calls an hour, of any kind, across the whole deployment.**

Three rules follow, and two of them are yours to keep.

**One caller mints the token.** `bkashTokenJob` runs on cron `*/15 * * * *` and acts only when the stored token expires inside 20 minutes. In the steady state that is one call every 45 minutes and never two inside one hour, with spare ticks to recover a failed call. Request code reads the stored record from `kv` and never calls a token endpoint — except once, on a cold start, behind a marker key so two concurrent first requests cannot both grant.

**Staging and production must not share an app key.** The limit is a budget on the app key, not on a Worker. Two environments on one key share two calls an hour and will block each other, at a time neither team chose. Ask bKash for a second set of credentials, or keep staging on `BILLING_PROVIDER=console`.

**Do not add an on-demand token refresh.** `cacheAside` in `packages/kv` is the obvious shortcut and it is unusable here: it has no stampede protection, and `kv-cloudflare` carries a 60-second TTL floor plus a 60-second propagation window. An expiry under load becomes a miss storm, which is precisely the call pattern the limit punishes.

### What a block looks like

A token call answers a non-`0000` `statusCode` and every subsequent call fails, because no usable token can be minted. The block lasts an hour and clears on its own; there is no way to lift it early. The job keeps ticking and will recover by itself once the hour is out — leave it alone rather than restarting anything, which only spends more of the budget.

The stored record is at key `billing:bkash-merchant:token` in your `kv` store, holding `idToken`, `refreshToken`, `expiresAt` and `refreshedAt`. Read `refreshedAt` to see when the last successful call was. Delete the key only when you are rotating the app key.

## Setting up

### The sandbox

1. Register at <https://developer.bka.sh> and create a sandbox merchant app. bKash issues an **app key**, an **app secret**, a **username** and a **password**. All four are needed; the username is not your wallet number and not your portal login.
2. Use bKash's published sandbox wallet numbers to pay. The sandbox PIN is `12121` and the sandbox OTP is `123456`.
3. `BKASH_MERCHANT_MODE` may be left unset. Only the exact string `live` selects the live gateway, so a typo sends a test payment to the sandbox rather than a real one to production.

### Going live

bKash issues live merchant credentials through its own onboarding, not self-service. Ask for a **separate** app key for production, for the reason above.

### The env vars

| Set this | Every tutorial calls it | What it is |
|---|---|---|
| `BKASH_MERCHANT_APP_KEY` | `BKASH_APP_KEY` | the merchant app's key, sent as `X-APP-Key` on every non-token call |
| `BKASH_MERCHANT_APP_SECRET` | `BKASH_APP_SECRET` | the secret, sent on the two token calls only |
| `BKASH_MERCHANT_USERNAME` | `BKASH_USERNAME` | the `username` header on the two token calls |
| `BKASH_MERCHANT_PASSWORD` | `BKASH_PASSWORD` | the `password` header on the two token calls |
| `BKASH_MERCHANT_MODE` | — | `live`, or anything else for the sandbox |

The `MERCHANT` segment is deliberate: it keeps these clear of `billing-bkash-personal`'s keys when both modules are on disk. Every community tutorial uses the bare names in the middle column, so translate when you copy one.

The three secrets belong in `apps/api/.dev.vars` locally and in `wrangler secret put` for a deployed Worker. Never in `wrangler.jsonc`.

### `kv` is required, and so is `KV_PROVIDER`

The gateway token lives in the `kv` capability, so `dependsOn` installs it. Installing it does not configure it: set `KV_PROVIDER=memory` locally or `KV_PROVIDER=cloudflare` for a deployed Worker. Unset, every billing call throws `invalid_request` naming `KV_PROVIDER` before anything reaches bKash.

`memory` is per-isolate, so a deployed Worker on `kv-memory` would mint a token per isolate and burn the budget. Use `kv-cloudflare` in production.

### Pricing a plan

BDT only. bKash settles no other currency, so a plan whose `price` for the interval names anything else throws `invalid_request` at checkout, naming the plan and the currency.

Amounts are in **poisha**, the minor unit: 499 BDT is `49_900`.

```ts
// packages/billing/src/plans.ts
{ id: "pro", name: "Pro", price: { monthly: { amount: 49_900, currency: "BDT" } } }
```

### The callback URL

There is nothing to configure. The provider builds `https://<your-api>/billing/callback/bkash-merchant/return` from the request that opened the checkout, so it follows your deployment with no fifth secret to keep in step. That works because bKash takes the callback on the `create` call, inside a real request — SSLCOMMERZ registers its IPN URL up front and therefore needs `SSLCOMMERZ_CALLBACK_URL`.

### The webhook listener

bKash has **no self-service webhook registration**. A merchant hands its listener URL to bKash support during onboarding. Yours is:

```
https://<your-api>/billing/callback/bkash-merchant/webhook
```

There is no webhook in sandbox, so this cannot be tested before you are live. Read the manual-recovery section below before you decide to skip it.

## Why the notification is not verified, and why that is safe

bKash POSTs an SNS-shaped notification carrying `Signature`, `SignatureVersion` and `SigningCertURL`. Neither the canonical string nor the signing algorithm is published, and there is no sandbox to discover them against.

So this module **verifies nothing and trusts nothing**. It reads one identifier off the body — `paymentID`, in the body or inside SNS's `Message` envelope — and then asks `payment/status` what that payment is actually worth, over TLS, from a host the module names. Every fact the event is built from comes off that answer.

A forged or replayed notification therefore costs one API call and grants nothing:

- the payment id is unknown → `payment/status` refuses → the callback answers 204 and nothing is written;
- the payment id is real and already settled → the event carries the same `trxID`, which is half the `billing_events` primary key, so `applyEvent` conflicts and runs no side effect twice.

Signature verification written against a guessed algorithm would look like a guarantee and would silently drop every real notification if the guess were wrong. That is strictly worse than trusting the body for nothing.

The `SubscriptionConfirmation` handshake fetches `SubscribeURL` **only** when its host is a bKash or AWS SNS domain and the scheme is https. Without that check an unauthenticated public route would fetch any URL a stranger named.

## Settling a payment, and what settles nothing

`execute` is the first attempt and the normal one. It falls through to `payment/status` on any code this module does not recognise — `2062`, "payment already completed", first among them, which is what a second browser return or a return racing the webhook produces.

**The callback query string settles nothing.** `status=success` on the browser return is a hint that `execute` is worth calling, never a statement that money moved.

`transactionStatus: "Completed"` is the only success. The amount and the currency are compared against the plan's price **in minor units**, strictly, with no rounding towards agreement; a mismatch throws `provider_error` and grants nothing. Not being able to reach bKash throws `retryable` and settles nothing either way — an `execute` that timed out says nothing about whether the payment went through.

### A payment bKash took that never reached the projection

This is the one gap, and it is why the webhook is worth registering.

The browser return is what normally settles a payment. If the customer pays and then closes the tab before the redirect lands, and you registered no webhook listener, the money moved and no row was written.

To settle it by hand:

1. Find the payment in bKash's merchant portal. Note its `paymentID` and `trxID`.
2. Call `payment/status` for that `paymentID` with a current token, and confirm `transactionStatus: "Completed"` and the amount.
3. Write the period onto the subject's row the way any other `payment.succeeded` event would: same plan, `periodStart` now, `periodEnd` now plus the interval. Use `trxID` as the `billing_events` `provider_event_id`, so a webhook that arrives late is a no-op rather than a second period.

A reconciliation job would close this automatically, and it needs a created-but-unsettled payments table this module deliberately does not add. That is its own follow-up issue.

## The scheduled job, and how it reaches its credentials

`bkashTokenJob` registers in `packages/queue`'s `jobs` table and `bkashTokenSchedule` in its `schedules` table, both patched in by this module. A queue handler is called as `(payload, ctx)` and gets no `env`, so the job reads the four credentials and `KV_PROVIDER` through `billingProviderEnv()` — the provider env port `apps/api/src/billing-store.ts` registers at module load (ADR 0040, and CONTEXT.md → "Provider env port").

The job runs on every deploy that installed this module, whether or not `BILLING_PROVIDER` names it. With no bKash credentials set it returns after one KV read and calls nothing.

A refused grant throws and is deliberately **not** retryable: a retry would spend the second of the hour's two calls on the same refusal, and the next tick is 15 minutes away. The message dead-letters, which is where to read it from.

## No proration, and no seats

A plan change costs full price for the new plan, with the days left on the old period added to the new one. bKash has no proration primitive and the core has no credit concept.

`setQuantity` validates its argument and does nothing. Seats are a follow-up issue everywhere.

## Checklist before you take a real payment

- [ ] A **separate** app key from staging's.
- [ ] `KV_PROVIDER=cloudflare`, not `memory`.
- [ ] `BKASH_MERCHANT_MODE=live`, spelled exactly.
- [ ] The three secrets set with `wrangler secret put`, not in `wrangler.jsonc`.
- [ ] Every paid plan priced in `BDT`, in poisha.
- [ ] The webhook listener URL handed to bKash support, or the manual-recovery path above understood and accepted.
- [ ] One sandbox payment driven end to end, and the row it wrote read back in the admin billing page.
