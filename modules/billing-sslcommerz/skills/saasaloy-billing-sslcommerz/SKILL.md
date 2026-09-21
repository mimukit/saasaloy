---
name: saasaloy-billing-sslcommerz
description: Runbook for the billing-sslcommerz provider — subscriptions on SSLCOMMERZ, Bangladesh's aggregator gateway, as repeated one-off payments with no stored card. Use when setting up a sandbox or live store, registering the four callback URLs, pricing a plan in BDT, driving a sandbox payment end to end, explaining manual renewal to a subject, or reading a payment that never settled.
---

# billing-sslcommerz — subscriptions on a gateway with no subscriptions

`saasaloy add billing-sslcommerz` puts one file in `packages/billing/src/providers/sslcommerz.ts` and appends `sslcommerzBilling()` to the `providers` array. Set `BILLING_PROVIDER=sslcommerz` and the existing billing routes, the admin billing page, the entitlement reads and the dunning emails all work against it with no change to any consumer.

Read `modules/billing/skills/saasaloy-billing/` first. This file covers only what differs.

## What this gateway cannot do, and what the module does instead

SSLCOMMERZ v4 opens a hosted session, validates a payment, queries a transaction and refunds one. It has **no recurring object**, no card this project may store, and no merchant-initiated charge in the public documentation.

So a subscription here is a run of one-off payments, one per period, each paid by the subject on a hosted page. The provider declares `renewal: "manual"`. The daily `billing.renewal-due` job marks a row `past_due` when its period ends and emails the subject a pay-now link; `billing.past-due-lockout` takes the plan away `BILLING_LOCKOUT_DAYS` later if nobody pays. Tokenized recurring charging needs an account-level agreement that cannot be tested in sandbox, and it is out of scope.

