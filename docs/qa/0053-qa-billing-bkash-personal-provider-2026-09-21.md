# QA Plan: the bKash personal billing provider

_Generated 2026-09-21 · against `655467d` plus the uncommitted working tree · covers the manual-settlement surface in `billing` core and the `billing-bkash-personal` module_

## Summary

- A subject pays on a personal bKash number, submits the transaction ID, and an admin approves or rejects it from the admin app's Payments page.
- Working means one approval grants exactly one period, a duplicate transaction ID is refused, and nothing writes `billing_subscriptions` except the event path.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-158-add-the-bkash-personal-billing-provider-module`, working tree uncommitted.
- The playground under `.dev/playground` already has `database-d1` and `billing-bkash-personal` installed.
- Base URL of the api: `http://localhost:8787`. Base URL of the admin app: `http://localhost:3001`.
- You need two accounts: one with the `admin` role, one ordinary user. Create them through the admin app's sign-up, then promote the first with `auth.api.setRole` or a direct row edit.

Rebuild the playground from this tree:

```sh
pnpm play:reset && cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add billing-bkash-personal --yes && pnpm install
```

Set the env vars the provider reads, in `apps/api/.dev.vars`:

```sh
printf 'BILLING_PROVIDER=bkash-personal\nBKASH_PERSONAL_NUMBER=+8801712345678\nBKASH_PERSONAL_ACCOUNT_LABEL=QA Wallet\nBILLING_APP_URL=http://localhost:3001/billing\nQUEUE_PROVIDER=memory\n' >> apps/api/.dev.vars
```

Price a plan in taka. Open `packages/billing/src/plans.ts` and give the paid plan a BDT price:

```sh
$EDITOR packages/billing/src/plans.ts
```

The paid plan needs `price: { monthly: { amount: 49_900, currency: "BDT" } }` and no `trialDays`.

Apply the schema:

```sh
pnpm -C packages/db db:generate && pnpm -C packages/db db:migrate:local
```

Set the database client. Every query below runs through it.

```sh
export DB_CMD='pnpm -C .dev/playground/apps/api exec wrangler d1 execute DB --local --command'
```

Launch with:

```sh
pnpm dev
```

Sign in to the admin app as the ordinary user and copy the session cookie. Every `curl` below sends it.

```sh
export COOKIE='better-auth.session_token=<paste the cookie value>'
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh subject, no submission | The subject reads the instructions and submits a payment | 🔴 Critical |
| TC-1.2 | 1: fresh subject, no submission | A second checkout is refused while one payment is open | 🔴 Critical |
| TC-1.3 | 1: fresh subject, no submission | A malformed transaction ID and a malformed number are refused | 🟡 Normal |
| TC-2.1 | 2: one submission waiting for review | The admin reads the queue and approves the payment | 🔴 Critical |
| TC-2.2 | 2: one submission waiting for review | A non-admin cannot reach the queue or the review route | 🔴 Critical |
| TC-2.3 | 2: one submission waiting for review | Two concurrent approvals grant one period | 🔴 Critical |
| TC-3.1 | 3: one payment already rejected | A rejection grants nothing and emails the reason | 🔴 Critical |
| TC-3.2 | 3: one payment already rejected | A rejected transaction ID can be submitted again | 🔴 Critical |
| TC-3.3 | 3: one payment already rejected | A duplicate live transaction ID is refused | 🔴 Critical |
| TC-4.1 | 4: approved subscription, plan dropped | An approval onto a deleted plan is refused by name | 🟡 Normal |
| TC-5.1 | 5: a vendor-settled provider selected | The submission routes disappear under `billing-console` | 🟡 Normal |
| TC-6.1 | 6: the Payments page, populated | The queue reads well and the flags are legible | 🟢 Low |

## Scenario 1: fresh subject, no submission

**Setup.** Run once, for every case in this scenario.

1. Sign in to the admin app as the ordinary user.
2. Confirm the subject has no rows.

```sh
$DB_CMD "select count(*) from billing_payment_submissions;"
```

- [ ] Setup complete

### TC-1.1: The subject reads the instructions and submits a payment · 🔴 Critical

**Goal.** A subject can open a payment, read what to send and where, and record the transaction ID.

**Steps**

1. Start a checkout for the paid plan.

   ```sh
   curl -i -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The answer is 200 and the `url` points at `http://localhost:3001/billing` with `billing=submit` and a `submission` id

