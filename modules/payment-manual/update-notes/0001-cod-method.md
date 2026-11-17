---
title: The manual provider takes cash on delivery as a cod method
---

This note is one half of a pair. `payment/0001-review-from-pending` makes the core change it depends on.

## What update does

`packages/payment/src/providers/manual.ts` adds a `cod` method. It is off until you configure it. Its instructions carry no account and an empty `fields` list, its `submit` answers `invalid_request` with `providerCode: "no_submission"`, and staff confirm or reject it from `pending` on the Payments page.

## What the merge plan gets

`packages/payment/src/providers/manual.ts`, if you edited it. Keep your edits and take the `cod` branch in `create`, `submit` and the option check.

## What you do

1. To take cash on delivery, add `cod: {}` to `manual({ methods })` in `packages/payment/src/index.ts`. Add `note` to replace the default line, for example `cod: { note: "Keep the exact amount ready for the rider." }`.
2. Leave it out to keep the provider as it was.

## Verify

```sh
pnpm typecheck
```

It passes. With `cod` configured, `createPayment(env).methods()` lists `cod` with the label "Cash on delivery".
