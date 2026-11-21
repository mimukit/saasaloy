---
read-back: a
follow-up: Take your first sample answer as written, and go on to the next question.
---

# Owner answers: Receiptbox

Draft, awaiting the owner's approval in #350. The scripted owner for `node scripts/agent-bench.ts --interview --brief receiptbox`, a paid product that exercises `payment` with its local provider. The harness sends the answer under `## <n>.` when the agent asks question `<n>` of `saasaloy-setup`, and `read-back` when the agent asks "Build it?". The price in answer 9 is a fixture value. Answer 7 is thin on purpose, so the read-back must settle a weak answer.

## 1. Name

Receiptbox

## 2. Language

English (`en`)

## 3. Audience

Freelance designers and writers who file their own tax return once a year and keep their own books.

## 4. Problem

Receipts for business costs pile up in email, in a wallet and in a phone's photo roll. At tax time they spend a weekend finding them and adding them up.

## 5. Current alternative

An email folder, and a spreadsheet filled in at the end of the year.

## 6. Differentiator

Each receipt goes in on the day it is paid: an amount, a date, a vendor and a category. The year's total for each category is always one screen away.

## 7. Proof

I have used the same spreadsheet layout for three tax years. I have no customer yet.

## 8. Tone

Calm and exact, like a good accountant's letter. I have no reference site.

## 9. Pricing

Free for up to 30 receipts a year. Tax year pass: a one-off payment of $12 for unlimited receipts in one tax year. No subscription. Confirmed today.

## 10. Where "sign up" goes

The product's own sign-up screen, in the signed-in app.

## 11. Entities

Two entities. Each belongs to the user who made it, and staff read every row in admin.

- Categories. Table `categories`. Fields: `name` text, required. Actions: `list`, `create`, `update`. Screens: as you proposed.
- Receipts. Table `receipts`. Fields: `amount` money, required; `paid_on` date, required; `vendor` text, required; `category` link to `categories`, required; `note` long text. Actions: `list`, `create`, `update`, `delete`. Screens: as you proposed.

## 12. Order

Categories first, then receipts.

## 13. Capabilities

`payment`, for the one-off tax year pass, with its local provider. No subscription.

## 14. Preview deploy

a. No, keep it on my machine (`deploy: none`).
