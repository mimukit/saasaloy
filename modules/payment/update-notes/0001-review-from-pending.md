---
title: Staff confirm or reject a payment with no submit fields from pending
---

This note is one half of a pair. `payment-manual/0001-cod-method` adds the `cod` method that uses this change. ADR 0061 records the decision.

## What update does

`packages/payment/src/define.ts` lets `confirm` and `reject` take a `pending` payment whose kept instructions hold an empty `fields` list, and exports `takesNoSubmission(payment)`, which `packages/payment/src/index.ts` re-exports. Every other payment still needs `submitted`. `packages/payment/src/provider.ts` adds `delivery_refused` and `delivery_failed` to `RejectReason` and `REJECT_REASONS`, and makes `PaymentInstructions.account` optional. `apps/api/src/payment-store.ts` adds `takesNoSubmission` and `reviewable` to the payment view. `apps/api/src/routes/admin-payment.ts` takes its reasons from `REJECT_REASONS`. `apps/admin/src/routes/payments.tsx` offers Confirm and Reject on a reviewable `pending` payment and the delivery reasons for it.

No row changes. The two reasons are new values in the free-text `payment_events.reason` column.

## What the merge plan gets

`packages/payment/src/index.ts`, which every provider's registration patch changes, so it always reaches the merge plan. Add `takesNoSubmission` to the export list from `./define` and keep your providers. Also `packages/payment/src/define.ts`, `packages/payment/src/provider.ts`, `apps/api/src/payment-store.ts`, `apps/api/src/routes/admin-payment.ts` and `apps/admin/src/routes/payments.tsx`, if you edited them. Keep your edits and take the new `takesNoSubmission` check in `confirm` and `reject`, the two reasons, and the `reviewable` footer on the Payments page.

## What you do

1. If your own code reads `instructions.account` from a payment, handle it being absent.
2. If your own code switches over `RejectReason`, add a branch for `delivery_refused` and `delivery_failed`.

## Verify

```sh
pnpm typecheck
pnpm test
```

Both pass. On the admin Payments page, a submitted payment still offers the four submission reasons.
