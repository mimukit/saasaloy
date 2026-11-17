# QA Plan: ecommerce module (issue #328)

_Generated 2026-11-17 · against `55604089` (clean), refreshed 2026-11-17 against `9058afb0` (clean) · covers plan 0106 Phases 2 to 7: code sign-in and COD in `auth-phone` and `payment`, the `ecommerce` core, api, admin screens, storefront, journey and gates_

## Summary
- The `ecommerce` module adds a catalog, a cart, a COD and bKash checkout, an order machine and the shop admin screens to a Postgres project.
- Working means that a guest buys with COD after an SMS code, and staff take the order to delivered and paid, with correct stock.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-328-ecommerce-module` at `9058afb0`. The fix commit `9058afb0` changes one file, `modules/ecommerce/files/admin/routes/shop/orders/new.tsx`. The two projects are `.dev/playground` and `.dev/p7-pg`.
- Admin: `http://localhost:3001`. Shop: `http://localhost:3000/shop`. Api: `http://localhost:4000`.
- Admin sign-in: `admin@example.test` / `saasaloy-dev-password`. Use `superadmin@example.test` with the same password for a superadmin.
- The SMS code for a phone shows in the dev server output (`console` SMS provider). Search the output for `is your Saasaloy verification code`.
- The playground keeps the data the agent made: product "QA Polo shirt", buyer `+8801712000556`, orders ORD-1005 (delivered), ORD-1006 and ORD-1004 (returned), ORD-1007, ORD-1008 and ORD-1009 (placed). ORD-1008 made the user "QA Walkin" `+8801712000123`.
- Approved mockups are in the secret gist `mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a`, prefixes `0106-r1-` and `0106-r2-`. A mockup link below is a raw URL.
- Screenshots: local to this run and not committed. The New order captures (`admin-order-new-*`) are at `9058afb0`. All other captures are at `55604089`; the fix commit cannot change them. The names under each case match the labels in the gallery.
- The box has no font with the taka sign (U+09F3). The screenshots show a box in place of `৳`. The page text is correct (`৳1,660`).
- The Astro dev toolbar shows at the foot of each shop screenshot. It is a dev server part, not part of the shop.

Start Postgres with:

```sh
cd .dev/playground && docker compose up -d --wait
```

Start the dev servers with:

```sh
cd .dev/playground && pnpm dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Playground with the QA orders, signed in as admin | Order list and order page match the mockup (C14) | 🔴 Critical |
| TC-1.2 | 1: Playground with the QA orders, signed in as admin | New order page opens and matches the mockup (C14) | 🔴 Critical |
| TC-1.3 | 1: Playground with the QA orders, signed in as admin | Catalog, payments and report screens match the mockup (C14) | 🟡 Normal |
| TC-2.1 | 2: Playground shop, buyer `+8801712000556` signed in | Catalog, product and cart match the mockup (C17) | 🔴 Critical |
| TC-2.2 | 2: Playground shop, buyer `+8801712000556` signed in | Checkout steps match the mockup (C17) | 🔴 Critical |
| TC-2.3 | 2: Playground shop, buyer `+8801712000556` signed in | Orders list and order page match the mockup (C17) | 🟡 Normal |

## Scenario 1: Playground with the QA orders, signed in as admin

**Setup.** Run once, for every case in this scenario.

1. Start the environment as above.
2. Open `http://localhost:3001/login` and sign in as `admin@example.test`.

- [ ] Setup complete

### TC-1.1: Order list and order page match the mockup  ·  🔴 Critical

**Goal.** The order screens show the approved layout, with readable dates and addresses.

**Steps**

1. Open Shop, then Orders.
   - [ ] The list matches the mockup in light and dark
     - status chips with counts, the COD tag, the payment pill and the status pill in each row
     - the "Bkash" method label: decide if it must read "bKash"
     - screenshots: `admin-orders-list-light-1440` · `admin-orders-list-dark-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-orders-list-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-orders-list-dark-1440.png
2. Look at a placed COD order page (ORD-1005 before the staff actions).
   - [ ] The header row carries the order number, the pills and the status buttons, as in the mockup
     - "Confirm order" filled, the overflow menu beside it
     - the "Call the buyer" line under the header is not in the mockup: decide if it stays
     - the date reads "Nov 17, 2026, 2:51 AM" and the address lines do not run words together
     - screenshots: `admin-order-detail-cod-light-1440` · `admin-order-detail-cod-dark-1440` · `admin-order-detail-delivered-light-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-order-detail-cod-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-order-detail-cod-dark-1440.png
