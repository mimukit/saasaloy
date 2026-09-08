---
name: saasaloy-billing
description: Runbook for the billing capability — provider-agnostic subscriptions in packages/billing, with a plan file, a projection table, a billable-subject file and per-provider modules. Use when adding a plan, wiring a checkout or portal route, reading a BillingError, choosing or switching BILLING_PROVIDER, registering a webhook in the vendor's dashboard, or writing a third billing provider.
---

# billing — provider-agnostic subscriptions from `packages/billing`

`packages/billing` (`@repo/billing`) is the capability core: a provider contract, a plan table, a billable-subject file, the projection rules over `billing_subscription`, and a **provider registry**. It has **zero npm runtime dependencies** and names no payment vendor. Each provider ships as its own module, dropping one file into `src/providers/` and registering itself in the `providers` array in `src/index.ts`.

Callers import `@repo/billing`, call `createBilling(env)`, and never learn who takes the money. It is the same shape as `@repo/email` and `@repo/queue`, on purpose (ADR 0033, ADR 0034).

## The contract

```ts
interface BillingProvider {
  name: string;
  createCheckout(env, ctx, { subject, planId, interval, successUrl, cancelUrl });
  createPortal(env, ctx, { subject, returnUrl });
  changePlan(env, ctx, { subject, planId, interval, successUrl, cancelUrl });
  cancel(env, ctx, { subject });
  restore(env, ctx, { subject });
  setQuantity(env, ctx, { subject, seats });
  listInvoices(env, ctx, { subject });
  authPlugin?: unknown;
}
```

`env` goes in whole. Which key a provider reads — a secret key, a webhook signing secret, nothing — is exactly what a route must not know for providers to stay swappable. The core never reads `process.env`.

`createBilling(env)` throws a plain `Error` when `BILLING_PROVIDER` is unset or names a provider that is not installed. Required even with one provider installed, and there is no fallback in either direction: a silent default would either stop taking payments in production or start charging a real card in a test.

Every contract method throws exactly one error type, `BillingError`, with a stable `code`: `invalid_request`, `not_found`, `card_declined`, `rate_limited`, `webhook_invalid`, `provider_error`. The vendor's own code stays in `providerCode` and `retryable` is set honestly. The core never retries; `retryable` is what the `billing.event` consumer reads to decide between another delivery and the dead-letter queue.

## `HostContext`

Every contract method takes `{ headers: Headers; auth: unknown }` as its second argument, supplied by the route in `apps/api`.

The dependency runs `auth` → `billing` and never back (ADR 0034). `packages/billing` cannot import the auth instance to reach a vendor plugin mounted on it, and `apps/api` is the one workspace that imports both packages, so it hands the instance in. `auth` is `unknown` on purpose and is cast inside the provider file, which is what keeps every Better Auth type out of the core.

`headers` is `c.req.raw.headers`, forwarded so a provider can resolve the session the vendor's own endpoints expect.

## The subject file

`packages/billing/src/subject.ts` owns who the bill is addressed to. It exports `resolveSubject(c)`, `authorizeSubject(user, subject, action)` and `assertSubject(...)`.

The default bills the signed-in user: `customerType` is `"user"`, `referenceId` is the user id, and the only subject a user may act on is their own. **Installing `teams` replaces this one file** with an organization version under `onlyWith`, which reads the active organization off the session and checks membership instead. Nothing else in the capability — no route, no job, no entitlement check — learns which of the two it has. That is the whole point: moving billing from users to organizations is a one-file change.

`billing-stripe` wires `authorizeSubject` into the plugin's `authorizeReference`, so the same rule guards the vendor's own endpoints as guards these routes.

## The plan file

`packages/billing/src/plans.ts` is the file you edit. A plan carries `id`, `name`, `features` (booleans), `limits` (numbers), `trialDays?` and `providerIds` mapping a provider name to its price ids per interval.

**Exactly one plan carries no `providerIds`, and that one is the default** — what a subject with no live subscription resolves to, and what a locked subject falls back to. `definePlans` throws at module load when that stops being true, so the failure is a deploy that will not boot rather than a request that resolves to `undefined`.

Nothing seeds a table and nothing reads a plan back from a vendor. `stripeAuthPlugin()` maps this list into the plugin's own shape: `providerIds.stripe.monthly` → `priceId`, `.yearly` → `annualDiscountPriceId`, `trialDays` → `freeTrial.days`.

**The landing page keeps its own copy.** The base's `pricing-table` block reads `content/landing.ts`, and nothing patches one file from the other. Change a price and change both.

## The routes

`modules/billing` mounts seven endpoints at `/billing` in `apps/api`, all behind the session:

| Route | Body | Answers |
|---|---|---|
| `POST /billing/checkout` | `planId`, `interval`, `successUrl`, `cancelUrl` | `{ url }` |
| `POST /billing/portal` | `returnUrl` | `{ url }` |
| `GET /billing/subscription` | — | `{ subscription, plan, plans }` |
| `POST /billing/cancel` | — | `{ url }` |
| `POST /billing/restore` | — | `{ url }` |
| `POST /billing/change-plan` | `planId`, `interval`, `successUrl`, `cancelUrl` | `{ url }` |
| `GET /billing/invoices` | — | `{ invoices }` |

`POST /billing/checkout` **refuses when a live subscription already exists**, with `invalid_request` and a message pointing at the portal. One live subscription per subject is the settled rule; the table keeps history rows, and add-ons are a follow-up issue.

A `BillingError` is rendered as the api's `{ error: { code, message } }` envelope with a status per code: 400 for `invalid_request` and `webhook_invalid`, 402 for `card_declined`, 404 for `not_found`, 429 for `rate_limited`, 502 for `provider_error`.

## The projection, and who writes it

`billing_subscription` and `billing_event` are a **projection of the vendor's record**, not the record itself (ADR 0034). Every id that identifies a row upstream is a provider id, every write comes from an event the vendor sent, and the whole table is rebuildable by replaying events.

**No route writes the table.** The one writer is `applyEvent`, reached from the `billing.event` job. That keeps one dedupe rule and one code path to test.

`applyEvent` takes a `BillingStore` port rather than a Drizzle client, because the core has zero npm dependencies. `apps/api/src/billing-store.ts` builds that port over the request's client, owns the `AsyncLocalStorage` scope, and registers a reader for it with `setBillingStoreResolver` at module load. A job handler — which gets only `(payload, ctx)` — reads the port back with `requireBillingStore()`. The scope lives in `apps/api` rather than in the core because `node:async_hooks` would force `"types": ["node"]` on every workspace that imports `@repo/billing`, `packages/queue` first. Same arrangement as `packages/auth/src/db-scope.ts`, and for the same reason.

A queue consumer that dispatches outside a request has to enter that scope itself before calling `dispatch`. `queue-memory` needs nothing: it runs the job inline at `enqueue`, inside the route's scope.

## The event path

```
vendor webhook → provider verifies the signature → maps onto a BillingEvent
  → enqueue("billing.event", event) → consumer → applyEvent → billing_subscription
```

Normalized event types: `subscription.changed`, `subscription.deleted`, `trial.ending`, `payment.failed`, `payment.succeeded`. A vendor event that maps to none of them is dropped in the provider and never enqueued.

`applyEvent` inserts `(provider, providerEventId)` into `billing_event` **first** and returns early on the primary-key conflict. Every side effect below that insert — the row write, the lock clear, the emails — sits inside the guarded body, so a redelivered event runs none of them a second time. At-least-once delivery makes that mandatory, not optional.

`billing_event` is never pruned. It grows by a handful of rows per subscription per month, which is the price of the dedupe guarantee surviving a vendor's redelivery window.

## Register the webhook

Stripe posts to **`https://<your-api-host>/auth/stripe/webhook`** — under the auth base path, because `@better-auth/stripe` owns the endpoint and the signature check. Set `STRIPE_WEBHOOK_SECRET` to the signing secret the dashboard shows for that endpoint.

Subscribe these events and no others:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.payment_failed`
- `invoice.paid`

Locally, forward them with `stripe listen --forward-to localhost:4000/auth/stripe/webhook`.

## The providers

`BILLING_PROVIDER` selects one, always. Unset or unknown throws at construction, in both directions: a deploy that quietly stops taking payments and a test run that quietly charges a real card are both worse than a throw.

| Provider | `BILLING_PROVIDER` | Needs | Auth plugin |
|---|---|---|---|
| `billing-stripe` | `stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `stripe` 22.6.1 + `@better-auth/stripe` 1.7.3 | yes — mounts the endpoints and the webhook |
| `billing-console` | `console` | nothing | no |

**`billing-console` is how you develop.** It completes checkout, portal, change-plan, cancel and restore with no account and no network, by handing the route a `CheckoutResult.event` the route enqueues. With `queue-memory` installed the consumer runs inline, so the row is there by the time the route answers. Its ids are `console_sub_…` and `console_cus_…`, derived from the subject, so a `console_`-prefixed id in a production table is a loud signal that the wrong provider is selected.

`cancel` and `restore` carry no plan of their own, so the route reads the live row and passes it as `SubjectInput.current`. `billing-stripe` ignores that field — its webhook carries the whole record — and `billing-console` throws `not_found` without it rather than inventing a plan and writing the invention over the real row.

**A provider with its own webhook enqueues through `enqueueBillingEvent`**, not through `@repo/queue`. `packages/queue` imports `packages/billing` to register `billingEventJob()`, so an import back would be a cycle. `apps/api/src/billing-store.ts` calls `setBillingEnqueuer` at module load, the same arrangement `setBillingStoreResolver` uses for the database.

