---
autonomy: afk
---

# Product brief

Last updated: 2026-11-17 (draft fixture for `scripts/agent-bench.ts`)

- **Name**: Receiptbox
- **Language**: English (`en`)

## Audience

Freelance designers and writers who file their own tax return once a year and keep their own books.

## Problem

Receipts for business costs pile up in email, in a wallet and in a phone's photo roll. At tax time they spend a weekend finding them and adding them up.

## Current alternative

An email folder, and a spreadsheet filled in at the end of the year.

## Differentiator

Each receipt goes in on the day it is paid: an amount, a date, a vendor and a category. The year's total for each category is always one screen away.

## Proof

weak-accepted: The owner has used the same spreadsheet layout for three tax years. There is no customer yet.

## Tone

Calm and exact, like a good accountant's letter. The owner named no reference site.

## Pricing

Fixture values, confirmed 2026-11-17: Free for up to 30 receipts a year. Tax year pass, a one-off payment of $12, for unlimited receipts in one tax year. No subscription.

## Where "sign up" goes

The product's own sign-up screen, in the signed-in app.

## Core feature

One person, one account. The user pays once for a tax year pass, through the payment module's local provider in development. Two entities belong to the user who made them:

- A **category** (table `categories`): a name, such as "software" or "travel".
- A **receipt** (table `receipts`): an amount in cents, the day it was paid, a vendor, a category and an optional note. The user can delete a receipt.

An admin sees a list of every category and every receipt.

## Known gaps

- None the owner knows of.
