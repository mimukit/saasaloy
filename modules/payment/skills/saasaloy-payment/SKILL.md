---
name: saasaloy-payment
description: Runbook for the payment capability, a vendor-blind one-time payment core in packages/payment with per-provider modules (payment-console for development, payment-manual for bKash, Nagad, Rocket and bank transfers staff confirm by hand, later payment-sslcommerz, payment-bkash). Use when taking a payment for an order or any other app record, writing the shopper route that starts one, reacting to a status change with a listener, reviewing manual payments, recording a refund, choosing PAYMENT_PROVIDER, or writing a payment provider.
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
| `payment-manual` | `manual` | `bkash`, `nagad`, `rocket`, `bank` | The shopper pays outside the site and submits the transaction ID. Staff confirm on the Payments page. Nothing is verified automatically. Accounts are options in `manual({ methods })`. See the section below. |

### payment-console: development only

`saasaloy add payment-console`, then set `PAYMENT_PROVIDER=console`. `create` answers a redirect to `/payment/callback/console/checkout/<id>` on the api origin. That page shows the amount with a Pay and a Cancel button, and the form posts to `/payment/callback/console/complete`. Pay moves the payment to `successful` with `settled_amount` equal to `amount`, Cancel moves it to `cancelled`, and the browser goes to the payment's `returnUrl`. A refund logs a line and returns a fake refund id.

Never list `console` in a deployed environment. Anyone who can reach the api can post Pay for any pending console payment.

### payment-manual: payments a person checks

**Nothing verifies a manual transaction automatically.** No wallet or bank this provider names has an API it calls. There is no IPN, no webhook, no query endpoint, and no way for the project to ask whether a transaction ID is real. The provider shows the account to pay, checks the shape of what the shopper types, and stops a second live claim on the same transaction ID. Every confirm is a staff member reading their own statement or SMS and clicking Confirm. If you need machine-checked payments, use a gateway provider such as `payment-sslcommerz` or `payment-bkash`.

This section covers only what differs for `manual`.

#### Setup

1. Run `saasaloy add payment-manual`. It adds `packages/payment/src/providers/manual.ts`, appends `manual()` to the `providers` array in `packages/payment/src/index.ts`, and adds `@repo/validators` to `packages/payment/package.json`. It brings in `payment` and `validators` if they are missing.
2. Run `pnpm install`.
3. Put your accounts in the registration call (see the next section). `manual()` with no options offers no method, so every `create` answers `method_unavailable`.
4. Add `manual` to `PAYMENT_PROVIDER` in `packages/env/.env`, for example `PAYMENT_PROVIDER=manual` or `PAYMENT_PROVIDER=manual,sslcommerz`. Run `pnpm env:setup`.
5. Give at least one account the `admin` or `superadmin` role. Only those roles see the Payments page and call the review routes.

#### Registration options

The accounts are options in `packages/payment/src/index.ts`, not env values. A receiving account is printed to every shopper, so it is not a secret, and a checked-in value gets reviewed like code (ADR 0039).

```ts
import { manual } from "./providers/manual";

export const payment = definePayment({
  providers: [
    manual({
      methods: {
        bkash: { account: "01712345678", kind: "personal", name: "Rahim Traders" },
        nagad: { account: "01812345678", kind: "personal" },
        rocket: { account: "01912345678", kind: "merchant" },
        bank: {
          accountName: "Rahim Traders",
          accountNumber: "1501234567890",
          bankName: "City Bank",
          branch: "Gulshan",
          routingNumber: "225261725",
        },
      },
    }),
  ],
  listeners: [],
});
```

| Method | Option | Fields |
| --- | --- | --- |
| `bkash`, `nagad`, `rocket` | a wallet | `account` (any form `bangladeshMobile` accepts, shown to the shopper as `01712345678`), `kind` (`personal`, `merchant` or `agent`), optional `name` and `note` |
| `bank` | a bank account | `accountName`, `accountNumber`, `bankName`, `branch`, optional `routingNumber`, `currency` (default `BDT`) and `note` |

Rules:

- Only a configured method is available. `methods()` reports the others, and `card`, with `available: false`.
- A malformed wallet number or a missing bank field throws when `manual({...})` runs at module load. The Worker fails to start, and no shopper sees a wrong account.
- A wallet takes `BDT` only. A bank account takes its `currency`. A payment in another currency fails at `create` with `invalid_request` (`providerCode: "unsupported_currency"`), and the core moves the row to `failed`.
- The `kind` picks the default note: `personal` says "Use Send Money, not Cash Out", `merchant` says "Use Make Payment, not Send Money". Set `note` to replace it.