## The Stripe field map, and what to re-check on a version bump

`billing-stripe` maps `@better-auth/stripe`'s own model onto the core's vendor-blind columns through `schema.subscription`. `modelName` is `"billingSubscription"` — the **Drizzle export key**, not the SQL table name — and every value below is a Drizzle property, not a column name.

Checked against `@better-auth/stripe` **1.7.3**. These are all sixteen fields that version declares for its `subscription` model, plus the one it declares on `user`:

| Plugin field | Core column | Plugin field | Core column |
|---|---|---|---|
| `plan` | `plan` | `cancelAtPeriodEnd` | `cancelAtPeriodEnd` |
| `referenceId` | `referenceId` | `cancelAt` | `cancelAt` |
| `stripeCustomerId` | `providerCustomerId` | `canceledAt` | `canceledAt` |
| `stripeSubscriptionId` | `providerSubscriptionId` | `endedAt` | `endedAt` |
| `stripeScheduleId` | `providerScheduleId` | `seats` | `seats` |
| `status` | `status` | `billingInterval` | `billingInterval` |
| `periodStart` | `periodStart` | `trialStart` | `trialStart` |
| `periodEnd` | `periodEnd` | `trialEnd` | `trialEnd` |
| `user.stripeCustomerId` | `user.billingCustomerId` | | |

Three consequences worth holding:

- **The customer link is a real column on `user`.** `modules/billing` adds `user.billingCustomerId` with a `drizzle-column` patch on `packages/db/src/schema/auth.ts`, because a Better Auth plugin writes the customer id onto the `user` model and cannot be pointed at another table. `saasaloy remove billing` takes the column back out of the schema file; the deployed column survives until you generate and apply the migration.
- **`limits` is not passed through to the plugin.** The plugin writes a `limits` field onto the row whenever a plan config carries one, and that field is outside its declared schema, so no column exists for it. Limits live in `plans.ts` and `entitlements` reads them there.
- **The plugin's plan `name` is this project's plan *id*.** It lower-cases `name` and stores it in the `plan` column, which is the string `findPlan(plans, …)` looks up. Keep plan ids lower-case.

**On a `better-auth` or `@better-auth/stripe` bump:** open the new version's schema module and diff its `subscription` and `user` field lists against the table above. A field the plugin writes with no column behind it fails at the first webhook, not at `pnpm typecheck`.

**Two known limits of the Stripe path.** A subscription created by hand in the Stripe dashboard has no `referenceId` in its metadata, so `onEvent` cannot address a subject and enqueues nothing — the plugin's own handler still writes the row, but the queued side effects are skipped. And `invoice.paid` / `invoice.payment_failed` carry no subscription state worth projecting, so they enqueue the fact and no row; Stripe sends a `customer.subscription.updated` alongside whenever the plan or the status actually moved.

## Statuses and the lockout

Normalized statuses: `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `paused`. A provider maps its own vocabulary onto these and keeps the raw value in `metadata`.

`trialing`, `active` and `past_due` all still entitle the paid plan. `past_due` is in that set on purpose: a failed payment keeps the plan until the daily lockout job sets `lockedAt`, after `BILLING_LOCKOUT_DAYS` (14 when unset). A locked row keeps its status and stops entitling its plan; `payment.succeeded` clears the lock. `lockedAt` and `reminderSentAt` are core-only columns and no provider ever writes them.

## Write a third provider

One file in `src/providers/`, exporting a factory that returns a `BillingProvider`. Six steps:

1. **Implement the seven methods.** Read the vendor's secret off `env` inside that file and nowhere else.
2. **Map every failure onto `BillingError`.** Keep the vendor's code in `providerCode` and set `retryable` honestly; a wrong `true` charges someone twice.
3. **Map the vendor's events onto the five normalized types** and enqueue `billing.event`. Drop anything that maps to none.
4. **Map the vendor's statuses onto the seven normalized ones**, and keep the raw value in `metadata`.
5. **Read price ids from `providerIds.<your-name>`** in `plans.ts`. Never hard-code one.
6. **Register it.** A `plugin-array` patch appends your factory call to the `providers` array in `packages/billing/src/index.ts`, and a `package-json-dependency` patch puts the vendor SDK in `packages/billing/package.json` — never in another workspace (ADR 0020).

A provider whose vendor ships a Better Auth plugin also exports a plugin factory and registers it into `auth.plugins` with a second `plugin-array` patch, the way `billing-stripe` does. If a new provider would need a second runtime file or a scaffold of its own, the contract is wrong — fix the contract.

Run `.agents/skills/create-provider/` in its `billing` mode rather than writing the descriptor by hand.
