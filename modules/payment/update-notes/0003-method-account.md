---
title: A listed payment method can carry the account its payer sends money to
---

This note is one half of a pair. `payment-manual/0002-method-account` fills the new field. The `ecommerce` checkout reads it to show "Send ৳3,610 to the bKash personal number …" before the order exists (plan 0106, approved mockup `0106-r1-shop-checkout-payment-bkash`).

## What update does

`packages/payment/src/provider.ts` adds an optional `account` to `PaymentMethod`, the same shape `PaymentInstructions.account` has. `createPayment(env).methods()` passes it through, because it spreads each method. A provider that sets nothing behaves as before.

The account is public by nature: every payer of the method is shown it in the instructions. A gateway and cash on delivery leave it unset.

## What the merge plan gets

`packages/payment/src/provider.ts`, if you edited it. Keep your edits and take the `account` field on `PaymentMethod`.

## What you do

Nothing. A page that lists methods may read `method.account` now.

## Verify

```sh
pnpm typecheck
```

It passes.