#### The shopper flow

The core ships no shopper routes. Write two routes in your app, and authorize the reference in each one, as the `saasaloy-payment` skill shows.

1. **Create.** Your route calls `createPayment(c.env).create({ method: "bkash", amount, currency: "BDT", referenceType, referenceId, userId })`. The answer is `{ payment, next }`, and `next.kind` is `"instructions"`.
2. **Show the instructions.** `next.instructions.account` holds `label` (`bKash personal`, or the bank name), `number`, `name` and `kind`. `next.instructions.note` starts with "Send exactly BDT 1,250.00." and holds the branch and routing number for a bank. `next.instructions.fields` lists the three inputs to show, in order, with a label and a placeholder each. Show `payment.amount` and `payment.currency` too.
3. **Submit.** The shopper pays in their app, then types what they see. Your second route calls `createPayment(c.env).submit(paymentId, { transactionId, senderAccount, amount })`. `amount` is in minor units: convert the shopper's "1250" taka to `125000` before you call.

What `submit` checks and stores:

| Input | Check | Stored as |
| --- | --- | --- |
| `transactionId` | bKash: exactly 10 letters and digits. Nagad, Rocket: 6 to 20 letters and digits. Bank: 4 to 40 letters, digits, `-`, `/` or `.`. | `transaction_id` as typed (trimmed). `transaction_id_normalized` trimmed and upper-cased. |
| `senderAccount` | Wallet: a Bangladeshi mobile number, through `bangladeshMobile`. Bank: 6 to 20 digits after spaces and hyphens go. | `sender_account` as `+8801XXXXXXXXX`, or the account digits |
| `amount` | a positive whole number of minor units | `claimed_amount` |

A bad input answers `invalid_request`, and `providerCode` names the field (`transactionId`, `senderAccount` or `amount`), so the form can show the message under that input. The payment stays `pending`, and the shopper can submit again.

A valid submit moves the payment from `pending` to `submitted`. A transaction ID that a live payment already claims answers `duplicate_transaction` (409). The check runs on the normalized value, so `8n7a5d2k1p` and `8N7A5D2K1P` are the same claim.

#### The staff flow: the admin Payments page

Open **Payments** in the admin app. The **Submitted** chip is the default, oldest first.

1. Open a payment. The banner names the receiving account the shopper paid. The detail shows the amount asked at checkout and the amount the shopper claims, with "Amount differs" when they differ, plus the transaction ID and the sender account.
2. Open your own statement for that account. Check four things: an incoming entry with that transaction ID exists, the amount matches, the sender matches, and the time is close to the submission.
3. Click **Confirm** when all four match. The payment moves to `successful`, `settled_amount` takes the claimed amount, and `settled_at` records the time.
4. Click **Reject** when they do not match. Pick a reason (`amount_mismatch`, `not_found`, `duplicate`, `other`) and add a note for the shopper. The payment moves to `failed`.

Two staff who click Confirm at once get one success and one 409. The page shows the loser a toast that someone else reviewed the payment first.

A rejected payment is final. Its transaction ID is free again, because the partial unique index skips `failed` rows. If staff rejected a real payment by mistake, the shopper starts a new payment for the same reference and submits the same transaction ID on it.

#### Refunds

A refund is money staff send back by hand from their own wallet or bank. Send it first, then click **Record refund** on the successful payment and enter the amount and a note. The core writes a `payment_refunds` row with no vendor refund ID. The provider sends nothing.

#### Callbacks

No gateway calls back. A request to `/payment/callback/manual/*` answers 204 and changes nothing.

#### The limits

- **Nothing is verified automatically.** The whole check is a person and a statement. Budget about a minute per payment.
- **Claim-jacking is open.** A shopper who sees another person's transaction ID can submit it first. The sender account is the only signal, and it is weak, because people pay from a relative's or an agent's wallet. This is a property of the method.
- **Send Money limits.** A personal wallet has daily and monthly limits set by the operator. A shop with many orders reaches them.
- **No partial review.** Staff confirm or reject the whole submission. A short payment is a reject with `amount_mismatch` and a refund sent by hand.

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
