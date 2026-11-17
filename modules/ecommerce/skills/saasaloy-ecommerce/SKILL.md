---
name: saasaloy-ecommerce
description: Runbook for the ecommerce module, an in-house shop on Postgres. Use when adding, changing, or debugging products, variants, prices, stock, carts, checkout, orders, cash on delivery, shipping zones, the shop admin screens or the storefront in a Saasaloy project, or the `ecommerce` config section.
---

# ecommerce: an in-house shop on Postgres

`ecommerce` is a **feature module** (`saasaloy:feature`). It depends on api, database-postgres, validators, auth, auth-phone, admin, file-uploads, payment and cms, which `add` resolves and installs first. It runs on Postgres only: checkout locks variant rows with `SELECT … FOR UPDATE`. In a D1 project `add` refuses and names `saasaloy remove database-d1`, because `database-postgres` conflicts with `database-d1`.

Staff manage products, stock, orders, customers, shipping zones and reports in `apps/admin`. Shoppers buy on `apps/web`, after a phone code, with cash on delivery or any manual method `payment-manual` offers. The module wraps no external service, so it takes neither providers nor drivers.

## What it installs

| Part | Lands at |
| --- | --- |
| `@repo/ecommerce` (money, totals, status machine, stock rules, the payment listener, the web client at `@repo/ecommerce/client`) | `packages/ecommerce/src/` |
| The `ecommerce` config section | `packages/config/src/sections/ecommerce.ts` |
| 17 tables and the `order_numbers` sequence | `packages/db/src/schema/ecommerce.ts` |
| The repositories: catalog, stock, cart, orders, customers, reports, zones | `packages/db/src/repositories/ecommerce/` |
| One seed slice per table (sample products, the zones "Inside Dhaka" and "Outside Dhaka") | `packages/db/src/seed/slices/` |
| The request schemas | `packages/validators/src/ecommerce.ts` |
| The shop routes at `/shop` and the staff routes at `/admin/shop` | `apps/api/src/routes/ecommerce.ts`, `admin-ecommerce.ts` |
| The order flow, the listener work, the audit actions | `apps/api/src/lib/ecommerce/`, `apps/api/src/audit/ecommerce.ts` |
| The "Shop" nav group: Products, Orders, Customers, Shipping zones, Reports | `apps/admin/src/routes/shop/` |
| The storefront pages and islands, and the web auth client | `apps/web/src/pages/shop/`, `apps/web/src/components/shop/`, `apps/web/src/lib/` |
| The browser journey (with `e2e` installed) | `packages/e2e/specs/ecommerce-journey.spec.ts` |

After `add`, run `pnpm --filter @repo/db db:generate`, review the migration, and apply it with `pnpm db:migrate`. Then run `pnpm db:seed` for the sample catalog.

## Turn on cash on delivery

`ecommerce` depends on `payment`, not on `payment-manual`. `add ecommerce` alone installs no payment method, so checkout says the shop takes none. For cash on delivery:

1. Run `saasaloy add payment-manual`.
2. Set `PAYMENT_PROVIDER=manual` (or `manual,<other>`) in `packages/env/.env`, then run `pnpm env:setup`.
3. Turn `cod` on in `packages/payment/src/index.ts`. `payment-manual` switches no method on by itself:

```ts
export const payment = definePayment({
  providers: [
    manual({
      methods: {
        cod: {},
        bkash: { account: "01712345678", kind: "personal" },
      },
    }),
  ],
  listeners: [orderPaymentListener()],
});
```

A wallet or bank method with an `account` shows that account and the order total at checkout, before the order exists. Checkout lists `cod` first.

## Add a product

In the admin, open Shop, then Products, then "New product" (`/shop/products/new`). "Create product" stores the title, slug and category and opens the product page. A new product is a `draft` with one default variant.

1. Write the description in the editor. It is Tiptap JSON from `@repo/cms/editor`; the api renders it to HTML on save.
2. Add images. They are `file-uploads` rows.
3. Optional: add up to three options with "Add option" (Size, Colour), then "Save options". The variant grid is regenerated. A kept combination keeps its SKU, prices and stock; a new one starts inactive and unpriced.
4. In the variant grid, give each variant a SKU, a price in the store currency, the active flag and the stock on hand. Then save the variants. A stock change writes a `stock_movements` row.
5. Select "Publish". A product goes active only with one or more active variants, and a variant goes active only with a price in the store currency (`no_store_price`).

