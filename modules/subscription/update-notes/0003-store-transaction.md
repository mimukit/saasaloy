---
title: SubscriptionStore gains a required transaction method
---

The `SubscriptionStore` port in `@repo/subscription` has a new required method, `transaction(body)`. `applyEvent` uses it to write the `subscription_events` row and the projection in one transaction. Before, the event row committed first, so a failed `upsertSubscription` made the vendor's redelivery read as a duplicate, and the subscription row never got the event.

## What update does

- `packages/subscription/src/subscription.ts` declares `transaction<T>(body: (store: SubscriptionStore) => Promise<T>): Promise<T>` on `SubscriptionStore`. `applyEvent` runs the event insert, the row write, the lock clear and the `processedAt` stamp in one transaction. The emails go after the commit, and the `reminderSentAt` stamp after the trial email.
- `apps/api/src/subscription-store.ts` implements the method with `transaction(db, …)` from `@repo/db/client` and hands `body` a store over the transaction.
- With `testing` on, update adds `apps/api/src/subscription-store.test.ts`, a real-Postgres test that fails the row write and finds no `subscription_events` row.

## What update merges

`packages/subscription/src/subscription.ts` and `apps/api/src/subscription-store.ts`, if you edited them. Keep your edits and take the `transaction` method and the new body of `applyEvent`.

## What you do

Find every object of your own that implements the port:

```sh
git grep -n "SubscriptionStore" -- apps packages
```

- A test fake: add `transaction(body) { return body(store) }`, where `store` is the fake itself. Build the fake in a `const` first if it is an object literal you return.
- A real store of your own: open a real database transaction and pass `body` a store whose every method writes inside it, the way `createSubscriptionStore` in `apps/api/src/subscription-store.ts` does.

## Verify

```sh
pnpm typecheck
```

`pnpm typecheck` passes. A port object with no `transaction` method fails it with `Property 'transaction' is missing`.
