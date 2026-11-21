---
title: The e2e suite knows the ecommerce and payment-manual tags
---

`ecommerce` ships a browser journey, `packages/e2e/specs/ecommerce-journey.spec.ts`, tagged `@ecommerce`, `@admin`, `@payment-manual` and `@sms-console` (plan 0106).

## What update does

`packages/e2e/lib/project.ts` adds `ecommerce` and `payment-manual` to `SPEC_TAGS`. `playwright.config.ts` turns every tag whose module is absent into `grepInvert`, so the shop journey is collected only in a project that has both modules. A spec that carries neither tag runs as before.

## What update merges

`packages/e2e/lib/project.ts`, if you edited it. Keep your edits and take the two new names in `SPEC_TAGS`.

## What you do

Nothing, unless you add `ecommerce`. Then add `payment-manual` too and turn `cod` on in `packages/payment/src/index.ts`, or the journey refuses to run and names that line.

## Verify

```sh
pnpm e2e
```

In a project without `ecommerce`, the list of tests holds no "shop journey".