The staff api does the same, under the admin session with `x-auth-audience: admin`: `POST /admin/shop/products`, `PUT /admin/shop/products/:id/options`, `PUT /admin/shop/variants/:id` (`{ sku, price, active }`), `POST /admin/shop/variants/:id/stock` (`{ onHand }` or `{ delta }`), `POST /admin/shop/products/:id/status` (`{ status: "active" }`). The browser journey sets up its product this way.

A product slug of `cart`, `checkout` or `orders` is shadowed by the storefront page of that name.

## Money

Every amount is an integer in the currency's minor unit beside an ISO 4217 code, as in `payment`: 650 taka is `{ amount: 65000, currency: "BDT" }`. Use `toMinor` and `fromMinor` from `@repo/ecommerce` to convert, and `formatMoney` to show one. Prices include tax. `variant_prices` keys on (variant, currency), so a second currency is more rows, not a migration. No request body carries a price: checkout reads every figure from the catalog and the zone.

## Stock

Available stock is `inventory_levels.on_hand` minus the variant's `stock_reservations` whose `expires_at` is null or still ahead. An expired hold stops counting at once, with no sweep job.

- A cart holds no stock. Adding past the available stock answers 409 `out_of_stock`. At sign-in a guest cart merges into the user's cart, the quantities added and capped at available stock.
- Checkout checks each cart line, then `createOrder` locks the variant rows, checks again, and writes the order, its lines, its reservations and its first event in one transaction. When stock ran out in between, checkout answers 409 `out_of_stock` with a message that names the item, such as "Cotton tee sold out while you checked out. Remove it from the cart to place the order." (`shortLineMessage` in `@repo/ecommerce`). Nothing is written.
- A COD order, a `submitted` payment and a `successful` payment hold with no expiry. An unpaid online payment holds for `unpaidHoldHours`. `setOrderHold` moves an order between the two.
- On hand drops only at `shipped`, for every method: the reservation becomes a `stock_movements` row. A cancelled order deletes its reservation. A returned order offers "Restock items", which writes movements back.
- `cancelExpiredOrders` cancels a `placed` order whose holds have all lapsed, with a `system` event. The buyer's pages, the admin list and checkout call it when they read.

## Orders

The status machine is `ORDER_TRANSITIONS` in `@repo/ecommerce`. `transitionOrder` refuses every other move with `invalid_transition` and writes one `order_events` row per move, with the staff or `system` actor.

```text
placed    -> confirmed   staff (COD, usually after a call), or the listener on a successful online payment
placed    -> cancelled   staff, or system when an unpaid hold expires
confirmed -> shipped     staff; the reservation becomes stock_movements
confirmed -> cancelled   staff; "Refund due" while a payment is successful
shipped   -> delivered   staff; the COD cash is confirmed on its own
shipped   -> returned    staff, or the listener on a COD reject delivery_refused / delivery_failed
```

The order number comes from the `order_numbers` sequence, from 1001, shown with `orderNumberPrefix` (`ORD-1001`). The buyer gets one SMS on `confirmed` and one on `shipped`, through `sms`, when the config switches are on.

## Checkout and the payment listener

`POST /shop/checkout` needs a client session (401) whose user has a verified phone, or a verified email while `requirePhoneOtp` is false (403 `phone_unverified`). It places the order from the caller's cart, then calls `createPayment(env).create({ referenceType: "order", referenceId, amount, currency, method, userId })` with the amount from the order row. When the payment cannot start, the system cancels the order and the error goes on to the caller. The answer carries `next` from `payment`: instructions for a manual method, a redirect for a hosted one.

Checkout sends no `returnUrl`, because `payment` checks it against `PAYMENT_APP_URL` even for a manual method. A hosted gateway returns the buyer to its own default address.

The order keeps no "paid" flag. It reads `payments` by `reference_type = "order"`, and one order may carry several payments over time. `orderPaymentListener()` from `@repo/ecommerce` is registered in `packages/payment/src/index.ts`, and `apps/api/src/lib/ecommerce/payment-listener.ts` does the work:

- `successful` on an online payment confirms a `placed` order.
- `submitted` makes the hold untimed.
- `failed` or `cancelled` makes the hold timed again, and the order page offers "Pay again" (`POST /shop/orders/:number/pay`), which starts a new payment, with another method when the buyer picks one.
- A COD payment rejected with `delivery_refused` or `delivery_failed` moves a `shipped` order to `returned`.

## Cash on delivery