3. Look at a returned order page (ORD-1006) and its dialogs.
   - [ ] The returned page, the reject dialog and the Mark returned dialog match the round 2 mockup
     - "Restock items" in the header while the stock is not back
     - the reject reasons read "Delivery refused by the buyer", "Delivery failed", "Other"
     - screenshots: `admin-order-detail-return-light-1440` · `admin-order-detail-return-dark-1440` · `admin-order-reject-dialog-light-1440` · `admin-order-reject-reasons-light-1440` · `admin-order-mark-returned-dialog-light-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r2-admin-order-detail-return-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r2-admin-order-detail-return-dark-1440.png

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _The admin shows times in the browser time zone (UTC on the box: 2:51 AM). The shop shows the store time zone, Asia/Dhaka (8:51 AM). Decide if the admin must use the store time zone._

### TC-1.2: New order page opens and matches the mockup  ·  🔴 Critical

**Goal.** Staff can open the New order page and see one customer line for each phone lookup.

**Steps**

1. Open Shop, then Orders, then click "New order".
   - [ ] The empty page matches the round 2 mockup at 1440 in light and dark
     - Customer, Items, Delivery and Payment sections; the Summary card; "Create order ৳0" disabled
     - screenshots: `admin-order-new-open-light-1440` · `admin-order-new-open-dark-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r2-admin-order-new-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r2-admin-order-new-dark-1440.png
2. Type `01712000556` in Phone, then type `01712000123`.
   - [ ] The customer line under Phone reads well for each number
     - known number: "QA Guest, 3 orders, customer since Nov 17, 2026" with the "Existing customer" badge
     - new number: "A new number creates a customer account. …"
     - screenshots: `admin-order-new-known-phone-light-1440` · `admin-order-new-known-phone-dark-1440` · `admin-order-new-new-phone-light-1440` · `admin-order-new-new-phone-dark-1440`
3. Type `polo` in Product, pick "QA Polo shirt", then pick "M / Blue".
   - [ ] The picker, the variant list and the added line match the mockup
     - screenshots: `admin-order-new-picker-light-1440` · `admin-order-new-picker-dark-1440` · `admin-order-new-line-light-1440` · `admin-order-new-line-dark-1440` · `admin-order-new-created-light-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _At `55604089` the page crashed on open. At `9058afb0` it opens; see Automated verification._

### TC-1.3: Catalog, payments and report screens match the mockup  ·  🟡 Normal

**Goal.** The other shop admin screens show the approved layout.

**Steps**

1. Open Products, then "QA Polo shirt".
   - [ ] The list and the editor match the mockup
     - the two options, the four-row variant grid with SKU, price, stock and the Sell switch
     - screenshots: `admin-products-list-light-1440` · `admin-product-editor-light-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-products-list-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-product-editor-light-1440.png
2. Open Payments, click the Pending chip, and select one COD row.
   - [ ] The bulk COD bar and the reject reasons match the mockup
     - the payments screen keeps "BDT 710.00" while the shop screens show "৳710": decide if this stays
     - the returned order ORD-1004 keeps a pending COD payment that staff can still select and confirm
     - screenshots: `admin-payments-bulk-cod-light-1440` · `admin-payments-reject-reasons-light-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-payments-bulk-cod-light-1440.png
3. Open Customers, Shipping zones and Reports.
   - [ ] Each screen matches its mockup
     - the customer phone shows as `+8801712000556`, not in the shop's grouped form
     - screenshots: `admin-customers-light-1440` · `admin-shipping-zones-light-1440` · `admin-reports-light-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-customers-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-shipping-zones-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-admin-reports-light-1440.png

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. The cases above only look at screens.