2. Read what the subject is shown.

   ```sh
   curl -s http://localhost:8787/billing/submission -H "cookie: $COOKIE"
   ```

   - [ ] The instructions name the wallet number, the label and the exact figure
     - `destination` is `+8801712345678`
     - one step says to send exactly `499.00 BDT`
     - the note says there is no automatic confirmation
   - [ ] The field spec lists `transactionId`, `senderNumber` and `amount`, and marks `transactionId` as the reference
   - [ ] `prefill` is empty, because this is the subject's first submission

3. Confirm the shell carries the quoted figure and no reference yet.

   ```sh
   $DB_CMD "select plan, billing_interval, expected_amount, currency, status, transaction_ref from billing_payment_submissions;"
   ```

   - [ ] One row: plan `pro`, interval `monthly`, `expected_amount` 49900, currency `BDT`, status `pending`, `transaction_ref` null

4. Submit the transaction ID, in lower case, with the number written the local way.

   ```sh
   curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"8n7a5d2k1p","senderNumber":"01712345678","amount":"499"}'
   ```

   - [ ] The answer is 200 and the submission comes back with `transactionRef` `8N7A5D2K1P`

5. Confirm the stored values are normalized.

   ```sh
   $DB_CMD "select transaction_ref, transaction_ref_normalized, fields from billing_payment_submissions;"
   ```

   - [ ] The reference is upper-cased and the sender number reads `+8801712345678`

6. Confirm nothing was granted.

   ```sh
   $DB_CMD "select count(*) from billing_subscriptions;"
   ```

   - [ ] There is no subscription row: a submission grants nothing on its own

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A second checkout is refused while one payment is open · 🔴 Critical

**Goal.** One subject cannot leave two payments for an admin to reconcile against one wallet statement.

**Steps**

1. Start a second checkout for the same subject.

   ```sh
   curl -i -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The answer is 409 and the message names the open payment and the withdraw route

2. Submit a second reference against the same subject.

   ```sh
   curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"AAAAAAAAAA","senderNumber":"01712345678","amount":"499"}'
   ```

   - [ ] The answer is 409 and the message says a payment is already submitted

3. Confirm the table still holds one row.

   ```sh
   $DB_CMD "select count(*) from billing_payment_submissions;"
   ```

   - [ ] Exactly one row

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A malformed transaction ID and a malformed number are refused · 🟡 Normal

**Goal.** A refusal names the field it is about, so a form can put the message under the right input.

**Steps**

1. Withdraw the open payment, so a fresh one can be opened.

   ```sh
   curl -s http://localhost:8787/billing/submission -H "cookie: $COOKIE"
   ```

   Copy the `submission.id`, then:

   ```sh
   curl -i -X DELETE "http://localhost:8787/billing/submission/<paste the id>" -H "cookie: $COOKIE"
   ```

   - [ ] The answer is 200 and the status reads `withdrawn`

2. Open a fresh checkout.

   ```sh
   curl -s -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The answer carries a url

3. Submit a nine-character transaction ID.

   ```sh
   curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"8N7A5D2K1","senderNumber":"01712345678","amount":"499"}'
   ```

   - [ ] The answer is 400 and the message says the ID is ten letters and digits

4. Submit a number that is not a Bangladeshi mobile.

   ```sh
   curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"8N7A5D2K1P","senderNumber":"+15551234567","amount":"499"}'
   ```

   - [ ] The answer is 400 and the message names the number and shows the two accepted shapes

5. Submit with the amount missing.

   ```sh
   curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"8N7A5D2K1P","senderNumber":"01712345678"}'
   ```

   - [ ] The answer is 400 and the message names `amount`

