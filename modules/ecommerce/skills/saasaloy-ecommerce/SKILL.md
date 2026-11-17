---
name: saasaloy-ecommerce
description: Runbook for the ecommerce module, an in-house shop on Postgres. Use when adding, changing, or debugging products, variants, prices, stock, carts, orders or shipping zones in a Saasaloy project, or the `ecommerce` config section.
---

# ecommerce: an in-house shop on Postgres

`ecommerce` is a **feature module** (`saasaloy:feature`). It depends on api, database-postgres, validators, auth, auth-phone, admin, file-uploads, payment and cms, which `add` resolves and installs first. It runs on Postgres only: checkout locks variant rows with `SELECT … FOR UPDATE`, and `add` refuses a D1 project.

This runbook covers the core package, the schema and the repositories. The api routes, the admin screens and the storefront arrive in later phases of plan 0106.

## What it installs

| File | Lands at |
| --- | --- |
| `@repo/ecommerce` (money, totals, status machine, rules, types) | `packages/ecommerce/src/` |
| The `ecommerce` config section | `packages/config/src/sections/ecommerce.ts` |
| The tables and the `order_numbers` sequence | `packages/db/src/schema/ecommerce.ts` |
| The repositories: catalog, stock, cart, orders | `packages/db/src/repositories/ecommerce/` |
| One seed slice per table | `packages/db/src/seed/slices/` |
| The request schemas | `packages/validators/src/ecommerce.ts` |
| The repository tests (testing mode on) | `apps/api/src/lib/ecommerce/` |

Run `pnpm db:generate` after `add`, review the migration, and apply it with `pnpm db:migrate`.

## Money

Every amount is an integer in the currency's minor unit beside an ISO 4217 code, as in `payment`: 650 taka is `{ amount: 65000, currency: "BDT" }`. Use `toMinor` and `fromMinor` from `@repo/ecommerce` to convert, and `formatMoney` to show one. Prices include tax. `variant_prices` keys on (variant, currency), so a second currency is more rows, not a migration.

## Stock

Available stock is `inventory_levels.on_hand` minus the variant's `stock_reservations` whose `expires_at` is null or still ahead. An expired hold stops counting at once, with no sweep job.

- `createOrder` locks the variant rows, checks available stock, and writes the order, its lines, its reservations and its first event in one transaction. It throws `out_of_stock` and writes nothing when a line does not fit.
- A COD order holds with no expiry. An unpaid online payment holds for `unpaidHoldHours`. `setOrderHold` moves an order between the two.
- On hand changes only through a `stock_movements` row: at `shipped`, on a restock of a returned order, or on a staff edit (`adjustStock`).

## Orders

The status machine is `ORDER_TRANSITIONS` in `@repo/ecommerce`: `placed` to `confirmed` or `cancelled`, `confirmed` to `shipped` or `cancelled`, `shipped` to `delivered` or `returned`. `transitionOrder` refuses every other move with `invalid_transition` and writes one `order_events` row per move. `cancelExpiredOrders` cancels a `placed` order whose holds have all lapsed, with a `system` event.

## Settings

The `ecommerce` config section holds the store currency (`BDT`), the shop name, the base path (`/shop`), the page size, `requirePhoneOtp`, `unpaidHoldHours` (24), `guestCartDays` (30), `lowStockThreshold`, `orderNumberPrefix`, and the buyer SMS switches and templates. Override any key in `packages/config/src/project.ts`. The module declares no env var.

## Next

Run `saasaloy-database` for the migration that `add` and `remove` leave for you, `saasaloy-payment` for the payment each order takes, and `saasaloy-config` to override a setting.
