# 0034 — Billing tables are a projection of the vendor's record

`billing` takes **provider modules**, not driver modules. The project owns the `billing_subscription` schema and queries it on every entitlement check, so [ADR 0033](adr-0033-transient-state-capabilities-take-providers-2026-09-08.md)'s first question says drivers. Its second question says providers, because moving from Stripe to Polar moves no data: a payment method never transfers between vendors, so a swap re-subscribes customers rather than migrating rows. ADR 0033 states that the second question wins, and this ADR is the first case where the two disagree. It also records the dependency direction `auth` → `billing` and the `HostContext` that direction forces. Settled while planning issue [#126](https://github.com/mimukit/saasaloy/issues/126) (`docs/plans/plan-billing-capability-module-2026-09-08.md`).

## Status
accepted. Applies [ADR 0033](adr-0033-transient-state-capabilities-take-providers-2026-09-08.md) and adds the `billing` row to its capability table.

## The table is a projection, not the record

Stripe holds the customer, the payment method, the price and the subscription. `billing_subscription` holds a copy of the part the project needs to answer a question in a request: which plan is this subject on, is it live, is it locked. Every column that identifies a row upstream is a provider id (`providerSubscriptionId`, `providerCustomerId`, `providerScheduleId`), and every write into the table comes from a webhook the vendor sent. Nothing in the project mints a subscription.

That is what makes the second question answer "no". A driver capability holds rows the project would have to carry across a vendor swap, because nobody else has them. Here the vendor has them, and a swap means the new vendor re-collects a payment method and issues a new subscription. The old rows stay as history and the projection refills itself from the new vendor's webhooks.

Reading the first question alone would give `billing` the driver shape, which costs the thing the shape exists for. `billing-console` has to sit beside `billing-stripe` in one project, so a developer runs checkout with no Stripe account and a test runs the same routes with no network. `conflictsWith` would allow only one of the two.

### The row ADR 0033's table gains

| Capability | Shape | Why |
|---|---|---|
| `billing` | providers | The vendor owns the customer and the subscription. The project's table is a projection of that record, and a swap re-subscribes rather than migrates. |

## The dependency runs `auth` → `billing`

`packages/auth` depends on `@repo/billing`. `packages/billing` never imports `@repo/auth`. The direction is forced by the Stripe engine: `@better-auth/stripe` is a Better Auth plugin, so the provider file has to export a plugin factory that `packages/auth/src/auth.ts` registers through its `plugins` [registration table](../../CONTEXT.md). A dependency in the other direction would close the cycle.

The cost of that direction is that a contract method cannot reach the auth instance by importing it. So every method takes a **`HostContext`** — `{ headers: Headers; auth: unknown }` — which the route in `apps/api` supplies, because `apps/api` is the one workspace that imports both packages. `auth` is `unknown` in the contract and cast inside the provider file, which keeps the core vendor-blind and keeps the Better Auth types out of `packages/billing`.

## Consequences

- **The core has zero npm runtime dependencies.** `packages/billing` depends on `@repo/db` and `@repo/queue` at the workspace level and on no npm package. `stripe` and `@better-auth/stripe` arrive through `billing-stripe`'s `package-json-dependency` patch ([ADR 0020](adr-0020-capability-owns-its-vendor-packages-2026-07-24.md)).
- **`BILLING_PROVIDER` selects at runtime**, required even with one provider installed, with no fallback in either direction — the same rule `QUEUE_PROVIDER` and `EMAIL_PROVIDER` carry.
- **A second provider is one file plus patches.** `billing-polar` needs one runtime file, two `plugin-array` patches (`billing.providers`, `auth.plugins`) and one `package-json-dependency` patch. If a provider ever needs a second runtime file, the contract is wrong.
- **The projection can be rebuilt, and losing it is not losing money.** A project that drops the table re-derives it from the vendor by replaying webhooks. That is the practical reading of "projection", and it is why `billing_event` records `(provider, providerEventId)` rather than being pruned.
- **ADR 0033 keeps its rule and gains its first split case.** The two questions disagreed for the first time, the second one decided it, and the table now carries the precedent so the next capability does not re-argue it.

## Considered Options

- **Drivers, because the project owns the schema.** Rejected above: it answers only the first question and it costs `billing-console` beside `billing-stripe`.
- **A thin core with provider-owned storage.** Rejected. The admin page would call a Stripe-shaped client API and a second provider would need a second page.
- **Two tables, the plugin's own mirrored into a core projection by hooks.** Rejected. Every row exists twice and the sync is a bug class with no upside.
- **`billing` imports `@repo/auth` and reads the session itself.** Rejected. It closes a cycle with the plugin registration, and `HostContext` costs one argument.

## References
Issue [#126](https://github.com/mimukit/saasaloy/issues/126), `docs/plans/plan-billing-capability-module-2026-09-08.md`. Applies [ADR 0033](adr-0033-transient-state-capabilities-take-providers-2026-09-08.md). Related: [ADR 0020](adr-0020-capability-owns-its-vendor-packages-2026-07-24.md), [ADR 0026](adr-0026-database-driver-split-2026-08-28.md), [ADR 0028](adr-0028-routes-register-by-chained-route-patch-2026-08-28.md), [ADR 0029](adr-0029-auth-holds-a-request-scoped-db-client-2026-08-31.md). Glossary: `CONTEXT.md` → "Plan", "Subscription", "Billable subject", "Entitlement", "Projection table".