6. Submit the correct values, to leave Scenario 2 a row to review.

   ```sh
   curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"8N7A5D2K1P","senderNumber":"01712345678","amount":"499"}'
   ```

   - [ ] The answer is 200

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Do not reset between Scenario 1 and Scenario 2. Scenario 2 starts from the row TC-1.3 left pending.

## Scenario 2: one submission waiting for review

**Setup.** Run once, for every case in this scenario.

1. Sign in to the admin app as the admin account, in a second browser profile.
2. Copy the admin session cookie.

```sh
export ADMIN_COOKIE='better-auth.session_token=<paste the admin cookie value>'
```

3. Confirm one pending row exists.

```sh
$DB_CMD "select id, status, transaction_ref from billing_payment_submissions where status = 'pending';"
```

- [ ] Setup complete

### TC-2.1: The admin reads the queue and approves the payment · 🔴 Critical

**Goal.** An approval grants exactly one period through the event path, and writes no subscription row directly.

**Steps**

1. Open `http://localhost:3001/payments` in the admin browser profile.

   - [ ] The queue shows one pending row
     - the subject's reference id
     - the plan `pro`
     - a Quoted column reading `৳499.00`
     - a Claimed column reading `499.00`
     - the transaction reference `8N7A5D2K1P`

2. Click the row.

   - [ ] The detail panel opens, with a Payment group and a Subject group
   - [ ] The Review tab warns that nothing has been verified

3. Type a note in the Review tab and click Approve.

   - [ ] The panel closes and the row leaves the pending list

4. Confirm exactly one event was recorded.

   ```sh
   $DB_CMD "select provider, provider_event_id, type, processed_at from billing_events;"
   ```

   - [ ] One row: provider `bkash-personal`, type `payment.succeeded`, `provider_event_id` equal to the submission id, `processed_at` set

5. Confirm the period the approval granted.

   ```sh
   $DB_CMD "select plan, status, provider, billing_interval, period_start, period_end from billing_subscriptions;"
   ```

   - [ ] One row: plan `pro`, status `active`, provider `bkash-personal`, interval `month`, `period_end` thirty days after `period_start`

6. Confirm the submission carries the decision.

   ```sh
   $DB_CMD "select status, reviewed_by, review_note from billing_payment_submissions where transaction_ref = '8N7A5D2K1P';"
   ```

   - [ ] Status `approved`, `reviewed_by` holds the admin's user id, and the note is the text you typed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A non-admin cannot reach the queue or the review route · 🔴 Critical

**Goal.** The gate is on the server, not only in the browser.

**Steps**

1. Read the queue with the ordinary user's cookie.

   ```sh
   curl -i "http://localhost:8787/admin/billing/submissions?status=pending" -H "cookie: $COOKIE"
   ```

   - [ ] The answer is 403

2. Read the queue with no cookie at all.

   ```sh
   curl -i "http://localhost:8787/admin/billing/submissions?status=pending"
   ```

   - [ ] The answer is 401

3. Try to review as the ordinary user.

   ```sh
   curl -i -X POST "http://localhost:8787/admin/billing/submissions/any-id/review" -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"decision":"approve","note":"nope"}'
   ```

   - [ ] The answer is 403 and nothing changed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Two concurrent approvals grant one period · 🔴 Critical

**Goal.** Two admins clicking Approve at the same moment produce one grant and one 409.

**Steps**

1. Open a fresh payment as the ordinary user and submit a reference.

   ```sh
   curl -s -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}' && curl -s -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"RACE000001","senderNumber":"01712345678","amount":"499"}'
   ```

   - [ ] Both answers are 200

   > A live subscription blocks `POST /billing/checkout`. If step 1 answers 409, cancel the subscription first through `POST /billing/cancel`, then repeat step 1.

2. Read the new submission id.

   ```sh
   $DB_CMD "select id from billing_payment_submissions where transaction_ref = 'RACE000001';"
   ```

   - [ ] One id comes back

