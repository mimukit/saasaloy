---
name: saasaloy-payment
description: Runbook for the payment capability, a vendor-blind one-time payment core in packages/payment with per-provider modules (payment-console for development, later payment-manual, payment-sslcommerz, payment-bkash). Use when taking a payment for an order or any other app record, writing the shopper route that starts one, reacting to a status change with a listener, reviewing manual payments, recording a refund, choosing PAYMENT_PROVIDER, or writing a payment provider.
---

# payment: one-time payments from `packages/payment`

`packages/payment` (`@repo/payment`) is the capability core. It holds the provider contract, the provider registry, the status machine, the listeners and one error type. It has zero runtime dependencies and names no vendor. Each provider is its own module that drops one file into `src/providers/` and registers itself in the `providers` array in `src/index.ts`.

Callers import `@repo/payment`, call `createPayment(env)`, and never learn which provider took the money.

`payment` is for one-time payments linked to an app record, such as an order. Recurring plans belong to `subscription` (ADR 0045).

## The payments table is the source of truth

The `payments` row is the record. A manual payment has no vendor record at all, so nothing else can answer "is order 42 paid". Read the row by reference (`reference_type`, `reference_id`) when you need to know. Do not keep a second "paid" flag on your order and trust it over the row. A listener (below) may update your order, but it can fail, and the row stays correct when it does.

The core is the only writer of `payments`, `payment_events` and `payment_refunds`. Every status change appends one `payment_events` row. A provider never writes the database.

## Statuses

| Status | Means | Moves to |
| --- | --- | --- |
| `pending` | Created. The payer has not paid, or has not told us yet. | `submitted` (manual `submit`), `successful` / `failed` / `cancelled` (gateway callback) |
| `submitted` | The payer submitted a transaction id. Staff review it. | `successful` (confirm), `failed` (reject) |
| `successful` | The money arrived. | nothing; refunds are rows, not a status |
| `failed` | Rejected by staff or declined at the gateway. | nothing |
| `cancelled` | The payer gave up at the gateway. | nothing |

`confirm` and `reject` are conditional updates on `status = 'submitted'`. Two staff who click at once get one success and one `conflict`. A gateway verdict is a conditional update out of `pending` or `submitted`, and a replay of a verdict already applied changes nothing.

A rejected or cancelled payment frees its transaction id. The partial unique index on `(provider, transaction_id_normalized)` covers only rows whose status is not `failed` or `cancelled`, so a payment rejected by mistake can be submitted again. A second live claim on the same id answers `duplicate_transaction`.

## Env checklist

| Key | Required | What it does |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | yes | A comma list of providers in priority order, e.g. `manual,sslcommerz`. Unset, empty or an unknown name throws when `createPayment(env)` builds the client. There is no default. |
| `PAYMENT_APP_URL` | no | The origin a `returnUrl` may name, e.g. `https://shop.x.com`. Unset, only `http://localhost` origins pass. |
| `BETTER_AUTH_URL` | from `auth` | The api's own origin. A redirect provider builds its callback URL on it, so a gateway provider needs it set. |

`PAYMENT_PROVIDER` is a list because a shop takes bKash by hand and cards through a gateway at once. `create({ method })` picks the first listed provider whose `methods()` has that method available, and stores the provider name on the row. Every later call on that payment goes to the stored provider, even when the list changes. A callback is accepted only for a provider still in the list.

## Start a payment: the shopper route pattern

The core ships no shopper routes. Only your app knows whether this user may pay for this order, so your route checks that first and then calls the core. Put it in `apps/api/src/routes/<feature>.ts` and register it with a `chained-route` link like any other route.

```ts
import { createPayment, PaymentError } from "@repo/payment";
import { requireSession, withAuthScope } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import { Hono } from "hono";

import { createPaymentStore, withPaymentStore } from "../payment-store";
import { paymentErrorStatus } from "./payment";
import type { PaymentBindings } from "./payment";

export const checkoutRoute = new Hono<{ Bindings: PaymentBindings }>().post(
  "/orders/:id/pay",
  (c) =>
    withAuthScope(c, async () => {
      const session = await requireSession(c);
      return withDb(c, (db) =>
        withPaymentStore(createPaymentStore(db), async () => {
          // 1. Authorize the reference. The core never does this.
          const order = await findOrderForUser(db, c.req.param("id"), session.user.id);
          if (!order) {
            return c.json({ error: { code: "not_found", message: "no such order" } }, 404);
          }
          try {
            // 2. Ask the core. The amount comes from your record, never from the browser.
            const { payment, next } = await createPayment(c.env).create({
              amount: order.totalMinor,
              currency: "BDT",
              method: "card",
              referenceId: order.id,
              referenceType: "order",
              returnUrl: `https://shop.x.com/orders/${order.id}`,
              userId: session.user.id,
            });
            // 3. Hand the next step to the browser: a redirect, instructions, or a token.
            return c.json({ next, paymentId: payment.id }, 200);
          } catch (error) {
            if (error instanceof PaymentError) {
              return c.json({ error: { code: error.code, message: error.message } }, paymentErrorStatus(error));
            }
            throw error;
          }
        })
      );
    })
);
```

`withPaymentStore` is optional. Without it the core opens its own database client for the call through the runner `apps/api/src/payment-store.ts` registers, so a plain `createPayment(c.env).create(...)` also works. Wrapping saves a second connection under `database-postgres`.

`next` is one of three kinds:

- `{ kind: "redirect", url }`: a hosted checkout. Send the browser to `url`. The gateway calls back to `/payment/callback/<provider>/...`, and the browser comes back to `returnUrl`.
- `{ kind: "instructions", instructions }`: a manual method. Show `instructions.account` and the `instructions.fields`, then post what the payer types to your own route, which calls `createPayment(c.env).submit(paymentId, { transactionId, senderAccount, amount })`. Authorize that route the same way.
- `{ kind: "client", token }`: an embedded form. Hand `token` to the vendor's browser SDK.

Amounts are integers in the currency's minor unit. `125000` with `BDT` is 1,250.00 taka.

## React to a status change: listeners

Register a listener in `packages/payment/src/index.ts`:

```ts
export const payment = definePayment({
  providers: [consolePayment()],
  listeners: [onPaymentChange],
});
```

The core awaits every listener in order, inline, after each status write, with `(env, { payment, from, to })`. The creation counts as a change from `null` to `pending`. A listener that throws is logged with `console.error` and the payment id, and the API call still succeeds. So:

- Make a listener idempotent. A retry or a replayed callback can call it twice for the same outcome.
- Never make a listener the only record of anything. Read the `payments` row when in doubt.
- Keep it short. It runs inside the request that changed the status.

### Example: the rejection notice

The core sends no email and does not depend on `email`. This listener sends the notice from PR #170 through the app's own email capability when staff reject a submission. It lives in your app, for example `packages/payment/src/listeners/rejection-notice.ts`, and needs `@repo/email` in `packages/payment/package.json`.

```ts
import type { PaymentListener } from "../provider";
import { createEmail } from "@repo/email";
import type { EmailEnv } from "@repo/email";