## Scenario 2: Playground shop, buyer `+8801712000556` signed in

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3000/shop/checkout` with one item in the cart.
2. Enter `+8801712000556`, click "Send code", and enter the code from the dev server output.

- [ ] Setup complete

### TC-2.1: Catalog, product and cart match the mockup  ·  🔴 Critical

**Goal.** The first three shop pages show the approved layout in both themes and at phone width.

**Steps**

1. Open `/shop`, then "QA Polo shirt", then "Cotton tee" with size L, then the cart.
   - [ ] Each page matches its mockup in light and dark at 1440 and 360
     - catalog grid, option pickers, the struck-out sold-out size with "Out of stock", cart lines and summary
     - screenshots: `shop-catalog-light-1440` · `shop-catalog-dark-1440` · `shop-catalog-light-360` · `shop-catalog-dark-360` · `shop-product-light-1440` · `shop-product-dark-1440` · `shop-product-light-360` · `shop-product-dark-360` · `shop-product-sold-out-light-1440` · `shop-product-sold-out-light-360` · `shop-cart-light-1440` · `shop-cart-dark-1440` · `shop-cart-light-360` · `shop-cart-dark-360`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-catalog-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-product-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-cart-light-360.png

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: Checkout steps match the mockup  ·  🔴 Critical

**Goal.** Each checkout step shows the approved layout for a new number, a known number and each payment method.

**Steps**

1. Look at the Contact step for a new number and for a known number.
   - [ ] The Contact step matches the mockup
     - screenshots: `shop-checkout-new-number-light-1440` · `shop-checkout-new-number-dark-1440` · `shop-checkout-new-number-light-360` · `shop-checkout-new-number-dark-360` · `shop-checkout-known-number-light-1440`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-checkout-new-number-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-checkout-known-number-light-1440.png
2. Look at the Delivery step and the Payment step, COD and bKash.
   - [ ] The folded rows, the saved address, the zones and the bKash line match the mockup
     - the bKash line reads "Send ৳860 to the bKash personal number 01712345678 with Send Money, then enter the transaction ID on the next page."
     - screenshots: `shop-checkout-delivery-light-1440` · `shop-checkout-delivery-dark-1440` · `shop-checkout-delivery-light-360` · `shop-checkout-delivery-dark-360` · `shop-checkout-payment-light-1440` · `shop-checkout-payment-dark-1440` · `shop-checkout-payment-light-360` · `shop-checkout-payment-dark-360` · `shop-checkout-payment-bkash-light-1440` · `shop-checkout-payment-bkash-dark-1440` · `shop-checkout-payment-bkash-light-360` · `shop-checkout-payment-bkash-dark-360`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-checkout-delivery-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-checkout-payment-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-checkout-payment-bkash-light-1440.png

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: Orders list and order page match the mockup  ·  🟡 Normal

**Goal.** The buyer's order pages show the approved layout.

**Steps**

1. Open `/shop/orders`, then ORD-1007.
   - [ ] Both pages match the mockup in light and dark at 1440 and 360
     - the table at 1440 and the cards at 360; the track, items, address and payments on the order page
     - screenshots: `shop-orders-light-1440` · `shop-orders-dark-1440` · `shop-orders-light-360` · `shop-orders-dark-360` · `shop-order-status-light-1440` · `shop-order-status-dark-1440` · `shop-order-status-light-360` · `shop-order-status-dark-360`
     - mockup: https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r2-shop-orders-light-1440.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r2-shop-orders-light-360.png · https://gist.githubusercontent.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a/raw/0106-r1-shop-order-status-light-1440.png

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the dev servers and Postgres.

```sh
cd .dev/playground && pnpm dev:stop && docker compose stop
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. The first run was at `55604089`; no earlier phase result named that revision, so every gate ran again. The refresh at `9058afb0` re-ran what the fix can change: `pnpm lint`, `pnpm test`, C11 on the New order screen, TC-1.2 captures and the New order picker. Every other result keeps `55604089`, because `9058afb0` changes only `modules/ecommerce/files/admin/routes/shop/orders/new.tsx`. Logs are in `.afkkit/logs/qa-*.log` and `.afkkit/logs/qa2-*.log`._