COD is the `cod` method of `payment-manual`. It takes no submission, so its payment stays `pending` until staff act. Delivery and cash are two separate staff actions:

1. Confirm the order ("Confirm order"), usually after a phone call. The Orders nav badge counts placed COD orders that wait on that call.
2. "Mark shipped", then "Mark delivered". Delivered records the handover only.
3. When the courier remits, confirm the cash: "Confirm cash received" on the order's Payments panel, or several at once on the payment module's Payments page (Pending chip, the checkbox column, then "Confirm cash received").
4. When the parcel comes back, reject the COD payment with "Delivery refused by the buyer" or "Delivery failed". The listener returns the order.

The customer list counts COD refusals per buyer from `orders`.

## Sign-in at checkout

Every order belongs to a user. Checkout and the order pages use `auth-phone`'s code endpoints, its send log and its limits; `ecommerce` adds no auth endpoint and no limiter. `apps/web/src/lib/shop-auth.ts` is the web app's auth client, and `PhoneStep.tsx` drives it:

- A new number gets the sign-up code. `verify` creates the account and opens the session. The guest cart merges into it.
- A known number gets a sign-in code (`send-otp` with `signIn: true`). A banned account gets `BANNED_USER`.
- With `codeSignIn: false` in the `auth-phone` config section, a known number signs in with its password instead. The same step offers "Forgot your password? Get a code", which sends a reset code, takes it with a new password, and signs the buyer in, without leaving checkout.
- A buyer already signed in with a verified phone skips the step. So does one on a verified email, unless `requirePhoneOtp` is true.

The order pages are session only; there is no order link token.

### Web and api on one parent domain

The session cookie must reach both `apps/web` and the api. In production put them on one parent domain, such as `shop.x.com` and `api.x.com`. `packages/auth/src/auth.ts` then sets `crossSubDomainCookies` with the domain from `COOKIE_DOMAIN`, or the one derived from `BETTER_AUTH_URL`. On two unrelated domains the code step succeeds and the next call is still signed out. Add the web origin to `CORS_ORIGINS` as well.

## Storefront

The shop pages live in `apps/web/src/pages/shop/` with `prerender = false`: the catalog (category chips, sort, pager), a product, the cart, checkout, the order list and one order. The marketing pages stay prerendered. `wrangler.jsonc` lists `/shop` and `/shop/*` in `assets.run_worker_first`, and the navbar gains a "Shop" link. Astro routes by folder name, so to move the shop rename that folder, `basePath` and both `run_worker_first` entries together.

The pages read the api through `@repo/ecommerce/client` over `PUBLIC_API_URL`, with the browser's cookies. A guest cart lives on the `shop_cart` cookie for `guestCartDays`.

## Admin screens

The "Shop" group in `apps/admin` is open to the roles that open the admin shell (`ADMIN_APP_ROLES`). Every write runs through `adminWrite` and names its action in `apps/api/src/audit/ecommerce.ts` as `ecommerce.<object>.<verb>`; `audit-coverage.test.ts` fails on an unnamed route.

- **Products**: the list with stock and the low-stock tone, the product page with the editor, images, options and the variant grid.
- **Orders**: status filters and the COD filter; the order page with the header actions, the "waits on" line, items, contact, address, payments and history. "New order" (`/shop/orders/new`) places an order for a phone: a known phone links to its user, a new one becomes a client user with an unverified phone. Line prices come from the catalog. "Payment already received" confirms a payment at once and needs the payment confirm route's own gate (`requireAdmin`).
- **Customers**: users with one or more orders, with counts, total spent and COD refusals.
- **Shipping zones**: a flat rate per zone. Checkout copies the zone name and rate onto the order.
- **Reports**: sales by day, top products, orders by status and the COD collection and refusal rate, for today, 7 days, 30 days or a custom range in `timeZone`.

## Changes to other modules

This module came with changes in the modules it uses. A project that installed them before reads their update notes:

| Module | Note | Change |
| --- | --- | --- |
| `auth-phone` | `0001-code-sign-in` | Sign-in by code for a known number, the `codeSignIn` key |
| `payment` | `0001-review-from-pending` | Confirm or reject a `pending` payment whose method takes no submission; the reasons `delivery_refused` and `delivery_failed` |
| `payment` | `0002-bulk-cod-confirm` | Confirm several COD payments at once on the Payments page |
| `payment` | `0003-method-account` | A listed method may carry its `account` |
| `payment-manual` | `0001-cod-method` | The `cod` method |
| `payment-manual` | `0002-method-account` | Each wallet and bank method lists its account |
| `admin` | `0005-admin-write-roles` | `adminWrite` takes a `roles` option |
| `e2e` | `0002-shop-tags` | The `ecommerce` and `payment-manual` spec tags |

