# QA Plan: payment-sslcommerz provider

_Generated 2026-10-25 · against `b781e607` · covers the new `payment-sslcommerz` module (issue #214)_

## Summary

- `payment-sslcommerz` adds the SSLCOMMERZ hosted checkout as a `payment` provider. `create` opens a gateway session and answers a redirect. The IPN and the browser returns are checked against the gateway before a payment moves. Refunds go through the refund API.
- Working means: a real sandbox payment ends `successful` with `settled_amount` set, a replayed IPN changes nothing, a forged or mismatched IPN answers `callback_invalid`, and a refund lands in `payment_refunds`.

## Environment

- Branch `issue-214-add-the-sslcommerz-payment-provider`, commit `b781e607`.
- The agent checks ran as unit tests with a mocked gateway (`modules/payment-sslcommerz/files/sslcommerz.test.ts`) and as an install on `.dev/playground` (`database-d1`). This box has no SSLCOMMERZ sandbox store and no public origin for the IPN, so no check here called the real gateway.

## Agent results

| Check | Result | Evidence |
| --- | --- | --- |
| C2 · a validated IPN moves the payment to `successful` with `settled_amount` set | ✅ | test "a validated IPN moves the payment to successful with settled_amount set": status `successful`, `settledAmount` 125000, `bankTranId` kept |
| C3 · a replayed IPN is ignored | ✅ | test "ignores a replayed IPN": one `pending → successful` event after two IPNs (`VALID`, then `VALIDATED`) |
| C3 · a tampered IPN fails with `callback_invalid` | ✅ | four tests: forged `val_id`, short amount, wrong currency, foreign `tran_id`; each answers `callback_invalid` and leaves the row `pending`; an unknown `tran_id` also answers `callback_invalid` |
| C4 · a refund is recorded in `payment_refunds` | ✅ | test "records a refund through the refund API": refund API called with `bank_tran_id` BANK123 and `refund_amount` 500.00; refund row carries `providerRefundId` REF9; a refused refund answers `declined` and records nothing |
| C5 · `PAYMENT_PROVIDER=manual,sslcommerz`: card to SSLCOMMERZ, bKash to `payment-manual` | ✅ | test "with PAYMENT_PROVIDER=manual,sslcommerz…": card row `provider=sslcommerz` with a redirect; bkash row `provider=manual` with instructions |
| C6 · the module installs and typechecks on a `.dev` project | ✅ | `./saasaloy add payment-manual payment-sslcommerz --with database-d1 --yes` exit 0; `providers: [manual(), sslcommerz()]` and `extends: [sslcommerzEnv()]` patched in; `tsc --noEmit` exit 0 in `packages/payment` and `apps/api` |
| Repo gates | ✅ | `pnpm lint` exit 0; `pnpm test:modules` 1015 pass; `pnpm test:scripts` 467 pass (env preset matches `envVars`) |

Playground `pnpm lint` exits 1 on `packages/ui/src/blocks/shell/data-table.tsx:271` (`consistent-return`). That file comes from the shell module; this branch does not touch it.

## Manual cases

These need an SSLCOMMERZ sandbox store and an api origin the gateway can reach (a tunnel such as `cloudflared tunnel --url http://localhost:4000`).

### M1 · sandbox checkout end to end (C1, C2 live)

1. In `.dev/playground`, run `./saasaloy add payment-manual payment-sslcommerz --with database-d1 --yes`, then `pnpm install`.
2. Run `./saasaloy env`. Set `PAYMENT_PROVIDER=manual,sslcommerz`, the sandbox `SSLCOMMERZ_STORE_ID` and `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_RECEIPT_EMAIL`, and `BETTER_AUTH_URL` to the tunnel origin.
3. Run `pnpm env:setup`, apply the migrations, and start the api.
4. From a route or script, call `createPayment(env).create({ method: "card", amount: 10000, currency: "BDT", referenceType: "order", referenceId: "qa-1", returnUrl: "http://localhost:3000/done" })`.
5. Open the returned redirect URL. Pay with a sandbox test card.
6. Expect: the browser lands on `http://localhost:3000/done`. The `payments` row reads `successful`, `settled_amount` 10000, and `provider_data.bankTranId` set. `payment_events` holds one `pending → successful` row.

### M2 · replay and tamper against the sandbox (C3 live)

1. Copy the IPN body from the gateway's merchant panel or the api log for the M1 payment.
2. POST it again to `/payment/callback/sslcommerz/ipn`. Expect 204 and no new `payment_events` row.
3. POST it with `val_id=FORGED`. Expect 400 with `callback_invalid`.

### M3 · refund in the sandbox (C4 live)

1. Sign in to the admin app as an admin. Open the M1 payment on the Payments page.
2. Refund 50.00. Expect a `payment_refunds` row with a `provider_refund_id`, and `refunded_amount` 5000 on the payment.

### M4 · cancel at the gateway

1. Start a new card payment as in M1. On the gateway page, press Cancel.
2. Expect: the browser returns to the `returnUrl` and the row reads `cancelled`.
