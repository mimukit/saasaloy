# Plan: the bKash personal billing provider

Grilled: 2026-09-21

Issue: [#158](https://github.com/mimukit/saasaloy/issues/158)

## Context

A large share of small Bangladeshi projects take payment on a **personal** bKash number. Not a merchant account, not a business account. The subject opens bKash, runs Send Money to the seller's personal number, and gets a transaction ID in an SMS. The subject then types that transaction ID and their own bKash number into a form on the project. The seller reads their own bKash statement and their own SMS, finds the transaction, checks the amount, and approves or rejects the submission from the admin app.

There is no API. bKash publishes no merchant API for a personal wallet, and a personal account has no IPN, no webhook and no query endpoint. Every fact in the approval decision comes from a human eye on a phone screen. The plan says that plainly rather than dressing a human queue as an integration.

The issue asks whether this is a `billing` provider at all. It is, but only after `billing` core grows a vendor-blind surface for manual settlement. The evidence is the file shape. A bKash-personal module that carried its own submissions table, its own submit route, its own admin approve route and its own admin page would be five files and a schema, which is the driver shape ADR 0037 reserves for `database`. Worse, the next Bangladeshi payment method — Nagad personal, Rocket personal, a bank transfer, cash on delivery — would copy all five. The differences between those methods are the instruction text, the fields collected, and the label. Everything else is one queue.

So the core owns the queue and the provider owns the words. `billing-bkash-personal` stays one runtime file plus its registration, ADR 0037 holds, and a later `billing-nagad-personal` is one file too.

Success means a project runs `saasaloy add billing-bkash-personal`, sets `BILLING_PROVIDER=bkash-personal` and one env var naming the receiving number, and the existing checkout route, entitlement reads, lockout job and admin billing page all work. A subject subscribes by sending money and submitting a transaction ID. An admin approves it from `apps/admin`. Nothing else in the repo learns the word "bKash".

### Prerequisites

- **Issue [#156](https://github.com/mimukit/saasaloy/issues/156) Phase 1 is a hard prerequisite.** It adds `BillingProvider.renewal: "manual"`, the `provider` column on `billing_subscriptions`, the daily renewal-due job, `PlanConfig.price`, the `renewal_due` notification and `POST /billing/renew`. This plan needs all six and re-specifies none of them. It does not need `handleCallback`: there is no callback.
- **Issue [#147](https://github.com/mimukit/saasaloy/issues/147) is a soft prerequisite.** `docs/plans/0059-plan-bangladesh-mobile-schema-2026-09-21.md` adds `bangladeshMobile` at `@repo/validators/phone`, normalizing to `+8801XXXXXXXXX`. The sender-number field uses it. If #147 has not landed, Phase 2 declares the same rule inline in the provider file and a follow-up swaps it, rather than blocking.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Provider or separate capability | A `billing` provider, behind a new manual-settlement surface in `billing` core. The provider file stays one file plus a `plugin-array` patch, so ADR 0037's third question still answers "adds one". Rejected: a fat provider module carrying a table and four files (breaks the one-file rule, and the next manual method copies it), and a `manual-payments` capability of its own (duplicates subject resolution, the entitlement read and the admin page). |
| Where the surface lives | `billing` core, unconditionally. A Stripe-only project carries an empty table and two admin routes that answer an empty list. Rejected: a `billing-manual` module between core and provider, which needs a feature-on-feature `dependsOn` edge the registry has never carried and puts a schema file in a module another module depends on. `billing_events` is already core-owned and provider-keyed, so the precedent points at core. |
| Who owns the submissions table | `billing` core. `billing_payment_submissions` is vendor-blind and carries a `provider` column, like `billing_events` already does. The word "bKash" appears in the provider file and in the module's skill, nowhere else. |
| What a provider contributes | Four things and no more: `settlement: "manual"`, a `manualInstructions(env, input)` returning the text and the destination the subject needs, a `submissionFields` spec naming what to collect, and `approveSubmission(env, input)` mapping an approved row onto a `BillingEvent`. |
| What checkout returns | `createCheckout` returns a URL to the project's own pay page rather than a vendor page, carrying the submission id. No event is minted, because nothing has been paid yet. |
| What the subject sees while waiting | A `pending` submission. The billing page shows the plan they asked for, the transaction ID they gave, the state, and the instruction text again. Entitlements grant nothing: there is no row in `billing_subscriptions` until an approval. |
| Who writes the projection | The event path only, as ADR 0034 requires. An admin approval enqueues a normal `payment.succeeded` event with the projected row; `applyEvent` stays the single writer. The admin route never touches `billing_subscriptions`. |
| How a duplicate is refused | A unique index on `(provider, transaction_ref_normalized)`, **partial on `status <> 'rejected'`**. The normalized form is the trimmed, upper-cased transaction ID, so `8n7a…` and `8N7A…` collide. A second live submission of the same reference is a 409 naming the conflict and nothing else. The partial predicate is what lets a wrongly rejected subject resubmit a real transaction without a manual `DELETE`; it costs one dialect difference between the SQLite and Postgres schema files, which the billing schema already carries by design. Rejected: a permanent index (a misclick burns a real transaction ID forever) and a global cross-provider index (guards a collision that has never happened). |
| How a fake is refused | By the admin's eye against their own bKash statement, and by nothing else. The plan promises no automated verification and the skill says so in its first paragraph. The form collects the sender's bKash number and the claimed amount so the admin has something to match, and the queue shows the expected price beside the claimed one. |
| Where the sender number comes from | Collected from the subject, validated and normalized by `bangladeshMobile`, and **pre-filled from that subject's most recent submission** when there is one. The first submission has a blank field. The pre-fill lives entirely inside `billing_payment_submissions`, so nothing here reshapes `users`. A number that differs from the subject's last one is flagged in the queue, which is exactly the signal the admin wants. Rejected: patching a `phone` column onto `users` from a payment module (backwards ownership), requiring the account mobile to equal the sender (breaks paying from a spouse's or an agent's wallet, which is common), and a project-issued code in the Send Money reference field (easy to forget mid-payment, and a forgotten code makes a real payment unapprovable). |
| Claim-jacking is not closed | A subject who sees someone else's TrxID can claim it first. The sender-number mismatch is the only signal, and it is advisory. The skill states this as a known limit of the method, not of the module. |
| What caps the queue | **One `pending` submission per subject**, enforced in the core. A second submit is a 409 until the first is reviewed or withdrawn. It mirrors the settled one-live-subscription-per-subject rule. Rejected: wiring `ratelimit` (adds a `billing` → `ratelimit` dependency for every project) and a withdraw cap (the withdraw-resubmit cycle churns one row and never grows the queue). |
| Which expected amount is the truth | The figure stored at checkout, shown in the queue labelled as quoted at submission time. The subject paid what they were told to pay, and recomputing from `plans.ts` at review time would tell a subject they underpaid for a price they never saw. Same reasoning the plan uses to refuse proration. |
| A pending submission whose plan was deleted | The review route refuses the approval and names the missing plan. The admin rejects with a note and refunds by hand. Rejected: approving anyway onto a plan entitlements silently resolve to the default, and snapshotting features and limits onto the submission, which creates a second source of entitlement truth beside `plans.ts`. |
| Two admins reviewing the same row | Both guards, named in the plan so a later reader removes neither. The review is a **conditional update on `status = 'pending'`** and the route enqueues only when a row changed; the loser gets a 409 naming who reviewed it. The `(provider, providerEventId)` primary key on `billing_events` is the backstop and already behaves this way. Rejected: a transaction spanning the review and the enqueue — a queue send is not a database write and cannot join one honestly. |
| What an approval grants | One period of the plan the submission names, `periodStart` now and `periodEnd` now plus the interval, status `active`. `providerSubscriptionId` and `providerCustomerId` derive from the subject, so a later approval converges on the same row. |
| What a rejection grants | Nothing. The submission moves to `rejected` with an admin-written reason, and the subject sees the reason on the billing page. No event is enqueued and no row changes. |
| Which reviews send an email | `payment_rejected` only. A rejection carries a reason the subject cannot otherwise learn. An approval lands on a page the subject is already watching, so `payment_approved` is not worth a template. |
| What renews | Nothing automatic. `renewal: "manual"` from #156 Phase 1, so the renewal job marks the row `past_due` at `periodEnd`, sends `renewal_due` once, and the lockout job locks it after `BILLING_LOCKOUT_DAYS`. The subject pays again and submits a second transaction ID through `POST /billing/renew`. |
| Where the receiving number comes from | `BKASH_PERSONAL_NUMBER`, an env var, not a plan field. One receiving number per deployment. |
| Currency | BDT only, like `billing-sslcommerz`. A plan whose `price` for the interval is not BDT throws `invalid_request` at checkout naming the plan and the currency. |
| Trials | A plan carrying `trialDays` mints a `trialing` event at checkout and collects no transaction ID, exactly as `billing-console` and `billing-sslcommerz` do. |
| Where the queue sits in the admin app | Its own nav item, **Payments**, beside Billing. The Billing page is a per-subject view; the queue is an operations inbox and the two do not belong on one screen. |
| Where it is documented | `modules/billing-bkash-personal/skills/saasaloy-billing-bkash-personal/SKILL.md`, plus one row in the billing skill's provider table. Same deliberate divergence from `create-provider`'s no-skill-folder rule that #156 takes. |

## Approach

### What it reuses

- `BillingProvider`, `BillingEvent`, `SubscriptionInput` and `BillingError` in `packages/billing/src/provider.ts`.
- `applyEvent` and the `(provider, providerEventId)` primary key on `billing_events`, so a double-clicked approval is a no-op on the second run. The submission id is the event id.
- Everything #156 Phase 1 adds: `renewal: "manual"`, the `provider` column, the renewal-due job, `PlanConfig.price`, the `renewal_due` template, `POST /billing/renew`.
- `pastDueLockoutJob` and the `account-locked` email, unchanged.
- `resolveSubject` and `authorizeSubject` in `@billing/subject.ts`, so `teams` still bills an organization.
- `bangladeshMobile` from `@repo/validators/phone` (#147) for the sender-number field.
- The admin gate pattern in `modules/admin/files/api/routes/admin-users.ts` — `auth.api` with the role check on the server, not only in the browser.
- `apps/admin`'s `data-table`, `status-pill`, `detail-panel`, `filter-chips` and `page-header` components for the queue.
- `billing-console` as the offline provider. No bKash stub is needed for `pnpm dev`.

### Phase 1: the manual-settlement surface in `billing` core

1. **Contract additions.** `BillingProvider.settlement?: "vendor" | "manual"`, default `"vendor"`. For a manual provider, three more members: `manualInstructions(env, input)` returning `{ heading, steps, destination, note? }`; `submissionFields` declaring the fields to collect, each with an id, a label, a type and a validation rule; `approveSubmission(env, input)` returning a `BillingEvent`. A vendor provider declares none of them, and `defineBilling` refuses a provider that sets `settlement: "manual"` without all three.
2. **The table.** `billing_payment_submissions` in both `billing.sqlite.ts` and `billing.pg.ts`. Columns: `id`, `provider`, `reference_id`, `customer_type`, `plan`, `billing_interval`, `expected_amount`, `currency`, `transaction_ref`, `transaction_ref_normalized`, `fields` (JSON, everything the provider asked for), `status` (`pending` | `approved` | `rejected` | `withdrawn`), `reviewed_by`, `reviewed_at`, `review_note`, `created_at`, `updated_at`. A partial unique index on `(provider, transaction_ref_normalized)` where `status <> 'rejected'`, an index on `(reference_id, customer_type)`, and an index on `(status, created_at)` for the queue read. Plural snake_case throughout per ADR 0038, Drizzle export key `billingPaymentSubmissions`.
3. **The store port.** `store.ts` grows the submission reads and writes, including the conditional review update, so no route touches Drizzle directly.
4. **`createCheckout` for a manual provider.** The core, not the provider, refuses a second `pending` submission, inserts the `pending` shell with the expected amount copied from the plan, and hands the provider the submission id. The provider returns the pay-page URL.
5. **Three subject routes**, inside `guard` on the existing `/billing` mount. `GET /billing/submission` returns the live submission with the instruction text, the field spec and the pre-fill values read off the subject's most recent submission. `POST /billing/submission` validates the field values against `submissionFields`, normalizes the transaction ref, inserts, and answers 409 on either the partial-unique conflict or an existing `pending` row, each with its own message. `DELETE /billing/submission/:id` withdraws a `pending` one.
6. **Two admin routes**, behind the server-side admin gate. `GET /admin/billing/submissions` lists the queue with a status filter, each row carrying the expected amount, the claimed amount, and a flag when the sender number differs from that subject's previous one. `POST /admin/billing/submissions/:id/review` takes `{ decision, note }`, runs the conditional update on `status = 'pending'`, answers 409 naming the reviewer when no row changed, refuses an approval whose plan no longer resolves through `findPlan`, and on a successful approve calls `approveSubmission` and enqueues the returned event. The route writes no subscription row.
7. **The admin page.** A **Payments** nav item and a queue page in `apps/admin`. Each row shows the subject, the plan, the expected price labelled as quoted at submission, the claimed amount, the transaction ref, every submitted field, the sender-number-changed flag, and the age. Approve and reject each take a note.
8. **One notification on review.** A `payment_rejected` `BillingNotificationKind` and its template, carrying the admin's note.
9. **One ADR** recording the decision: `billing` core owns a vendor-blind manual-settlement queue, and a payment method with no API is a provider rather than a capability. `domainkit` writes it, plus `CONTEXT.md` entries for **manual settlement** and **payment submission**.
10. **Tests.** The field validator against a spec. The partial-unique 409, and a rejected reference being resubmittable. The one-pending-per-subject 409. The withdraw path. The pre-fill read, including the first-submission empty case. The review route's admin gate. Its approve branch enqueueing exactly one event. Its reject branch enqueueing none. The conditional update losing the race and answering 409. The deleted-plan refusal. `defineBilling` refusing an incomplete manual provider.

### Phase 2: `modules/billing-bkash-personal`

1. **The descriptor.** `type: saasaloy:feature`, `dependsOn: ["billing"]`, `scaffolds: []`, one `plugin-array` patch onto `packages/billing/src/index.ts`. No npm dependency. `envVars` declares `BKASH_PERSONAL_NUMBER` and optionally `BKASH_PERSONAL_ACCOUNT_LABEL`. `agent.skills` names the module's skill folder.
2. **The one runtime file, `files/bkash-personal.ts`.** Exports `bkashPersonalBilling(): BillingProvider` with `name: "bkash-personal"`, `settlement: "manual"` and `renewal: "manual"`.
   - `manualInstructions` returns the Send Money steps, the receiving number from `BKASH_PERSONAL_NUMBER`, and the exact amount in BDT taken from the plan's `price`.
   - `submissionFields` declares `transactionId` (the bKash TrxID, 10 characters, alphanumeric, upper-cased) and `senderNumber` (a Bangladeshi mobile number, `bangladeshMobile`).
   - `createCheckout` refuses a non-BDT price, mints a `trialing` event for a trial plan, and otherwise returns the pay-page URL the core gave it.
   - `approveSubmission` maps the row onto a `payment.succeeded` event with the submission id as `providerEventId` and one interval of period.
   - `changePlan` opens a fresh submission at the new plan's price and extends `periodEnd` by the days left on the current period, matching #156's no-proration rule.
   - `cancel` and `restore` mint an event from `SubjectInput.current`, as `billing-console` does.
   - `createPortal` returns `input.returnUrl`. `listInvoices` returns `[]`. `setQuantity` validates and returns.
3. **Error mapping.** A missing `BKASH_PERSONAL_NUMBER` is `invalid_request` naming the key. A non-BDT plan price is `invalid_request` naming the plan. A malformed transaction ID or sender number is `invalid_request` naming the field. Nothing here is retryable, because nothing here calls a network.
4. **Tests.** The field validators against real and malformed bKash TrxIDs and mobile numbers, the non-BDT refusal, the missing-env refusal, the trial checkout, the approval event's period arithmetic, and the `changePlan` extension. Use the repo-only re-export shim `kv-memory` and `storage-memory` carry, and keep it out of `files[]`.
5. **The module skill.** What a personal bKash number is and is not, the manual workflow end to end, the one env var, how the seller verifies against their own statement and SMS, what the subject sees at each state, the renewal model, the no-proration rule, BDT-only, the claim-jacking limit, and a blunt statement in the first paragraph that nothing is verified automatically.
6. **Install proof.** `pnpm play:reset`, `saasaloy add billing-bkash-personal` in `.dev/playground`, the same command again with no change, then `saasaloy remove billing-bkash-personal` leaving every patched file byte-identical. Then `pnpm lint`.

## Open questions

None. Every branch raised in the grill is settled above.

## Non-goals

- Any bKash API. Merchant checkout, tokenized payment, the bKash PGW — none of it applies to a personal wallet, and a project that has a merchant account should install a merchant provider instead.
- Automated verification of a transaction ID. There is no endpoint to ask.
- SMS parsing of the seller's bKash notifications. A separate issue, and it needs device access this repo does not have.
- Closing the claim-jacking hole. The sender-number flag is advisory and the skill says so.
- A verified phone number on `users`. That belongs to `auth`, not to a payment provider.
- Multiple receiving numbers, or routing by amount or by tenant. One number per deployment.
- Refunds. `BillingProvider` exposes no refund method, and a bKash refund is a Send Money the seller does by hand.
- Proration in the credit sense. The period extension is the whole of it.
- Partial payments and a subject who sends the wrong amount. The admin rejects with a note, and the skill says to refund by hand.
- Rate limiting the submit route. One pending submission per subject is the whole cap.
- A `payment_approved` email.
- Seats. `setQuantity` validates and does nothing, as everywhere else.
- Currencies other than BDT.
- A second manual provider. `billing-nagad-personal` and `bank-transfer` become cheap after Phase 1, and neither is in this plan.