## Settings

The `ecommerce` config section holds checked-in values. Override any key in `packages/config/src/project.ts`. The module declares no env var.

| Key | Default | What it does |
| --- | --- | --- |
| `currency` | `"BDT"` | The store currency. A variant needs a price in it to be active. |
| `shopName` | `"Shop"` | Page titles and `{shopName}` in each SMS |
| `basePath` | `"/shop"` | The storefront prefix on `apps/web` |
| `pageSize` | `24` | Products per catalog page |
| `requirePhoneOtp` | `false` | Ask a buyer on a verified email for a phone code too |
| `unpaidHoldHours` | `24` | How long an unpaid online-payment order holds stock |
| `guestCartDays` | `30` | How long a guest cart lives on its cookie |
| `lowStockThreshold` | `5` | Available stock at or below this shows the low-stock tone |
| `timeZone` | `"Asia/Dhaka"` | The day boundary of the reports |
| `orderNumberPrefix` | `"ORD-"` | Put before the order number |
| `notifyOnConfirmed`, `notifyOnShipped` | `true` | Send the buyer SMS on that move |
| `confirmedMessage`, `shippedMessage` | English text | The SMS templates, with `{orderNumber}` and `{shopName}` |

`codeSignIn` lives in the `auth-phone` section, not here.

## Browser journey

With `e2e` installed, `packages/e2e/specs/ecommerce-journey.spec.ts` runs under `pnpm e2e`. It carries the tags `@ecommerce`, `@admin`, `@payment-manual` and `@sms-console`, so a project without one of those modules never collects it. It drives two flows:

- A guest adds two units to the cart, verifies a new phone by code, and places a COD order. Staff confirm, ship and deliver it and confirm the cash. The order ends `delivered`, the payment `successful`, and the variant's on hand is lower by two.
- Two buyers race for the last unit. The second gets the `out_of_stock` message at "Place order", no order, a sold-out cart line, and the stock stays held by the first order.

It needs `SMS_PROVIDER=console` in `apps/api/.env` and `cod` turned on; it refuses with the line to add when the shop offers no `cod`.

## Plug in a later module

The MVP keeps each later capability's seam in one place, so a module adds files and patches rather than rewriting checkout.

- **Shipping** (courier rates, tracking): today `shipping_zones` holds a flat rate, and the order copies `zone_name` and `shipping`. A `shipping` module supplies the rate at checkout and keeps that copy, so past orders keep their figures. A courier booking reacts to the `shipped` move: read `order_events`, or call it beside `transitionOrder`.
- **Discount**: totals come from `cartTotals` and `orderTotals` in `@repo/ecommerce` and are copied onto the order. A discount module adds its line to those totals and a column or table for the adjustment, and checkout keeps reading every figure on the server. Staff cannot change a line price on "New order" until it exists.
- **Advance delivery charge by bKash**: one order may carry several payments by `reference_type = "order"`, so a second payment for the charge needs no schema change. Its own issue tracks it.
- **Anything that reacts to money**: add a listener to `listeners` in `packages/payment/src/index.ts`, beside `orderPaymentListener()`.

## Removal

`saasaloy remove ecommerce` takes the files and the reversible patches back. Its warnings say what stays:

- The 17 tables and the `order_numbers` sequence stay deployed. Orders, order items and order events are the only record of what the shop sold, so export them, then run `pnpm --filter @repo/db db:generate` and review the drop migration before you apply it.
- The shop's payments stay in `payments`, and product images stay in `storage_objects`. Settle the open COD payments first: once the module is gone, no listener moves an order.
- `@repo/ecommerce` stays in `packages/payment/package.json` and the other workspaces' `package.json`, because a `package-json-dependency` patch has no inverse. Drop those lines by hand and run `pnpm install`. Check that `packages/payment/src/index.ts` no longer imports `orderPaymentListener`, and delete it by hand if the remover refused.

## Next

Run `saasaloy-database` for the migration that `add` and `remove` leave for you, `saasaloy-payment` for the payment each order takes, `saasaloy-auth-phone` for the codes and `codeSignIn`, `saasaloy-e2e` to run the journey, and `saasaloy-config` to override a setting.