There is also **no vendor portal** (`createPortal` returns the caller's own url), **no invoice list** (`listInvoices` returns `[]`), and **no signed webhook** — see "Why the IPN is not trusted" below.

## Setting up

1. Open a sandbox store at <https://developer.sslcommerz.com/registration/>. You get a store id and a store password within minutes, and no company documents are needed. A live store needs a registered business and takes days.
2. Set the five env vars. In development they go in `apps/api/.dev.vars`; on a deployed Worker use `wrangler secret put` for the two credentials.

| Var | What it is |
|---|---|
| `SSLCOMMERZ_STORE_ID` | The store id from the merchant panel. |
| `SSLCOMMERZ_STORE_PASSWORD` | The store password issued with it. A secret; it is sent on every session open and every validation call. |
| `SSLCOMMERZ_MODE` | `live` for the live gateway, anything else for the sandbox. Optional, and it fails safe: only the exact lower-case string `live` selects production. |
| `SSLCOMMERZ_CALLBACK_URL` | The https origin of your deployed api Worker, no trailing path. The four callback URLs are built under it. |
| `SSLCOMMERZ_RECEIPT_EMAIL` | A real mailbox you own. The gateway requires `cus_email` and mails its own receipt there. A provider never learns the subject's own address, so this is the one it can name. |

3. Register the IPN URL in the merchant panel, under **My Stores → IPN Settings**:

```
https://<your-api>/billing/callback/sslcommerz/ipn
```

The other three travel on each session and need no registration, but they are worth knowing, because they are where the subject's browser lands:

```
https://<your-api>/billing/callback/sslcommerz/return/success
https://<your-api>/billing/callback/sslcommerz/return/fail
https://<your-api>/billing/callback/sslcommerz/return/cancel
```

4. Price your plans in BDT, in `packages/billing/src/plans.ts`:

```ts
{
  id: "pro",
  name: "Pro",
  price: {
    monthly: { amount: 49_900, currency: "BDT" },  // 499.00 BDT
    yearly: { amount: 499_000, currency: "BDT" },
  },
}
```

`amount` is in **poisha**, the minor unit. Any currency but `BDT` is refused at checkout with `invalid_request` naming the plan: an SSLCOMMERZ store is provisioned for a currency set, and a mismatch would otherwise surface only after the subject had paid.

## Driving a sandbox payment end to end

The gateway has to reach your api, so a laptop behind NAT needs a tunnel (`cloudflared tunnel --url http://localhost:4000`). Point `SSLCOMMERZ_CALLBACK_URL` at the tunnel host.

1. `POST /billing/checkout` with `planId`, `interval`, `successUrl` and `cancelUrl`. The answer's `url` is the gateway's hosted page.
2. Open it. Pick any method; the sandbox lists test cards and test MFS accounts on the page itself.
3. Pay. The gateway posts the IPN to your api, and redirects the browser to `return/success`.
4. The row is written by the `billing.event` consumer, not by the route. With `queue-memory` it is there immediately; with `queue-cloudflare` it lands a moment later.
5. `GET /billing/subscription` answers `active` with the plan.

To develop with no gateway at all, switch `BILLING_PROVIDER=console`. There is no local SSLCOMMERZ stub, on purpose: `billing-console` is the offline path.

## Why the IPN is not trusted

The IPN is an unauthenticated POST. Anyone on the internet can send one, and `verify_sign` is not usable — SSLCOMMERZ does not specify the hash input.

So the provider reads exactly one field off a callback, `val_id`, and treats it as a lookup key. Then it asks the Order Validation API what that id is worth, over TLS, to a host it names itself. Every fact it acts on comes off that answer: the status, the amount, the currency, and the subject and plan it carried through `value_a`–`value_c`.

The answer is then judged, not just read:

- `VALID` and `VALIDATED` are both success. The gateway answers `VALID` the first time and `VALIDATED` after, so a browser return following an IPN reads `VALIDATED` for a payment that did go through.
- `tran_id`, `currency_type` and `currency_amount` must match what the plan costs, compared in minor units with no rounding towards agreement. A payment short by one poisha is refused with `provider_error`, never accepted.
- `FAILED`, `CANCELLED`, `UNATTEMPTED`, `EXPIRED` and `INVALID_TRANSACTION` mint `payment.failed`.
- `PENDING` writes nothing and waits.
- **Any other status throws.** A word this provider has not read is a gap in its list, not a failed payment, and failing a charge on one would close a payment that took the subject's money.
- **An unreachable gateway is never a failure.** It throws `provider_error` with `retryable: true`, so the queue tries again. Not being able to ask is not an answer.

The IPN and the browser return both run that same validation call and both mint the event under the same `val_id`. `(provider, providerEventId)` is the `billing_events` primary key, so whichever lands second runs no side effect. That is what closes a lost IPN with no reconciliation job.

## What the subject sees

| Moment | What happens |
|---|---|
| First payment | Hosted page, then `return/success` → `BILLING_APP_URL?billing=paid`. The row is `active` until `periodEnd`. |
| Period ends | `billing.renewal-due` (02:00 UTC) sets `past_due` and sends the `renewal-due` email with a pay-now link. The plan still works. |
| They pay | `POST /billing/renew` opens a fresh checkout for the same plan and interval. A new period starts from the payment. |
| They do not | `billing.past-due-lockout` (03:00 UTC) sets `lockedAt` after `BILLING_LOCKOUT_DAYS`, and the subject drops to the default plan. A later payment clears the lock. |
| They change plan | Full price for the new plan, and the whole days left on the old period are added to the new one. There is no proration. |
| They cancel | The row is marked `cancelAtPeriodEnd`. Nothing is charged either way, because nothing is stored. |

`POST /billing/renew` refuses three things: a row that is not `past_due`, a provider that renews at the vendor, and a period whose end is still in the future. The third is what stops a subject paying twice inside one period.

## The one gap

If the IPN is lost **and** the subject closes the tab before the browser return lands, a real payment is never reported. The row stays as it was and the subject is asked to pay again.

Nothing in this module covers that. The Transaction Query API can be asked "what became of this `tran_id`?", and a reconciliation job over it is the fix, but it needs the `tran_id` stored against the subject and the projection deliberately stores no pending checkout. File an issue if it ever shows up in practice; the browser return closes every case seen so far.

## Reading a payment by hand

The row's `metadata` carries the gateway's own answer: `valId`, `bankTranId`, `rawStatus`, `riskLevel`, `storeAmount` and `carriedDays`. `storeAmount` is what reaches the merchant account after the gateway's cut; `amount` is what the subject paid. `riskLevel` of `1` is carried and never acted on — the money moved either way, and holding a paid subscription on a flag would lock out a subject who had paid.

Every id this provider mints is prefixed `sslcz_`, so a `sslcz_`-prefixed id in a table says which provider wrote the row.
