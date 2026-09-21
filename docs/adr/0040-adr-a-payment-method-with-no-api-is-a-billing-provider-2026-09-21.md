# 0040 — A payment method with no API is a billing provider behind a core-owned manual-settlement queue

`packages/billing` owns a vendor-blind queue of payment submissions that a human reviews, and a payment method with no API of any kind is a `billing` provider on top of it rather than a capability or a driver. Settled while planning `docs/plans/0062-plan-billing-bkash-personal-provider-2026-09-21.md` for issue #158.

## Status

accepted.

## Context

A large share of small Bangladeshi projects take payment on a **personal** bKash number. The subject runs Send Money to the seller's own wallet, reads a transaction ID out of an SMS, and types it into a form. The seller opens their own bKash app, finds the transaction, checks the amount and approves or rejects it.

bKash publishes no merchant API for a personal wallet. There is no IPN, no webhook, no query endpoint and no signature to verify. Every fact in an approval comes from a human eye on a phone screen. Nagad personal, Rocket personal, a bank transfer and cash on delivery are all the same shape, and each of them is a real request a Bangladeshi project makes.

ADR 0039 had just settled the two things such a method needs from the core — manual renewal, and a provider minting events for an operation the vendor has no counterpart for. Neither covers the part that is actually new: the payment itself is a claim, and something has to hold the claim while a person decides on it.

Three arrangements were on the table.

**A fat provider module.** `billing-bkash-personal` would carry its own submissions table, its own submit route, its own admin route and its own admin page. That is five files and a schema, which is the driver shape ADR 0037 reserves for `database`, and it fails ADR 0037's third question outright. Worse, the next manual method copies all five, and the only things that actually differ between them are the instruction text, the fields collected and the label.

**A `manual-payments` capability of its own.** It would duplicate subject resolution, the entitlement read, the plan table and the admin billing page, and it would need a feature-on-feature `dependsOn` edge the registry has never carried.

**A `billing-manual` module between core and provider.** Same `dependsOn` problem, plus it would put a schema file inside a module that another module depends on.

## Decision

**The core owns the queue; the provider owns the words.**

`packages/billing` gains, unconditionally:

- `BillingProvider.settlement?: "vendor" | "manual"`, default `"vendor"`, plus three members a manual provider owes and a vendor provider must not declare: `manualInstructions`, `submissionFields` and `approveSubmission`. `defineBilling` refuses a manual provider missing any of them, at module load.
- `billing_payment_submissions`, in both schema dialects. Vendor-blind, with a `provider` column, exactly as `billing_events` already is. A partial unique index on `(provider, transaction_ref_normalized)` **where `status <> 'rejected'`** is the duplicate check.
- Three subject routes under `/billing/submission`, two admin routes under `/admin/billing/submissions`, and a **Payments** page in `apps/admin` beside Billing.
- A `payment.rejected` notification carrying the reviewing admin's note.

A provider contributes four things and no more: `settlement: "manual"`, the instruction text and the destination, the field spec, and the mapping from an approved row onto a `BillingEvent`. `billing-bkash-personal` is one runtime file plus a `plugin-array` patch, so ADR 0037's third question still answers "adds one file", and a later `billing-nagad-personal` is one file too.

Five rules travel with the decision.

**The projection keeps one writer.** An approval enqueues a normal `payment.succeeded` event and the admin route touches no subscription row. `applyEvent` stays the single writer (ADR 0034). The submission id is the event id, so a double-clicked approval conflicts on the `billing_events` primary key.

**Two admins racing is settled by a conditional update.** The review is an `UPDATE … WHERE status = 'pending'`, and the route enqueues only when a row came back. The loser reads nothing and gets a 409 naming who reviewed it. A transaction spanning the review and the enqueue was rejected: a queue send is not a database write and cannot join one honestly.

**The expected amount is the figure quoted at checkout**, stored on the submission and never recomputed from `plans.ts` at review time. Recomputing would tell a subject they underpaid for a price they never saw.

**A rejected reference frees up again.** The unique index is partial for exactly that reason: an admin who rejects a real payment by mistake must not burn that transaction ID forever.

**Nothing is verified.** The core promises a queue, not an integration. The module's skill says so in its first paragraph, and the claim-jacking hole — a subject submitting a transaction ID they saw somewhere else — stays open and documented. The sender-number flag is advisory, because paying from a spouse's or an agent's wallet is ordinary.

## Consequences

A project on Stripe alone carries one empty table and two admin routes that answer an empty list. That is the price of the queue living in the core rather than in a module, and it is the same price `billing_events` already charges a project that never sees a webhook.

The next manual method is cheap: one file, one descriptor, one patch, one skill. `billing-nagad-personal` and a bank-transfer provider become additive work rather than a second queue.

`BillingNotification.subscription` becomes optional, because `payment.rejected` has no subscription row behind it. Every other kind still carries one, and the notifier throws when it does not.

A new `BillingErrorCode`, `conflict`, renders as 409. It is distinct from `invalid_request` because the request was well-formed and would have worked a moment earlier.

The queue read is capped at 200 rows and does one extra read per row to compute the change flag. A window function would be faster and would put dialect-specific SQL in the one place that has stayed dialect-neutral; a queue a person works is not a place that needs it.
