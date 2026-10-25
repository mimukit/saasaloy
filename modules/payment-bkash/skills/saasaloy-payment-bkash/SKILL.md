---
name: saasaloy-payment-bkash
description: Runbook for the payment-bkash provider, one-off payments on bKash Tokenized Checkout with the gateway token held on a scheduled job because bKash rate-limits the call that mints it. Use when setting up a sandbox or live merchant account, mapping the BKASH_* env vars, driving a sandbox payment end to end, refunding, reading a rate-limit block, or settling a payment bKash took that never reached the payments table.
---

# payment-bkash: bKash Tokenized Checkout, with the token on a schedule

`saasaloy add payment-bkash` puts `packages/payment/src/providers/bkash.ts` and `packages/payment/src/env/bkash.ts` into the project, appends `bkash()` to the `providers` array and `bkashEnv()` to the payment env preset, appends `bkashTokenJob()` and `bkashTokenSchedule()` to `packages/queue`'s tables, adds `@repo/kv` to `packages/payment/package.json`, and adds `@repo/payment` to `packages/queue/package.json`. List `bkash` in `PAYMENT_PROVIDER` and `createPayment(env).create({ method: "bkash", ... })` answers a redirect to bKash's hosted page. The admin Payments page, the refund route and the listeners work against it with no change.

Read `modules/payment/skills/saasaloy-payment/` first. This file covers only what differs.

## The flow

1. `create` asks bKash for a tokenized checkout (mode `0011`, intent `sale`) and answers `{ kind: "redirect", url: bkashURL }`. The bKash `paymentID` is kept in `providerData.paymentID`, and the saasaloy payment id is sent as `merchantInvoiceNumber`.
2. The payer pays or cancels on bKash's page. bKash sends the browser to `https://<your-api>/payment/callback/bkash/return/<payment id>?paymentID=…&status=success|cancel|failure`.
3. On `success` the provider calls `execute`, and falls through to `payment/status` on any code it does not map (`2062`, "already completed", first). On `cancel` or `failure` it calls `payment/status` first, so a payment bKash completed is never cancelled. Then the core moves the row out of `pending` and the browser goes on to the payment's `returnUrl`.

**The query string settles nothing.** `status=success` is a hint that `execute` is worth calling. A return whose `paymentID` is not the one stored on the row is refused as `callback_invalid`.

`transactionStatus: "Completed"` is the only success. The amount and currency are compared against the row in minor units, strictly. A mismatch throws `provider_error` with `providerCode: "mismatch"` and the row stays `pending` for a person to reconcile. Not reaching bKash throws `retryable` and settles nothing.

BDT only. A payment in any other currency fails at `create` with `invalid_request`. Amounts are poisha: 499 BDT is `49_900`.

## Refunds

`POST /admin/payment/:id/refund` calls bKash's refund API with the stored `paymentID` and `trxID`, the amount in taka, `sku` = the payment's `referenceType` and `reason` = the refund note. bKash's `refundTrxID` is stored as the refund's `providerRefundId`. A refused refund maps onto `PaymentError` with bKash's code in `providerCode`, and the core releases the reservation.

## The two-calls-an-hour limit

An `id_token` lives 3600 seconds. bKash's documentation says on both the grant and the refresh page: "Do not call this API more than two times within an hour. If you exceed this limit, the API will return an error, and you will be blocked for one hour." Nothing says which endpoint it governs, so the module stays safe under the worst reading: **at most two token calls an hour, of any kind, across the whole deployment.**

- **One caller mints the token.** `bkashTokenJob` runs on cron `*/15 * * * *` and acts only when the stored token expires inside 20 minutes: one call every 45 minutes in the steady state. Request code reads the stored record from `kv`, except once on a cold start, behind a marker key so two first requests cannot both grant.
- **Staging and production must not share an app key.** The budget belongs to the key. Ask bKash for a second set of credentials, or keep staging on `PAYMENT_PROVIDER=console`.
- **Do not add an on-demand refresh.** `cacheAside` has no stampede protection, and `kv-cloudflare` has a 60-second TTL floor and propagation window. An expiry under load becomes the miss storm the limit punishes.

