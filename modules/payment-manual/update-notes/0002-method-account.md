---
title: The manual provider lists each configured account with its method
---

This note is one half of a pair. `payment/0003-method-account` adds the field it fills.

## What update does

`packages/payment/src/providers/manual.ts` sets `account` on the `bkash`, `nagad`, `rocket` and `bank` entries of `methods()` when that method is configured: the label ("bKash personal", the bank name), the number, the kind and the holder's name. It is the same value `create` puts in the instructions, built by the same helper. `cod` and `card` carry none.

## What update merges

`packages/payment/src/providers/manual.ts`, if you edited it. Keep your edits and take the `walletAccount`, `bankAccount` and `publicAccount` helpers and the `...publicAccount(...)` line on each method.

## What you do

Nothing. The accounts come from the `manual({ methods })` options you already set.

## Verify

```sh
pnpm typecheck
```

It passes. `createPayment(env).methods()` lists a configured `bkash` with `account.number` set to its wallet number.