3. Fire two approvals at once.

   ```sh
   ID=<paste the id>; curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:8787/admin/billing/submissions/$ID/review" -H "cookie: $ADMIN_COOKIE" -H 'content-type: application/json' -d '{"decision":"approve","note":"first"}' & curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:8787/admin/billing/submissions/$ID/review" -H "cookie: $ADMIN_COOKIE" -H 'content-type: application/json' -d '{"decision":"approve","note":"second"}' & wait
   ```

   - [ ] One call answers 200 and the other answers 409

4. Confirm one event and one grant.

   ```sh
   $DB_CMD "select count(*) from billing_events where provider_event_id = '$ID';"
   ```

   - [ ] Exactly one event row

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
$DB_CMD "delete from billing_payment_submissions; delete from billing_events; delete from billing_subscriptions;"
```

## Scenario 3: one payment already rejected

**Setup.** Run once, for every case in this scenario.

1. Open a payment as the ordinary user and submit a reference.

```sh
curl -s -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}' && curl -s -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"REJECT0001","senderNumber":"01712345678","amount":"250"}'
```

2. Watch the api's terminal. The console email provider prints every message it sends.

- [ ] Setup complete

### TC-3.1: A rejection grants nothing and emails the reason · 🔴 Critical

**Goal.** A refused payment leaves the subject unsubscribed and tells them why.

**Steps**

1. Open `http://localhost:3001/payments`, click the row, and note the mismatch.

   - [ ] Quoted reads `৳499.00` and Claimed reads `250.00`

2. Type "Only 250 taka arrived. Send the remaining 249 and submit the new transaction ID." and click Reject.

   - [ ] The row leaves the pending list

3. Read the api terminal.

   - [ ] The console email provider printed a message to the subject
     - the subject line says the payment was not accepted
     - the body quotes the note you typed
     - the body names the transaction reference `REJECT0001`

4. Confirm nothing was granted.

   ```sh
   $DB_CMD "select count(*) as subs from billing_subscriptions; select count(*) as events from billing_events;"
   ```

   - [ ] No subscription row and no event row

5. Read what the subject now sees.

   ```sh
   curl -s http://localhost:8787/billing/submission -H "cookie: $COOKIE"
   ```

   - [ ] `submission` is null, and `last` carries status `rejected` with the admin's note
   - [ ] `prefill.senderNumber` is `+8801712345678`, so the next form starts filled in

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: A rejected transaction ID can be submitted again · 🔴 Critical

**Goal.** An admin who rejects a real payment by mistake does not burn that transaction ID forever.

**Steps**

1. Open a fresh payment and submit the **same** reference the rejection refused.

   ```sh
   curl -s -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}' && curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"REJECT0001","senderNumber":"01712345678","amount":"499"}'
   ```

   - [ ] The second answer is 200: the partial index lets a rejected reference through

2. Confirm both rows exist under one reference.

   ```sh
   $DB_CMD "select status, transaction_ref_normalized from billing_payment_submissions order by created_at;"
   ```

   - [ ] Two rows, one `rejected` and one `pending`, both on `REJECT0001`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.3: A duplicate live transaction ID is refused · 🔴 Critical

**Goal.** Two subjects cannot claim one transaction.

**Steps**

1. Sign in as a **second** ordinary user in a third browser profile and copy the cookie.

   ```sh
   export COOKIE2='better-auth.session_token=<paste the second user cookie>'
   ```

2. Open a payment for that second subject.

   ```sh
   curl -s -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE2" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The answer is 200

3. Claim the reference the first subject already has pending, in lower case.

   ```sh
   curl -i -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE2" -H 'content-type: application/json' -d '{"transactionId":"reject0001","senderNumber":"01812345678","amount":"499"}'
   ```

   - [ ] The answer is 409 and the message names the reference
     - the lower-case spelling still collides, because the index sits on the normalized value

4. Confirm the second subject's shell is still empty.

   ```sh
   $DB_CMD "select status, transaction_ref from billing_payment_submissions where transaction_ref is null;"
   ```

   - [ ] The second subject's row is still pending with no reference

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 4.

```sh
$DB_CMD "delete from billing_payment_submissions; delete from billing_events; delete from billing_subscriptions;"
```

## Scenario 4: approved subscription, plan dropped

**Setup.** Run once, for every case in this scenario.

1. Open a payment as the ordinary user and submit a reference.

```sh
curl -s -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}' && curl -s -X POST http://localhost:8787/billing/submission -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"transactionId":"GONE000001","senderNumber":"01712345678","amount":"499"}'
```

2. Delete the `pro` plan from `packages/billing/src/plans.ts` and let the dev server reload.

```sh
$EDITOR .dev/playground/packages/billing/src/plans.ts
```

- [ ] Setup complete

### TC-4.1: An approval onto a deleted plan is refused by name · 🟡 Normal

**Goal.** A pending payment for a plan that no longer exists is refused rather than granted onto the default tier.

**Steps**

1. Approve the payment from `http://localhost:3001/payments`.

   - [ ] The Review tab shows an error naming the missing plan `pro`
   - [ ] The row is still pending, so the admin can reject it with a note instead