### What a block looks like

A token call answers a non-`0000` `statusCode`, the job's message dead-letters with `providerCode: "token_refused"`, and checkouts fail. The block clears after an hour. Leave the job alone; a restart spends more of the budget.

The record is at key `payment:bkash:token` in your `kv` store (after `KV_KEY_PREFIX`), with `idToken`, `refreshToken`, `expiresAt` and `refreshedAt`. Delete it only when you rotate the app key.

## The scheduled job, and how it reaches its credentials

A queue handler is called as `(payload, ctx)` and gets no `env`. The job reads the credentials and `KV_PROVIDER` through `paymentProviderEnv()`, the provider env port `apps/api/src/payment-store.ts` sets at module load (ADR 0057).

The job runs on every deploy that installed this module, whether or not `PAYMENT_PROVIDER` lists `bkash`. With no credentials it returns after one check and calls nothing. A refused grant is not retryable, because a retry spends the second call of the hour; the next tick is 15 minutes away.

## Setting up

### The sandbox

1. Register at <https://developer.bka.sh> and create a sandbox merchant app. bKash issues an app key, an app secret, a username and a password.
2. Run `saasaloy env` and enter them, then `pnpm env:setup`. Leave `BKASH_MODE` unset.
3. Set `KV_PROVIDER=memory` and `QUEUE_PROVIDER=memory` for local development.
4. Pay with a bKash sandbox wallet number. The sandbox PIN is `12121` and the OTP is `123456`.

### The env vars

| Key | What it is |
|---|---|
| `BKASH_APP_KEY` | the merchant app's key, sent as `X-APP-Key` on every non-token call |
| `BKASH_APP_SECRET` | the secret, sent on the two token calls only. A Worker secret |
| `BKASH_USERNAME` | the `username` header on the two token calls |
| `BKASH_PASSWORD` | the `password` header on the two token calls. A Worker secret |
| `BKASH_MODE` | `live`, or anything else for the sandbox. Only the exact string `live` selects the live host |

### `kv` and `queue` are required

`dependsOn` installs both. Installing them does not configure them. Unset `KV_PROVIDER` makes every bkash call throw `invalid_request` before anything reaches bKash, and `methods()` reports `bkash` unavailable. `kv-memory` is per-isolate, so a deployed Worker on it mints a token per isolate and burns the budget: use `kv-cloudflare` in production.

### The webhook listener

bKash has no self-service webhook registration. Hand this URL to bKash support during onboarding:

```
https://<your-api>/payment/callback/bkash/webhook
```

The notification is not verified, because bKash publishes no signing algorithm. It is trusted for nothing: the provider reads one `paymentID` off the body, asks `payment/status` itself, and finds the row by the `merchantInvoiceNumber` bKash echoes. A forged POST costs one API call and grants nothing. `SubscribeURL` is fetched only over https on a bKash or AWS host.

## A payment bKash took that never reached the table

If the payer pays and closes the tab before the return lands, and no webhook is registered, the row stays `pending`. To settle it by hand, find the payment in bKash's merchant portal, confirm `Completed` and the amount with `payment/status`, and post the return URL yourself: `GET /payment/callback/bkash/return/<payment id>?paymentID=<paymentID>&status=success`. The provider re-reads bKash and settles it; a row already settled is left alone.

## Checklist before you take a real payment

- [ ] A separate app key from staging's.
- [ ] `KV_PROVIDER=cloudflare`, not `memory`.
- [ ] `BKASH_MODE=live`, spelled exactly.
- [ ] The two secrets set with `wrangler secret put`.
- [ ] Payments created in `BDT`, in poisha.
- [ ] The webhook URL handed to bKash support, or the manual path above accepted.
- [ ] One sandbox payment, one cancel and one refund driven end to end and read back on the admin Payments page.
