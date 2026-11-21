---
title: PaymentStore gains a required transaction method
---

The `PaymentStore` port in `@repo/payment` has a new required method, `transaction(body)`. The core uses it to write a status change and its `payment_events` row in one transaction. Before, the two writes committed one at a time, so outside `staffWrite` a failed event insert left a status change with no history row.

## What update does

- `packages/payment/src/store.ts` declares `transaction<T>(body: (store: PaymentStore) => Promise<T>): Promise<T>` on `PaymentStore`.
- `packages/payment/src/define.ts` runs the status update and its `payment_events` insert inside `store.transaction(...)`. The listeners run after the commit. No provider call runs inside the transaction.
- `apps/api/src/payment-store.ts` implements the method with `transaction(db, …)` from `@repo/db/client` and hands `body` a store over the transaction. Inside `staffWrite` it opens a savepoint in the `adminWrite` transaction.
- With `testing` on, update adds `apps/api/src/payment-store.test.ts`, a real-Postgres test that fails the event insert and finds the old status.

## What update merges

`packages/payment/src/store.ts`, `packages/payment/src/define.ts` and `apps/api/src/payment-store.ts`, if you edited them. Keep your edits and take the `transaction` method and the new body of `move` in `define.ts`.

## What you do

Find every object of your own that implements the port:

```sh
git grep -n "PaymentStore" -- apps packages
```

- A test fake: add `transaction(body) { return body(store) }`, where `store` is the fake itself. Build the fake in a `const` first if it is an object literal you return.
- A real store of your own: open a real database transaction and pass `body` a store whose every method writes inside it, the way `createPaymentStore` in `apps/api/src/payment-store.ts` does.

## Verify

```sh
pnpm typecheck
```

`pnpm typecheck` passes. A port object with no `transaction` method fails it with `Property 'transaction' is missing`.