export const rejectionNotice: PaymentListener = async (env, { payment, to }) => {
  if (to !== "failed" || payment.transactionId === null) {
    return; // Only a rejected submission, not a declined card.
  }
  const email = await lookUpPayerEmail(env, payment.userId); // your own query
  if (!email) {
    return;
  }
  await createEmail(env as EmailEnv).send({
    to: email,
    subject: "We could not confirm your payment",
    html: `<p>We could not match transaction <b>${payment.transactionId}</b> to a payment we received. Please check the id and submit it again.</p>`,
  });
};
```

The staff reason and note are on the latest `payment_events` row for the payment. Read them there if the email should quote the note.

## Staff routes

`apps/api/src/routes/admin-payment.ts` is mounted at `/admin/payment` and every route opens with `requireAdmin`.

| Route | Body | Answers |
| --- | --- | --- |
| `GET /admin/payment/payments?status=` | none | `{ payments, counts }`. Without `status`, every payment. `submitted` lists oldest first. |
| `GET /admin/payment/payments/:id` | none | `{ payment, events, refunds }` |
| `POST /admin/payment/payments/:id/review` | `{ action: "confirm", note? }` or `{ action: "reject", reason, note? }` | the detail shape |
| `POST /admin/payment/payments/:id/refunds` | `{ amount, note? }` | the detail shape |

`reason` is one of `amount_mismatch`, `not_found`, `duplicate`, `other`. Errors use the api envelope `{ error: { code, message } }`. The status per code: `not_found` 404; `conflict` and `duplicate_transaction` 409; `invalid_request`, `method_unavailable` and `callback_invalid` 400; `rate_limited` 429; `declined` and `provider_error` 502.

A refund is allowed only on a `successful` payment, and the sum of a payment's refunds stays at or below its `amount`. The core reserves the amount with a conditional update before it calls the provider and releases it if the provider refuses. There is no `refunded` status: read `refundedAmount`.

## Providers

| Module | `PAYMENT_PROVIDER` name | Methods | Notes |
| --- | --- | --- | --- |
| `payment-console` | `console` | `card` | Development only. A fake hosted checkout, no account, no network. |

### payment-console: development only

`saasaloy add payment-console`, then set `PAYMENT_PROVIDER=console`. `create` answers a redirect to `/payment/callback/console/checkout/<id>` on the api origin. That page shows the amount with a Pay and a Cancel button, and the form posts to `/payment/callback/console/complete`. Pay moves the payment to `successful` with `settled_amount` equal to `amount`, Cancel moves it to `cancelled`, and the browser goes to the payment's `returnUrl`. A refund logs a line and returns a fake refund id.

Never list `console` in a deployed environment. Anyone who can reach the api can post Pay for any pending console payment.

## Write a provider

A provider is one file, `packages/payment/src/providers/<name>.ts`, exporting a factory that returns a `PaymentProvider` (see `src/provider.ts`), plus a `plugin-array` patch into `providers`. See `.agents/skills/create-provider/` in the saasaloy repo.

- Every method takes `env` whole. Read your secrets off it, never `process.env`.
- `methods(env)` lists what you know, with `available: false` for a method you cannot take here. The core skips an unavailable method when it picks a provider.
- `create(env, { payment, callbackUrl })` runs after the core wrote the `pending` row. Use `callbackUrl("path")` for the URL your gateway calls back. Return `providerData` for anything you need on a later call; the core merges it into the row.
- `submit` is optional. Return `transactionIdNormalized`, because the duplicate check runs on it. Without `submit`, the core answers `invalid_request`.
- `handleCallback(env, request, path, ctx)` gets the whole request and a read-only `ctx.payment(id)`. Verify every fact against your vendor before you return an `outcome`. Return `event`, `redirect`, `response` or `ignored`.
- Normalize your failures into `PaymentError` with a code from the list above, the vendor's code in `providerCode`, and an honest `retryable`. The core wraps anything else as `provider_error`.

## Boundaries to honor

- The core never reads app tables and never authorizes a reference. Your routes do.
- A provider never writes the database. It returns what happened; the core writes.
- `payment` does not depend on `queue` or `email`. A listener that needs either imports it in your app.
- A schema change to the three tables needs `db:generate` and a migration, like any table.
