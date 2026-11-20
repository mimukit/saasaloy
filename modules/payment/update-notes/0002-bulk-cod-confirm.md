---
title: Confirm several cash on delivery payments at once on the Payments page
---

The `ecommerce` module's Phase 5 asked for a bulk COD confirm on the payments list (plan 0106). The api is unchanged: the page calls the existing review route once per payment.

## What update does

`apps/admin/src/routes/payments.tsx` gains a checkbox column on the Pending chip for every payment that is `reviewable` and `takesNoSubmission`, a bar under the list that shows the count and the sum of the selected payments with "Confirm cash received" and "Clear", and a Method select beside the status chips when the list holds more than one method. A submitted claim never gets a checkbox, because staff check each one against a statement.

No row changes, no api change.

## What update merges

`apps/admin/src/routes/payments.tsx`, if you edited it. Keep your edits and take the `selectColumn` and `bulkConfirmable` helpers, the `bulk` mutation, the Method select and the selection bar.

## What you do

Nothing.

## Verify

```sh
pnpm typecheck
```

It passes. On the admin Payments page, the Pending chip shows a checkbox on each cash on delivery payment, and "Confirm cash received" confirms the ticked ones.
