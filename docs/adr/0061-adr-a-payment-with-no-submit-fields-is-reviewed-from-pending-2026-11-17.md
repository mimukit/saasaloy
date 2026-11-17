# 0061: A payment with no submit fields is reviewed from pending

`payment` had one road to a staff decision: the payer submits a transaction ID, the payment moves to `submitted`, and staff confirm or reject it there. Cash on delivery has no submission. The buyer pays the courier, and the shop learns about the money when the courier remits it, days later. The `ecommerce` plan (0106) takes COD through `payment-manual` as a `cod` method, so the core needed a way to confirm a payment that never leaves `pending`, and a way to say why a parcel came back.

`confirm` and `reject` now also take a `pending` payment whose method declared no submit fields. The test is the instructions the core keeps on the row at `create`: when `providerData.instructions.fields` is an empty list, `takesNoSubmission(payment)` is true, and the conditional update runs on `status = 'pending'` in place of `status = 'submitted'`. Every other path is unchanged. A `pending` payment of a method with fields still answers `conflict`, a gateway payment keeps no instructions and so never qualifies, and `submit`, the callbacks and refunds are untouched. `RejectReason` gains `delivery_refused` (the buyer would not take the parcel) and `delivery_failed` (the courier could not deliver it), which a listener reads to move the order that owns the payment.

## Status
accepted

## Considered Options
- A `cod` provider module of its own: it would copy `payment-manual` for a flow that differs only in who confirms, and the plan rejected it for that reason.
- A synthetic submission by staff, so COD goes `pending` to `submitted` to `successful`: two writes and two history rows for one decision, a fake transaction ID to satisfy the duplicate index, and a `submitted` count on the sidebar that would fill with parcels still on the road.
- A flag on `PaymentMethod` read from `methods(env)` at review time: the answer would change if the registration options changed after the payment was created. The kept instructions describe the payment as the payer saw it, and they are already on the row.
- Reject only from `submitted`, and let `ecommerce` mark a refused parcel without touching the payment: the payment would stay `pending` forever, and the Payments page would show money that is not coming.

## Consequences
- `PaymentInstructions.account` becomes optional, because a cash payment has no receiving account. A screen that reads it must handle its absence; `payment-store.ts` already did.
- Reject is widened together with confirm. The plan names only confirm, but a COD payment never reaches `submitted`, so `delivery_refused` would have no payment to land on otherwise.
- The admin detail shape gains `takesNoSubmission` and `reviewable`. The Payments page offers Confirm and Reject on a reviewable `pending` payment, and shows the delivery reasons for it and the submission reasons for a submitted one. The sidebar review count still counts `submitted` only.
- The two reasons add values to a free-text `reason` column. No existing row holds them, so no data moves and no migration runs.
- A provider that answers instructions with an empty `fields` list for any other reason now gets payments staff can confirm from `pending`. That is the contract this ADR writes down: empty `fields` means nobody submits.
