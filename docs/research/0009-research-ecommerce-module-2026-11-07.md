# Research: an `ecommerce` module, adopt an engine or build in-house

Researched on 2026-11-07, after the CMS research of the same date. The owner answered the first round of open questions in the same session; their decisions are under [Decisions](#decisions).

## Recommendation

Build in-house as one `ecommerce` module, on Postgres only, with checkout through the existing `payment` capability. An engine (Medusa, Saleor, Vendure) brings a second backend, a second identity system and a second payment layer next to the ones Saasaloy already has, and staff would still need new admin screens against its API.

Choose Medusa instead if a project needs deep commerce features soon (multi-region pricing, promotions, returns, multi-warehouse stock) and accepts a separate Node server with Postgres and Redis. It is the strongest engine here: MIT core, headless API, and an admin that can be turned off.

## Options compared

| Option | Runtime | DB | License | Our admin instead of theirs | Better Auth | Maturity |
|---|---|---|---|---|---|---|
| In-house module | Workers (Hono API) | Postgres through `database-postgres` | ours | yes, by design | native | new code, scope below |
| Medusa v2 | Node 22+ server plus a worker process, 2 GB RAM or more | Postgres only, Redis recommended in production | MIT core; RBAC Enterprise needs a commercial agreement | yes, `admin.disable` exists | custom Auth Module Provider; staff `user` actor uses `emailpass` by default | v2.22.4, 37.1k stars |
| Saleor | Python (Django), optional Celery broker | Postgres | BSD-3 | yes, dashboard is a separate repo, API is GraphQL only | needs a bridge to a separate identity system, not checked | 3.23.47, 23.5k stars |
| Vendure | Node 22+, NestJS | Postgres, MySQL, MariaDB, SQLite (no D1) | GPLv3 since v3.0, or commercial from €199 a month | yes, separate Admin and Shop APIs | custom `AuthenticationStrategy` | v3.8.1, 8.6k stars |
| Shopware, Sylius | PHP | MySQL or MariaDB | not checked | not relevant | not relevant | dropped: another language and runtime |
| minshop | Workers + D1 + R2 (Astro SSR) | D1 | MIT | no, a complete app with its own admin | no | 191 stars; a template to clone, not a library |

No engine embeds as a TypeScript library inside a Worker.

### Why an engine loses

1. A second backend. Every engine needs a long-running Node or Python process and its own Postgres; Medusa adds Redis.
2. A second identity system. Staff sign in to `apps/admin` through Better Auth (ADR 0050). Each engine keeps its own users and sessions, so every admin call needs a bridge and two-way account mapping.
3. A second payment layer. Medusa and Vendure own payment sessions and providers. Reusing `payment` would mean writing engine payment providers that forward to `@repo/payment`, or running two ledgers.
4. The admin is the bigger half. Replacing the engine's admin with our screens still means building product, order and stock screens, only against a foreign API.

## Evidence (primary sources, fetched 2026-11-07)

- Medusa needs Node v22.22.0 or later and PostgreSQL: https://docs.medusajs.com/learn/installation
- Medusa production needs Postgres, Redis, and server plus worker modes with 2 GB RAM or more, and recommends Redis modules for the event bus, caching, locking and workflow engine; `admin.disable` exists: https://docs.medusajs.com/learn/deployment/general
- Medusa core is MIT, RBAC Enterprise is commercial, 37.1k stars: https://github.com/medusajs/medusa; latest release v2.22.4 on 6 Nov: https://github.com/medusajs/medusa/releases
- No native Workers support for the Medusa backend; a feature request opened 2026-10-29: https://github.com/medusajs/medusa/discussions, https://github.com/medusajs/medusa/discussions/13520. Meridian still hosts the Medusa backend elsewhere: https://github.com/casualchic/medusa-payload-cloudflare
- Medusa auth uses actor types; custom providers extend `AbstractAuthModuleProvider`: https://docs.medusajs.com/resources/commerce-modules/auth/auth-providers
- Medusa's `pp_system` provider "acts similarly to a cash-on-delivery (COD) payment method": https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider
- Medusa: one currency per region, more regions for more currencies: https://docs.medusajs.com/resources/commerce-modules/region
- Saleor is BSD-3, GraphQL only, separate dashboard repo: https://github.com/saleor/saleor; `DATABASE_URL` is "a PostgreSQL database": https://docs.saleor.io/setup/configuration; latest 3.23.47 on 3 Nov: https://github.com/saleor/saleor/releases
- Vendure is GPLv3 with a plugin exception, Node 22.12+, Postgres/MySQL/MariaDB/SQLite: https://github.com/vendure-ecommerce/vendure; MIT to GPLv3 with v3.0 in July 2024: https://vendure.io/blog/license-change-announcement; paid plans from €199 a month: https://vendure.io/licensing; latest v3.8.1 on 23 Oct: https://github.com/vendure-ecommerce/vendure/releases
- Vendure external auth through `AuthenticationStrategy` and `ExternalAuthenticationMethod`: https://docs.vendure.io/reference/typescript-api/entities/authentication-method
- minshop: MIT, Astro SSR on Workers with D1 and R2, a complete app: https://github.com/ddyy/minshop
- Better Auth phone number plugin: `signUpOnVerification` creates a user from a phone number and requires `getTempEmail`, because the user row needs an email: https://www.better-auth.com/docs/plugins/phone-number

### In this repo

- `payment` already fits orders: `CreateInput` takes `referenceType`/`referenceId`, an integer minor-unit `amount`, an ISO `currency`, and allows `userId: null` (`modules/payment/files/src/provider.ts`). Listeners react to status changes (`modules/payment/skills/saasaloy-payment/SKILL.md`).
- `confirm` throws unless the payment is `submitted` (`modules/payment/files/src/define.ts:343`), so a COD payment, which the payer never submits, cannot be confirmed today.
- `payments_reference_idx` on `(reference_type, reference_id)` already exists and is not unique (`modules/payment/files/db/schema/payment.pg.ts:80`), so one order can carry two payments.
- `users` holds every person once, clients and staff alike, with a nullable `role` that the admin plugin defaults to `"user"`; the admin app's guard reads `role` against `ADMIN_APP_ROLES` (`modules/auth/files/db/schema/auth.pg.ts:56-73`, ADR 0050).
- Phone sign-in ships as the `auth-phone` module (issue #308, PR #324, open and in review on 2026-11-07, not on `main` yet). It depends on `auth`, `sms` and `ratelimit`, patches Better Auth's phone number plugin into the client instance, and sets `signUpOnVerification` with a placeholder email (`modules/auth-phone/files/auth/plugins/phone-number.ts:34` on branch `issue-308-add-phone-number-sign-in`).
- `dependsOn` resolves recursively and installs missing prerequisites (`packages/cli/src/lib/resolve.ts`). `database-d1` and `database-postgres` declare `conflictsWith` on each other, and `detectConflicts` checks every module in the resolved graph against the installed set (`packages/cli/src/lib/conflicts.ts:68`). So `"dependsOn": ["database-postgres"]` installs Postgres in a project with no driver, and refuses `add` in a D1 project: the refusal says that database-postgres conflicts with the installed database-d1 and tells the user to run `saasaloy remove database-d1` first The comment above `ConflictAction` names this exact case (#98). No CLI change is needed.

## Decisions

Settled by the owner on 2026-11-07.

1. **Postgres only.** Most projects that need ecommerce run Postgres, so the module drops D1. Stock reservation uses a transaction with `SELECT … FOR UPDATE`, variant options can use `jsonb`, and catalog search can use `tsvector`. The module ships `.pg.ts` schema files only.
2. **COD is a method in `payment-manual`, not a new module.** The flows differ only in who acts and when: the payer submits nothing, the order ships while the payment is `pending`, and staff confirm after the courier remits.
   - Core change (a): `confirm` also accepts a `pending` payment when its method has no submit fields. COD is then a `payment-manual` method with an empty `fields` list and a note such as "Pay the rider in cash."
   - Add reject reasons for failed deliveries (proposed: `delivery_refused` for a buyer who refuses at the door, `delivery_failed` for a parcel that comes back undelivered).
   - Advance delivery charge by bKash plus COD for the rest is two payments on one order. The existing non-unique `payments_reference_idx` already supports this; it must stay non-unique. The order code sums `successful` payments by reference.
   - The state machine change probably earns a short ADR.
3. **One `ecommerce` module** holding product (with variants, options, categories, media, rich-text description), inventory, cart, order (including checkout), customer, and commerce reports. These share foreign keys in every direction and nobody installs one without the others. Everything else in the catalog below is a separate optional module for later.
4. **Checkout creates a customer from a phone number alone, verified by OTP during checkout.** `ecommerce` declares `"dependsOn": ["auth-phone"]` and reuses its plugin, SMS send log and number rules; it adds no auth code of its own. A repeat buyer whose phone is already verified on an existing user gets that user. A phone that is unverified, or not on any user, must pass an OTP before the order is placed.
5. **No multi-tenant stores in the MVP.**
6. **No customer role and no `customers` table.** A buyer is a client user with role `"user"`; `role` stays a privilege that the admin guard reads. `orders.user_id` points at `users.id`, `customer_addresses` holds addresses, and the admin Customers screen lists users with orders, with order count, total spent and COD refusals computed from `orders`. A 1:1 `customer_profiles` table comes later, only for data no order can derive (staff notes, a block flag).
7. **Postgres is enforced through the descriptor.** `ecommerce` declares `"dependsOn": ["auth-phone", "database-postgres", "payment", ...]`. The existing `conflictsWith` pair on the drivers makes `add` refuse a D1 project; see "In this repo".
8. **The module name is `ecommerce`.**

## MVP scope of `ecommerce`

- **Product.** `products` (draft or active, slug, title, CMS Tiptap description, media through `file-uploads`), `product_categories`, `product_options`, `product_option_values`, `product_variants` (SKU, option values, weight).
- **Prices.** `variant_prices` keyed by (variant, currency). The MVP sells in one currency from `config`; a second currency adds rows, not a migration. Prices are tax-inclusive, as BD retail prices include VAT.
- **Inventory.** Stock per variant, reserved in a transaction at order placement, released when the payment fails or is cancelled and when an unpaid order expires. An adjustment history records manual changes.
- **Cart.** `carts` and `cart_items` for a guest (cookie id) or a signed-in client user. Checkout reads prices again on the server.
- **Checkout and orders.** Create the order, then `createPayment(env).create({ referenceType: "order", ... })` with the amount from the order, never from the browser. A `payment` listener moves the order on. `order_items` copy title, SKU and unit price. Fulfilment status: unfulfilled, shipped, delivered, cancelled. A COD order may ship while its payment is `pending`.
- **Shipping inside the MVP.** Flat rates per zone set by staff (inside Dhaka, outside Dhaka), copied onto the order. No courier API.
- **Customer.** No table of its own; see decision 6. Checkout runs the `auth-phone` OTP step, then signs the buyer in on the client session.
- **Reports.** Sales over time, top products, order counts by status, COD collection and refusal rate.
- **Admin screens.** Products with variants and stock, orders with status changes, customers, shipping zones, reports.

## Module catalog for later

Possible modules for a full ecommerce system, kept to revisit. "Shape" uses the AGENTS.md terms.

| Module | Holds | Shape | Suggested phase |
|---|---|---|---|
| `shipping` | Zones, rates, shipments, tracking numbers (lifts the MVP flat rates out of `ecommerce`) | capability with `shipping-manual` | phase 2 |
| `shipping-pathao`, `shipping-steadfast`, `shipping-redx` | Courier booking and status sync | provider | phase 2 |
| `payment-sslcommerz`, `payment-bkash` | Gateways | provider (already planned) | phase 2 |
| `discount` | Promo codes, automatic discounts, usage limits | feature | phase 2 |
| `return` | Returns, RMA, restock, refunds through `payment` | feature | phase 2 |
| `invoice` | Invoice and packing slip PDFs | feature | phase 2 |
| `product-search` | Catalog search and filters | capability: `-postgres` (tsvector), later `-meilisearch` | phase 2 |
| `tax` | Tax rates per region, tax-exclusive pricing | feature | later |
| `review` | Ratings and reviews with moderation | feature | later |
| `wishlist` | Saved products | feature | later |
| `abandoned-cart` | Reminder SMS or email through `sms` and `email` | feature | later |
| `price-list` | Multi-currency storefront, customer-group and B2B prices | feature | later |
| `stock-location` | Multi-warehouse stock | feature extending inventory | later |
| `gift-card` | Store credit | feature | later |
| `digital-product` | Downloads through `storage` | feature | later |
| `bundle` | Kits of several variants | feature | later |
| `marketplace` | Multi-vendor stores and payouts | feature, needs `multitenant` | later |
| `pos` | In-store sales | feature | later |

## Open questions

All three rounds are settled. The third round (2026-11-07):

1. **`auth-phone` merges first.** The `ecommerce` build waits for PR #324 to merge; it does not stack on that branch.
2. **A buyer signed in on a verified email skips the phone OTP by default.** A project owner can require the phone OTP for every buyer through a config setting.
3. **Rate limits belong to `auth-phone`.** Checkout uses the OTP endpoints and limits that `auth-phone` already ships and adds no limiter of its own.