2. Reject it with a note.

   - [ ] The rejection goes through

3. Confirm nothing was granted.

   ```sh
   $DB_CMD "select count(*) from billing_subscriptions;"
   ```

   - [ ] No subscription row

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before moving to Scenario 5.

```sh
$DB_CMD "delete from billing_payment_submissions; delete from billing_events; delete from billing_subscriptions;"
```

Put the `pro` plan back in `packages/billing/src/plans.ts`.

## Scenario 5: a vendor-settled provider selected

**Setup.** Run once, for the case in this scenario.

1. Install the console provider and select it.

```sh
cd .dev/playground && ./saasaloy add billing-console --yes && sed -i 's/^BILLING_PROVIDER=.*/BILLING_PROVIDER=console/' apps/api/.dev.vars
```

2. Restart `pnpm dev`.

- [ ] Setup complete

### TC-5.1: The submission routes disappear under `billing-console` · 🟡 Normal

**Goal.** The manual-settlement surface refuses a provider that settles at the vendor, rather than half-working.

**Steps**

1. Read the submission route.

   ```sh
   curl -i http://localhost:8787/billing/submission -H "cookie: $COOKIE"
   ```

   - [ ] The answer is 404 and the message says `console` settles at the vendor

2. Start a checkout under the console provider.

   ```sh
   curl -i -X POST http://localhost:8787/billing/checkout -H "cookie: $COOKIE" -H 'content-type: application/json' -d '{"planId":"pro","interval":"monthly","successUrl":"http://localhost:3001/billing","cancelUrl":"http://localhost:3001/billing"}'
   ```

   - [ ] The answer is 200 and the console provider's own flow still works
   - [ ] No submission row was opened

   ```sh
   $DB_CMD "select count(*) from billing_payment_submissions;"
   ```

3. Open `http://localhost:3001/payments` as the admin.

   - [ ] The page loads and shows an empty queue rather than an error

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Put the bKash provider back.

```sh
cd .dev/playground && sed -i 's/^BILLING_PROVIDER=.*/BILLING_PROVIDER=bkash-personal/' apps/api/.dev.vars
```

## Scenario 6: the Payments page, populated

**Setup.** Run once, for the case in this scenario.

1. Create four submissions for two different subjects, one of them with a changed sender number, and review two of them. Use the `curl` sequences from Scenario 1 and Scenario 3.
2. Restart `pnpm dev` and sign in as the admin.

- [ ] Setup complete

### TC-6.1: The queue reads well and the flags are legible · 🟢 Low

**Goal.** An operator can work the queue quickly and spot the one signal the method offers.

**Steps**

1. Open `http://localhost:3001/payments` at 1280px or wider.

   - [ ] The page reads as one screen and nothing overflows
     - the header counts the rows and describes the queue
     - the status chips read Pending, Approved, Rejected, Withdrawn
     - the table columns line up, with Quoted and Claimed right-aligned
   - [ ] The Sender column shows a "changed" pill on the submission whose number differs, and a dash on the rest

2. Click each status chip in turn.

   - [ ] Each filter shows only its own rows, and the empty state explains itself

3. Open a row, then press Tab from the top of the panel.

   - [ ] The focus order runs through the tabs, the note field and the two buttons, and the focus ring is visible on each

