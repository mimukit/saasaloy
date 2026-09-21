---
name: saasaloy-billing-bkash-personal
description: Runbook for the billing-bkash-personal provider — taking subscription payments on a personal bKash wallet through a human-reviewed queue, with no bKash API of any kind. Use when setting up the receiving number, pricing a plan in BDT, walking a subject through Send Money and a transaction ID, working the admin Payments queue, explaining manual renewal, or judging a payment that looks wrong.
---

# billing-bkash-personal — a payment method with no API

**Nothing here is verified automatically.** bKash publishes no merchant API for a personal wallet: there is no IPN, no webhook, no query endpoint, and no way for this project to ask whether a transaction ID is real. Every approval is a person reading their own bKash statement and their own SMS, and clicking Approve. If you want machine-checked payments, get a merchant account and install `billing-sslcommerz` or a bKash PGW provider instead.

`saasaloy add billing-bkash-personal` puts one file in `packages/billing/src/providers/bkash-personal.ts` and appends `bkashPersonalBilling()` to the `providers` array. Set `BILLING_PROVIDER=bkash-personal` and `BKASH_PERSONAL_NUMBER`, and the existing checkout route, entitlement reads, renewal job, lockout job and admin billing page all work with no change to any consumer.

Read `modules/billing/skills/saasaloy-billing/` first. This file covers only what differs.

## What the method is

A subject opens bKash, runs **Send Money** to a personal number the seller owns, and gets a transaction ID by SMS. They type that transaction ID and the number they sent from into a form on the project. The seller opens their own bKash app, finds the transaction, checks the amount, and approves or rejects it from the admin app's **Payments** page.

It is not a merchant account, not a business account, and not the bKash PGW. A personal wallet has a daily and a monthly Send Money limit set by bKash, and a high-volume project will hit them.

## Setting up

1. Set the env vars. In development they go in `apps/api/.dev.vars`; on a deployed Worker use `wrangler secret put`.

| Var | What it is |
|---|---|
| `BKASH_PERSONAL_NUMBER` | The personal bKash number subjects send money to, e.g. `+8801712345678`. Required. One per deployment. |
| `BKASH_PERSONAL_ACCOUNT_LABEL` | Whose wallet it is, e.g. `Rahim Traders`. Optional, shown beside the number so a subject can check the name bKash displays before they confirm. |

2. Set `BILLING_PROVIDER=bkash-personal`.

3. Price your plans in BDT, in `packages/billing/src/plans.ts`:

```ts
{
  id: "pro",
  name: "Pro",
  price: {
    monthly: { amount: 49_900, currency: "BDT" },  // 499.00 BDT
    yearly: { amount: 499_000, currency: "BDT" },
  },
}
```

`amount` is in **poisha**, the minor unit. Any currency but `BDT` is refused at checkout with `invalid_request` naming the plan: a personal bKash wallet holds taka and nothing else.

4. Make sure at least one account has the `admin` role. The Payments queue and the review route are both gated on it, on the server.

## The flow, end to end

1. **Checkout.** `POST /billing/checkout` opens a `pending` row in `billing_payment_submissions`, copies the plan's price onto it, and answers with the project's own billing page carrying `?billing=submit`. No money has moved and no event is minted.
2. **The subject pays.** `GET /billing/submission` returns the instruction text, the fields to collect, and the pre-fill. The subject runs Send Money on their phone.
3. **The subject submits.** `POST /billing/submission` takes the transaction ID, the sender number and the amount they claim to have sent. The transaction ID is validated as ten alphanumerics and upper-cased; the sender number is normalized to `+8801XXXXXXXXX`.
4. **The seller checks.** The admin app's **Payments** page lists pending submissions with the figure quoted at checkout beside the figure the subject claims, the transaction ID, and a flag when the sender's number differs from their last one. The seller opens bKash, finds the transaction, and decides.
5. **Approve.** The review route enqueues one `payment.succeeded` event and writes no subscription row itself. `applyEvent` grants one period of the plan.
6. **Reject.** Nothing is granted. The subject gets the `payment_rejected` email with the admin's note, and the transaction ID frees up so a correct resubmission is possible.

## What the seller actually checks

Four things, in the bKash app or on the statement:

1. A **Money Received** entry with that transaction ID exists.
2. The **amount** matches the figure the queue shows as quoted. A short payment is a rejection with a note; refund it by hand with Send Money.
3. The **sender number** matches what the subject typed, or is a number the change flag has already pointed at.
4. The **time** is recent and consistent with the submission.

There is nothing else to check, and no way to check it faster. Budget a minute per payment.

## Renewal

Nothing recurs. `renewal: "manual"`, so when a paid period ends the daily `billing.renewal-due` job marks the row `past_due` and sends the `renewal_due` email once. The subject sends money again and submits a second transaction ID through `POST /billing/renew`, which opens a fresh submission at the same plan. `billing.past-due-lockout` takes the plan away `BILLING_LOCKOUT_DAYS` later if nobody pays.

A plan change is the same gesture at the new plan's price, and the days left on the current period are added to the new one. That is the whole of proration; there is no credit concept and no gateway to ask for one.

## The limits, stated plainly

- **Claim-jacking is open.** A subject who sees somebody else's transaction ID — over a shoulder, in a screenshot, in a shared inbox — can submit it first and take the period it paid for. The sender-number flag is the only signal and it is advisory: paying from a spouse's or an agent's wallet is ordinary here, so a changed number is something to look at, not a refusal. Closing this properly needs a project-issued code in the Send Money reference field, and a forgotten code makes a real payment unapprovable. It is a property of the method, not a defect in the module.
- **Nothing is verified.** Said once more because it is the thing people forget.
- **One receiving number.** No routing by amount or by tenant.
- **BDT only.**
- **No refunds.** `BillingProvider` has no refund method, and a bKash refund is a Send Money the seller does by hand.
- **No partial payments.** A subject who sends the wrong amount is rejected with a note and refunded by hand.
- **No SMS parsing.** Reading the seller's bKash notifications is a separate problem and needs device access this project does not have.
- **One pending submission per subject.** A second checkout is refused with 409 until the first is reviewed or withdrawn.

## Failure modes and what they mean

| What you see | What it is |
|---|---|
| `invalid_request` naming `BKASH_PERSONAL_NUMBER` | The receiving number is unset. Nothing was opened and nobody was sent anywhere. |
| `invalid_request` naming the plan and a currency | The plan is priced in something other than BDT. |
| 409 on `POST /billing/submission` | Either this subject already has an open payment, or that transaction ID is already claimed by a submission that is not rejected. |
| 409 on the review route | Another admin decided this submission first. Reload the queue. |
| 404 on the review route naming a plan | The plan was dropped from `plans.ts` while the submission was pending. Reject it with a note and refund by hand, or put the plan back. |
| A `pending` row with no transaction reference | The subject started a checkout and never came back. It blocks their next checkout until they submit or withdraw it. |

## Going live

There is no sandbox and no test mode, because there is no API. To test, send yourself 1 taka from another bKash account and run the flow for real. Price a throwaway plan at `{ amount: 100, currency: "BDT" }` to keep the rehearsal cheap.
