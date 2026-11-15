# Plan: in-house `ecommerce` module

Grilled: 2026-11-07

## Context

Saasaloy has a one-off `payment` capability but no way to sell products. A project that wants a shop must write its own catalog, cart, stock and order code, or run a separate engine. The research on 2026-11-07 (`docs/research/0009-research-ecommerce-module-2026-11-07.md`) compared Medusa, Saleor, Vendure and Workers-native projects and rejected each one: every engine needs its own server, its own identity system and its own payment layer, and staff would still need new screens in `apps/admin`.

The goal is that a project owner adds one module and runs a Bangladesh-ready shop: staff manage products, stock, orders and customers in `apps/admin`, and shoppers buy on `apps/web` with cash on delivery, bKash, Nagad, Rocket or bank transfer through `payment`.

Target: no number fits a new module with no baseline. The check is one end-to-end journey in `.dev` on Postgres: a guest adds a product to the cart, verifies a phone number by OTP, places a COD order, staff mark it shipped and delivered and confirm the COD payment, and the order shows `delivered`, the payment shows `successful`, and the variant's stock dropped by the quantity bought. The same journey fails cleanly when stock runs out.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Build or adopt | Build in-house (research 0009). |
| Module shape | One `saasaloy:feature` named `ecommerce`, laid out like `cms`: a scaffolded `packages/ecommerce` plus `files[]` for db, api, admin and web. It wraps no external service, so it takes neither providers nor drivers (ADR 0033, ADR 0037). It holds product, inventory, cart, order with checkout, customer and reports. Every other commerce module waits (research 0009, "Module catalog for later"). |
| Dependencies | `dependsOn`: `api`, `database-postgres`, `validators`, `auth`, `auth-phone`, `admin`, `file-uploads`, `payment`, `cms`. |
| Postgres only | `dependsOn: ["database-postgres"]` installs Postgres in a project with no driver. In a D1 project the existing `conflictsWith` pair makes `add` refuse and name `saasaloy remove database-d1` (`packages/cli/src/lib/conflicts.ts`). No CLI change. Schema ships as `.pg.ts` only. |
| Prerequisite | `auth-phone` (PR #324) merges to `main` before any build phase starts. The build does not stack on its branch. |
| Rich text and media | Product descriptions reuse `@repo/cms/editor` and the CMS renderer: the api renders HTML once on save and stores it beside the Tiptap JSON, as the CMS does at publish. Images reuse `file-uploads`. `ecommerce` depends on `cms` as it is, so a shop also gets the blog collection; a developer who does not want it removes one collection registration. Extracting a `rich-text` module stays a later refactor with no data change. The `ecommerce` build waits for the CMS Phase 2 package (#327) on `main`. (grill Q1) |
| Money | Integer minor units plus an ISO 4217 code, the same as `payment`. One store currency from config (default `BDT`). `variant_prices` keys on (variant, currency), so a second currency adds rows later, not a migration. Prices include tax. |
| Customers | No `customers` table and no customer role. A buyer is a client user with role `"user"`. `orders.user_id` references `users.id`. `customer_addresses` holds saved addresses. The admin Customers screen lists users with at least one order and computes counts, total spent and COD refusals from `orders`. |
| Checkout identity | Every order belongs to a user. Checkout uses the `auth-phone` OTP endpoints, its send log and its rate limits; `ecommerce` adds no auth code and no limiter. A guest verifies a phone by OTP, which signs them up or in on the client session. A buyer already signed in with a verified phone skips the OTP. A buyer signed in on a verified email skips the phone OTP unless the project sets `requirePhoneOtp: true`. An order links to an existing user only after that user's phone is verified. |
| Payment at checkout | Create the order, then `createPayment(env).create({ referenceType: "order", referenceId, amount, currency, method, userId })`, with the amount from the order row, never the browser. A `payment` listener moves the order on status changes. The order never keeps its own "paid" flag; it reads `payments` by reference (payment SKILL rule). One order may carry several payments over time (a retry after a failed payment, and later an advance delivery charge); `payments_reference_idx` stays non-unique. |
| Failed online payment | A `failed` or `cancelled` payment leaves the order `placed`. Its reservation returns to a timed hold (now plus the configured lifetime), and the order page offers "Pay again", which creates a new payment for the same order. (grill Q11) |
| COD delivery and cash | Two separate staff actions. `delivered` records the handover. Staff confirm the COD payment when the courier remits, from the order or in bulk from the payments list. A COD payment rejected with `delivery_refused` or `delivery_failed` moves a `shipped` order to `returned`. (grill Q12) |
| Cancel after payment | Staff may cancel an order with a `successful` online payment. The order then shows "Refund due" until staff record the refund through the existing `payment` refund route. No second refund path. (grill Q14, defaulted) |
| COD in `payment` | COD is a `cod` method in `payment-manual` with no submit fields. Core change: `confirm` also accepts a `pending` payment whose method has no submit fields. New reject reasons `delivery_refused` and `delivery_failed`. An ADR records the state machine change. |
| Stock | `inventory_levels` holds on-hand stock per variant. Checkout runs in one Postgres transaction: `SELECT … FOR UPDATE` on the variant rows, check available stock, insert the order and `stock_reservations` rows. Available = on hand minus live reservations. A reservation carries `expires_at`, so an expired hold stops counting with no sweep job (the base has no cron trigger). A COD order, a payment in `submitted` and a `successful` payment hold stock with no expiry. Stock leaves `on_hand` only at `shipped`, for every payment method: the reservation converts to a `stock_movements` row (grill Q13, defaulted). A failed or cancelled payment returns the hold to a timed one (Q11). A cancelled order deletes the reservation. Unpaid online-payment holds last 24 hours by default, set in config; an expired `placed` order with no submitted payment becomes `cancelled` the next time the shopper page, the admin list or checkout reads it, with a `system` order event (grill Q3, defaulted). A `returned` order shows a "Restock items" checkbox, checked by default, that writes `stock_movements` rows (grill Q8, defaulted). Staff stock edits write `stock_movements` too. |
| Products and variants | A product is `draft` or `active`. Each variant has an `active` flag. A variant with no price in the store currency cannot become active, and a product needs one or more active variants to go active. (grill Q4, defaulted) |
| Cart | A guest cart lives 30 days on a cookie. At sign-in it merges into the user's cart: quantities add, capped at available stock. (grill Q5, defaulted) |
| Orders | `orders` carries a human order number from a Postgres sequence, contact phone and name, shipping address and zone copies, subtotal, shipping, total, currency and status. `order_items` copy product title, variant title, SKU and unit price. `order_events` records every status change with the staff or `system` actor. |
| Order statuses | `placed → confirmed → shipped → delivered`, plus `cancelled` (from `placed` or `confirmed`) and `returned` (from `shipped`). A COD order stays `placed` until staff confirm it, usually after a phone call. An online-payment order moves to `confirmed` by itself when its payment becomes `successful`. (grill Q2) |

```ts
// order state machine (grill Q2, Q11, Q12)
placed    -> confirmed   // staff (COD), or listener on payment successful (online)
placed    -> cancelled   // staff, or system when an unpaid hold expires
confirmed -> shipped     // staff; reservation becomes stock_movements
confirmed -> cancelled   // staff; "Refund due" when a payment is successful
shipped   -> delivered   // staff; COD cash confirmed separately
shipped   -> returned    // staff, or listener on COD reject delivery_refused / delivery_failed
```

| Decision | Resolution |
|----------|-----------|
| Order page access | Session only. A buyer opens their orders after signing in, with phone OTP on any device. No URL token exists. (grill Q6) |
| Buyer SMS | Through `sms`, which `auth-phone` already installs. One SMS on `confirmed` and one on `shipped`, each switchable in config, both on by default. (grill Q10) Config holds `notifyOnConfirmed`, `notifyOnShipped` and one message template each with `{orderNumber}` and `{shopName}` placeholders, English by default. (grill Q15, defaulted) |
| Shipping in the MVP | `shipping_zones` with a flat rate each (for example inside Dhaka, outside Dhaka), staff-managed. The chosen zone and rate are copied onto the order. No courier API. A later `shipping` capability lifts this out. |
| Reports | Computed by SQL at read time, no rollup tables: sales by day, top products, orders by status, COD collection and refusal rate. Ranges: today, 7 days, 30 days, custom. The COD rate is shown by order count, with the amount beside it. (grill Q9, defaulted) |
| Checked-in settings | An `ecommerce` config section at `packages/config/src/sections/ecommerce.ts` (ADR 0052): store currency, shop name, shop base path (`/shop`), page size, `requirePhoneOtp` (default `false`), unpaid hold lifetime (default 24 hours), guest cart lifetime (default 30 days), low-stock threshold, order number prefix, and the SMS keys above. |
| Storefront | Astro pages in `apps/web` with `prerender = false`: catalog, product, cart, checkout, order status. Cart and checkout are React islands, as `waitlist` ships `WaitlistForm.tsx`. Marketing pages stay prerendered. The web Worker entry follows whatever CMS Phase 5 settles. |
| Admin | A nav group "Shop" with Products, Orders, Customers, Shipping zones and Reports, from `modules/admin/files/DESIGN.md`. Who can edit: the roles that already open the admin shell (`ADMIN_APP_ROLES`). |
| Tests | Vitest beside the source on the Postgres test harness (`modules/database-postgres/files/src/testing.ts`, one rolled-back transaction per test). Api route tests follow `file-uploads/files/api/routes/files.test.ts`. The end-to-end journey is a Playwright spec in the `e2e` module's pattern (ADR 0051, ADR 0054: a feature module owns its journeys). No new runner. |
| UI house rules | Admin screens follow `modules/admin/files/DESIGN.md`. Shop pages follow `packages/cli/templates/base/apps/web/DESIGN.md`. |
| Visual reference | None yet. Phase 1 produces the mockup, and the owner approves it before any build (AGENTS.md rule). Phase 1 gates every later phase, Phase 2 included. (grill Q17) |
| Tracking | One GitHub issue, #328, tracks the whole plan. |
| Approved outward action | Phase 7 files one `needs-planning` issue titled `feat(ecommerce): take the delivery charge in advance by bkash`. No other issues. (grill Q16) |

## Approach

One feature module copied from the `cms` layout. It reuses:

- `payment` and `payment-manual` for every taka that moves, plus the listener hook for order status
- `auth-phone` for the OTP, the phone account and its rate limits
- `cms` for the Tiptap editor, renderer and link filter
- `file-uploads` for product images (`storage_objects`, `POST /files/uploads`, `public-image.ts`)
- the admin shell, its `nav-entry` and `nav-counts` patch kinds (as `payment` uses them for its review count)
- `chained-route` for `apps/api/src/index.ts`, `plugin-array` for the config section and env preset
- the Postgres test harness and the `e2e` module

Rejected alternatives, one line each:

- **Five modules** (`product`, `inventory`, `cart`, `order`, `customer`). Their tables share foreign keys in every direction and nobody installs one alone, so the split buys five descriptors and no swap.
- **D1 support.** Most projects that sell run Postgres; D1 would cost the row lock and a second schema.
- **A COD provider module.** It duplicates `payment-manual` for a flow that differs only in who confirms.
- **A cron sweep for unpaid orders.** Timestamped reservations reach the same result with no scheduled handler in the base.

### Phase 1: mockup (#328)

Attended: the owner approves the mockup screenshots. An unattended run stops before Phase 2 until this plan records the approval. Every later phase waits, Phase 2 included (grill Q17).

- Admin: Products list (title, status, price range, stock, low-stock tone), product editor (title, slug, Tiptap description, images, options and generated variants grid with SKU, price, stock and active flag), Orders list with status filters and a COD tag, order detail (items, totals, address, payments panel with COD confirm and the two delivery reject reasons, status actions, the "Refund due" notice, the "Restock items" checkbox on return, event history), bulk COD confirm on the payments list, Customers list and detail, Shipping zones, Reports with the range picker.
- Shop: catalog grid, product page with option pickers and an out-of-stock state, cart, checkout (contact phone with the OTP step, address, zone, payment method with COD and bKash instructions), order status page with "Pay again" after a failed payment, and the signed-in orders list. Light and dark themes, phone width included.
- Record the approval and the round it settled on as a Design decisions row.

Done when: this plan carries a "Mockup approved" row with the date and the screenshot paths.

### Phase 2: COD in `payment` (#328)

- `modules/payment/files/src/define.ts`: `confirm` accepts `pending` when the payment's method declares no submit fields; every other path is unchanged.
- Add `delivery_refused` and `delivery_failed` to `RejectReason`, `REJECT_REASONS`, the admin payments screen and the skill.
- `modules/payment-manual/files/manual.ts`: a `cod` method with empty `fields` and a configurable note.
- Write the ADR for the state machine change.
- Update `saasaloy-payment` SKILL.md and add an update note beside the code (ADR 0058).

Done when: `pnpm test` shows that `confirm` on a pending `cod` payment returns `successful`, `confirm` on a pending `bkash` payment still throws `conflict`, and `reject` with `delivery_refused` returns `failed`. `scripts/env-presets.test.ts` passes.

### Phase 3: core package and schema (#328)

Starts only when `auth-phone` (#324) and the CMS Phase 2 package (#327) are on `main`.

- Scaffold `packages/ecommerce` (`@repo/ecommerce`): money helpers, cart and order total math, the order status machine, and the shared types.
- Add the `ecommerce` config section with a `plugin-array` patch.
- Add Postgres schemas: `products`, `product_categories`, `product_options`, `product_option_values`, `product_variants`, `product_images`, `variant_prices`, `inventory_levels`, `stock_reservations`, `stock_movements`, `carts`, `cart_items`, `shipping_zones`, `customer_addresses`, `orders`, `order_items`, `order_events`, and the order number sequence.
- Add repositories in `@db/repositories/ecommerce/` for catalog, stock (reserve, release, convert), cart and orders; Zod validators in `@validators/ecommerce.ts`; a seed slice with sample products, variants, stock and two zones.
- Add `env-preset.ts` only if the module declares `envVars`.

Done when: `pnpm test` passes the money, totals, status machine, validator and repository tests. The status machine test refuses every transition outside the grill Q2 table. A repository test reserves the last unit twice in two transactions and only one succeeds. An expired reservation does not reduce available stock, and `on_hand` changes only at `shipped`. A variant with no store-currency price cannot be activated. `scripts/table-names.test.ts` passes with every new table.

### Phase 4: api routes (#328)

- `apps/api/src/routes/ecommerce.ts` at `/shop` and `apps/api/src/routes/admin-ecommerce.ts` at `/admin/shop`, through `chained-route` patches.
- Public: list and read active products, read and change a cart (with the sign-in merge), list zones, start checkout (needs a client session with a verified phone, or a verified email when `requirePhoneOtp` is false), list and read the caller's own orders (session only), and "Pay again" on a `placed` order whose last payment failed.
- Checkout: lock variants, check stock, create the order and reservations in one transaction, then call `payment.create`; return `next` from `payment`.
- Reading an order, the admin list or checkout cancels any expired unpaid `placed` order it touches, with a `system` event.
- A `payment` listener registered in `packages/payment/src/index.ts` applies the grill Q2, Q11 and Q12 rules: `successful` online payment → `confirmed` and the hold loses its expiry; `failed` or `cancelled` → timed hold again; COD reject with a delivery reason → `returned`.
- SMS on `confirmed` and `shipped` through `sms`, per the config switches.
- Admin: product CRUD with variant generation and price and stock edits, order list and detail, status actions, customer list and detail, zone CRUD, report queries; `nav-counts` for `placed` COD orders awaiting a call.

Done when: route tests show that a signed-out checkout gets 401, a session with an unverified phone gets 403, a quantity above available stock gets 409 and writes no order, a browser-sent price is ignored, and a non-admin gets 403 on admin routes. Listener tests show that a `successful` payment moves the order to `confirmed`, a `failed` payment leaves it `placed` with a timed hold and "Pay again" creates a second payment, and a `delivery_refused` reject moves a `shipped` order to `returned`. A read of an order past its hold returns it `cancelled`.

### Phase 5: admin screens (#328)

- `nav-entry` patches for the "Shop" group.
- Build the screens from the approved mockup. Use `@repo/cms/editor` for descriptions and the `file-uploads` block for images. Confirm and reject COD payments from the order detail through the existing `/admin/payment` routes.

Done when: in `.dev`, an admin creates a product with two options, gets the variant grid, sets prices and stock, publishes it, confirms a `placed` COD order, ships it, marks it delivered, confirms the COD payment, and sees the customer and the report figures change. A second COD order rejected with `delivery_refused` shows `returned`, and the restock checkbox puts the stock back.

### Phase 6: storefront (#328)

- `apps/web` pages under the configured base path with `prerender = false`: catalog, product, cart, checkout, order status.
- Cart and checkout islands; the OTP step calls the `auth-phone` client.
- The `@repo/ecommerce` web client reads the public routes over `PUBLIC_API_URL`.

Done when: in `.dev`, a guest buys a product with COD after an OTP, the order status page shows `placed`, `/`, `/privacy` and `/terms` are still prerendered files in `dist/client`, and `wrangler deploy --dry-run` passes for `apps/web`.

### Phase 7: journey, skill and gates (#328)

- A Playwright journey for the target scenario and the out-of-stock refusal, gated on the installed modules (ADR 0051).
- `modules/ecommerce/skills/saasaloy-ecommerce/SKILL.md`: add a product, the stock rules, the checkout and listener flow, COD handling, the config keys, and how a later module (shipping, discount) plugs in.
- `removeWarnings` for every table and the sequence.
- File the follow-up issue `feat(ecommerce): take the delivery charge in advance by bkash` with the `needs-planning` label (grill Q16).
- Run `pnpm lint`, `pnpm test`, `pnpm deps:check`, `saasaloy add ecommerce` in `.dev` on a Postgres project, and the same `add` on a D1 project.

Done when: all commands pass, the journey passes and shows the target result (order `delivered`, payment `successful`, stock reduced by the quantity bought), `add` on the D1 project refuses with the `saasaloy remove database-d1` hint, and the follow-up issue exists.

## Migration and rollback

The module adds new tables and one sequence and changes no existing rows. Phase 2 adds two values to the reject reason list, which existing rows never hold, so no data moves. To roll back the module, remove it, run `db:generate`, review the drop migration, and apply it; `removeWarnings` says that orders are the only record of sales and must be exported first. To roll back Phase 2, revert the code; a `cod` payment confirmed from `pending` stays a valid `successful` row.

## Open questions

None. The grill on 2026-11-07 settled every question (Q1 to Q17).

## Non-goals

- The advance delivery charge by bKash with COD for the rest. Phase 7 files the follow-up issue (grill Q7).
- A URL token for the order page (grill Q6).
- SMS on statuses other than `confirmed` and `shipped`.
- Every module in research 0009's "Module catalog for later": courier APIs, discounts, tax rules, returns as RMA, invoices, search, reviews, wishlists, abandoned carts, price lists, multi-warehouse, gift cards, digital goods, bundles, marketplace, POS.
- D1 support.
- Multi-tenant stores.
- A storefront currency switcher or FX conversion.
- Gateway providers (`payment-sslcommerz`, `payment-bkash`); they are already planned in the payment work.