4. Switch the admin app to dark mode.

   - [ ] The same sweep is clean in dark
   - [ ] The "changed" pill and the status pills are still legible

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above.

```sh
$DB_CMD "delete from billing_payment_submissions; delete from billing_events; delete from billing_subscriptions;"
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm test:modules
```

```sh
pnpm play:reset
```

```sh
cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add billing-bkash-personal --yes && pnpm install
```

```sh
cd .dev/playground && pnpm typecheck
```

```sh
cd .dev/playground && pnpm -C packages/db db:generate
```

```sh
cd .dev/playground && grep -n "billing_payment_submissions" packages/db/migrations/0000_*.sql
```

```sh
cd .dev/playground && ./saasaloy add billing-bkash-personal --yes && ./saasaloy remove billing-bkash-personal --yes
```

- ✅ `pnpm lint` → all four passes green: oxlint type-aware, oxlint plain over the whole repo including the new module files, Stylelint, and `prettier --check`.
- ✅ `pnpm test:modules` → 636 pass, 0 fail. That covers 20 new tests for the bKash provider (the two field validators, the non-BDT refusal, the missing-env refusal, the trial checkout, the approval period arithmetic and the carried days) and 20 for the core's manual-settlement helpers (`referenceField`, `normalizeReference`, `normalizeFields`, `prefillFrom`, `rememberedChanged`, and `defineBilling` refusing an incomplete manual provider).
- ✅ `saasaloy add billing-bkash-personal` → applies one file and one `plugin-array` patch. A second `add` leaves `packages/billing/src/index.ts` byte-identical.
- ✅ `saasaloy remove billing-bkash-personal` → reverts the import and the array entry, deletes `packages/billing/src/providers/bkash-personal.ts`, and prunes the skill. `packages/billing/src/index.ts` returns to its console-only shape.
- ✅ `pnpm typecheck` in the playground → 10 tasks, all successful, including `@repo/admin`. The Payments page typechecks against the real `hc<AppType>` client, so the two new admin routes are wired into `AppType`.
- ✅ `db:generate` → drizzle reads 7 tables, `billing_payment_submissions` among them, with 17 columns and 3 indexes.
- ✅ The generated SQL carries the partial unique index verbatim: `CREATE UNIQUE INDEX billing_payment_submissions_transaction_ref_uidx ON billing_payment_submissions (provider, transaction_ref_normalized) WHERE status <> 'rejected'`.
- ❌ The `const-array` nav patch for the Payments entry is skipped at install, with `could not find a module-scope const array named NAV_ITEMS`. **This is a pre-existing break, not new**: `modules/billing`'s own Billing nav patch is skipped by the same message. The admin shell moved its navigation into `NAV_AREAS` in `apps/admin/src/components/nav.ts`, which is a nested `as const` structure the `const-array` patch kind cannot write into. Both pages are still reachable by URL, because the router plugin wires a route from its file path. Fixing it needs a new patch kind and belongs in its own issue.

## Not covered / needs human judgment

- **Any real bKash payment.** There is no API, no sandbox and no test mode. Every transaction ID in this plan is invented, and the approval step is the operator's own word. That is the method, not a gap in the module.
- **The email's rendering.** The console email provider prints the message; nobody looked at it in a real client.
- **Claim-jacking.** The plan does not test that a subject cannot steal another subject's transaction ID, because the module does not claim to stop it. The sender-number flag is advisory and TC-6.1 checks only that it is legible.
- **Postgres.** Every query in this plan runs against D1. The Postgres schema file is the twin and generates the same partial index, but nobody ran it. Repeat Scenario 3 under `database-postgres` before a project ships on Postgres.
- **Performance.** The queue is capped at 200 rows and does one extra read per row. Nobody measured it, and nobody built a queue large enough to matter.
- **Concurrency beyond TC-2.3.** Two subjects submitting the same reference at exactly the same instant is left to the partial unique index and was not raced by hand.
- **`teams`.** Every case bills a user. Nobody installed `teams` to bill an organization.
- **Compatibility.** One browser at one width, plus dark mode. No mobile layout and no second browser.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