### Failures first

- ✅ (was ❌ at `55604089`) Browser · `/shop/orders/new` (admin) → at `55604089` the page showed "This screen stopped working" with "Base UI: FieldRootContext is missing". At `9058afb0` it opens in light and dark with no page error.
- ❌ C21 · `pnpm deps:check` (at `55604089`; the fix cannot change it) → exit 1, 148 outdated. The merge base `5e99590a` gives exit 1 with 146. The branch adds `lucide-react 1.49.0 → 1.73.0` (ecommerce descriptor) and `rimraf 6.1.3 → 6.1.4` (`modules/ecommerce/files/package.json`), both at the repo-wide pins.

### Commands run

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm deps:check
```

```sh
cd .dev/playground && npx vitest run --no-file-parallelism apps/api/src/routes/ecommerce.test.ts apps/api/src/routes/ecommerce-payments.test.ts apps/api/src/routes/ecommerce-storefront.test.ts apps/api/src/routes/admin-ecommerce.test.ts apps/api/src/routes/auth-phone.test.ts apps/api/src/routes/auth-phone-guards.test.ts apps/api/src/routes/admin-login-codes.test.ts apps/api/src/lib/ecommerce
```

```sh
cd .dev/playground/apps/web && pnpm build && npx wrangler deploy --dry-run
```

```sh
cd .dev/p7-pg && pnpm e2e
```

```sh
cd .dev && SAASALOY_REGISTRY_DIR="$PWD/../modules" node ../packages/cli/dist/index.js init qa-pg --no-install --no-git --testing=off
```

```sh
cd .dev/qa-pg && SAASALOY_REGISTRY_DIR="$PWD/../../modules" node ../../packages/cli/dist/index.js add database-postgres --yes && SAASALOY_REGISTRY_DIR="$PWD/../../modules" node ../../packages/cli/dist/index.js add ecommerce --yes
```

```sh
cd .dev/p7-d1 && SAASALOY_REGISTRY_DIR="$PWD/../../modules" node ../../packages/cli/dist/index.js add ecommerce --yes
```

```sh
curl -s http://localhost:4000/shop/payment-methods
```

### Acceptance checks (`.afkkit/checks.md`)

- ✅ C1 → playground vitest exit 0, 12 files, 137 tests (`qa-play-vitest.log`). `auth-phone.test.ts` "sign-in by code" covers the known number with `codeSignIn: true`, the 409 with `codeSignIn: false`, and `BANNED_USER`. The browser run also signed `+8801712000556` in by code at checkout ("Welcome back. This number has an account.").
- ✅ C2 → `pnpm test` exit 0 (1505 + 147 + 670 pass). "confirms a pending cod payment as successful, with one event" and "still refuses to confirm a pending bkash payment" pass.
- ✅ C3 → "rejects a pending cod payment with delivery_refused as failed" and "... delivery_failed as failed" pass. Browser: the Payments screen reject list reads "Buyer refused delivery", "Delivery failed", "Other". The order page reject list reads "Delivery refused by the buyer", "Delivery failed", "Other".
- ✅ C4 → `docs/adr/0061-adr-a-payment-with-no-submit-fields-is-reviewed-from-pending-2026-11-17.md`, the `saasaloy-payment` skill paragraph on ADR 0061 and `cod`, and `modules/payment/update-notes/0001-review-from-pending.md` exist.
- ✅ C5 → `pnpm test` runs the money, formatPrice, totals and status tests; "refuses every transition outside the table, self moves included" and "throws invalid_transition for every refused one" pass.
- ✅ C6 → schema, repositories, validators, 17 seed slices and `files/config/ecommerce.ts` exist; `scripts/table-names.test.ts` passes inside `pnpm test` ("names orders as a plural snake_case table").
- ✅ C7 → `stock.test.ts` ("lets exactly one of two racing checkouts win", "ignores an expired hold", "changes only when the order ships") and `catalog.test.ts` ("refuses a variant with no store-currency price") pass in the playground run.
- ✅ C8 → `ecommerce.test.ts` (401, 403, 409 with no order, browser prices ignored) and `admin-ecommerce.test.ts` (401 and 403 on the staff gate) pass.
- ✅ C9 → `ecommerce-payments.test.ts` (successful → confirmed; failed → placed with a timed hold, Pay again makes a second payment; `delivery_refused` → returned) pass.
- ✅ C10 → "returns an unpaid order past its hold as cancelled, with a system event" passes.
- ✅ C11 → api at `55604089`: `admin-ecommerce.test.ts` "creates a client user with an unverified phone for a new number, at catalog prices" and "links the order to the user who owns a known phone" pass. Screen at `9058afb0`: New order for `01712000123` named "QA Walkin" with M / Blue × 1, COD, made ORD-1008 Placed, "Placed by Alan Admin", and a user with `phone_number_verified` false. New order for `01712000556` linked ORD-1009 to the existing QA Guest (still one user with that phone). Both totals are 86000 (catalog ৳800 + ৳60 zone).
- ✅ C12 → browser, playground. "QA Polo shirt" made with Size (S, M) and Colour (Red, Blue); the grid shows `S / Red`, `S / Blue`, `M / Red`, `M / Blue`; price 800 for all, stock 5 to 8, all four active; Publish sets the status Active. ORD-1005: Confirm order → Confirmed, Mark shipped → Shipped, Mark delivered → Delivered, Confirm cash received → payment Successful, "Complete. Delivered and paid." Reports: COD collected went from "No COD outcome" to "100% of orders, ৳1,660"; Delivered 0 → 1. Customers: QA Guest shows 2 orders, ৳3,020. That figure appears at order time and does not change at delivery.
- ✅ C13 → browser. ORD-1006 shipped, then the COD payment rejected with "Delivery refused by the buyer" → order Returned, payment Failed, history "Returned automatically. The buyer refused the parcel." TEE-S on hand 12 → 10 at ship; "Restock items" → 12. ORD-1004: Mark returned with the "Restock items" box ticked → on hand back to 12. Movements: `-2 shipped`, `+2 restock`, `-1 shipped`, `+1 restock`.
- ✅ C15 → browser. A guest bought "QA Polo shirt" M / Blue × 2 with COD after the SMS code to `+8801712000556`; `/shop/orders/1005` shows Placed, ৳1,660. A new browser with the same number got "Welcome back", signed in by code, used the saved address and placed ORD-1006 (Placed).
- ✅ C16 → `apps/web` build exit 0; `dist/client` holds `index.html`, `privacy/index.html`, `terms/index.html` and no shop page; `wrangler deploy --dry-run` exit 0; `run_worker_first` is `["/blog","/blog/*","/shop","/shop/*"]`.
- ✅ C18 → `pnpm e2e` in `.dev/p7-pg` exit 0, 5 passed: "a guest buys with cash on delivery and staff deliver it" and "the second buyer of the last unit gets a clean refusal". The database then holds ORD-1009 delivered with cod successful.
- ✅ C19 → `modules/ecommerce/skills/saasaloy-ecommerce/SKILL.md` (216 lines) exists; `removeWarnings` has 3 entries that name all 17 tables and `order_numbers`.
- ✅ C20 → issue #343 "feat(ecommerce): take the delivery charge in advance by bkash" is open with `needs-planning`.
- ❌ C21 → `pnpm lint` exit 0 ✅ and `pnpm test` exit 0 ✅ (1505 + 147 + 670 pass) at `9058afb0` (`qa2-lint.log`, `qa2-test.log`); `add ecommerce` on a fresh Postgres project exit 0, "Applied validators, auth, sms, kv, ratelimit, auth-phone, shell, admin, storage, file-uploads, payment, cms, ecommerce (394 files)" ✅, and `add ecommerce` on `.dev/p7-d1` exit 2, "Run `saasaloy remove database-d1` first.", nothing written ✅, both at `55604089`; `pnpm deps:check` exit 1 ❌ at `55604089` (see Failures first).

### Carry-forward checks (`.afkkit/orientation.md`)

- ✅ Stock edits write `stock_movements` → each of the four QA Polo variants got one `adjustment` row (+5, +6, +7, +8, note "Counted in the product editor."); ship wrote `-2 shipped` with the order id.
- ✅ Admin order header row at 1440 → ORD-1005 shows the number, Placed and COD pills, "Confirm order" and the overflow menu in one row (`admin-order-detail-cod-light-1440`).
- ✅ New order picker at 1440 (at `9058afb0`) → `polo` lists "QA Polo shirt 23 in stock"; the SKU part `TEE-` lists "Cotton tee 12 in stock"; picking QA Polo shirt lists its variants ("S / Red 4 in stock, ৳800", "M / Blue 6 in stock, ৳800", …); picking M / Blue sets Subtotal ৳800. The known phone shows the "Existing customer" badge and no new-number line; the new phone shows the new-number line and no badge, in light and dark.
- ✅ Delete of a buyer with orders → no admin screen or http route deletes a user: `/admin/auth/admin/*` answers 404, and Members "remove" is a ban. In Postgres, a delete of the buyer in a rolled-back transaction fails with `violates RESTRICT setting of foreign key constraint "orders_user_id_users_id_fk"`. The ecommerce skill does not mention this rule.

```sh
curl -s -i -X POST http://localhost:4000/admin/auth/admin/remove-user -H "Origin: http://localhost:3001" -H "Content-Type: application/json" -H "Cookie: admin.session_token=$SUPERADMIN_TOKEN" -d '{"userId":"fZ7vfjqOEhYOw5vUbwXTlTwPS3BYSFJ0"}'
```

`SUPERADMIN_TOKEN` is the `admin.session_token` cookie of a browser signed in as `superadmin@example.test`. The call answers `404 {"error":{"code":"not_found","message":"not found"}}`.

```sh
docker exec playground-postgres-1 psql -U postgres -d playground_dev -c "begin" -c "delete from users where email='8801712000556@phone.invalid'" -c "rollback"
```

### Browser checks
_Driven with Playwright (playwright-core 1.66, headless Chromium) against `http://localhost:3000` and `http://localhost:3001` at `55604089`, and the New order screen again at `9058afb0`. 67 screenshots, local to this run and not committed._

- ✅ every shop page (catalog, product, sold-out product, cart, checkout steps, orders, order page) · horizontal overflow at 360 → `scrollWidth - innerWidth` is 0 on all 36 measured captures (9 pages, 4 variants each)
- ✅ dark theme · `html` carries the dark class on every dark capture
- ✅ `/shop/cotton-tee` with L chosen · button "Out of stock" disabled, text "L is out of stock. Pick another choice."
- ✅ `/shop/checkout` bKash · "Send ৳860 to the bKash personal number 01712345678 with Send Money, then enter the transaction ID on the next page."
- ✅ `/shop/checkout` District select · 64 districts, "Bagerhat" to "Thakurgaon"
- ✅ guest cart merge · a cart line added before the code sign-in joined the buyer's cart (Cotton tee S × 2 on ORD-1006)
- ✅ admin screens Products, Orders, Customers, Shipping zones, Reports, Payments · no error screen, no page error
- ✅ `/shop/orders/new` at `9058afb0` · no error screen and no page error in light and dark
- Accessibility note at `9058afb0`: on New order, both shipping zone radios have the accessible name "Shipping zone", and both saved address radios have the name "Saved address". A screen reader cannot tell the choices apart.
- Console: every shop page logs one React hydration warning on the theme toggle `aria-label`. The base Navbar has the same toggle, so it is not new on this branch.

## Not covered / needs human judgment
- The look of every screen against the approved mockup (C14, C17): Scenarios 1 and 2.
- The product page with images: the seed has no images, and the agent uploaded none.
- Real SMS delivery and a real bKash payment: the run uses the `console` SMS provider and the `manual` payment provider.
- Performance under large data: not run. The playground holds 4 products and 7 orders.
- Concurrency: the stock lock race is covered by `stock.test.ts` and the e2e refusal; no browser race was run.
- Accessibility beyond names and roles: no screen reader or contrast measure was run.
- The playground data is not reset. It keeps the QA product and orders listed under Environment.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
