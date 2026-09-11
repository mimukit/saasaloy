---
name: saasaloy-entitlements
description: Runbook for the entitlements feature — resolving what a subject's plan allows from plans.ts and the billing_subscriptions projection, gating a route with requireFeature or requireWithinLimit, and reading the 402 it returns. Use when adding a feature flag or a numeric limit to a plan, gating an API route behind a plan, or working out why a subject resolves to the free plan.
---

# entitlements — what a plan allows, answered from your own tables

`entitlements` adds one file to the billing capability, `packages/billing/src/entitlements.ts`, and one middleware to the api, `apps/api/src/middleware/require-feature.ts`. It answers three questions about a billable subject: which plan, which boolean features, which numeric limits.

It calls no payment provider and needs none installed. A project with `billing` and `entitlements` and no `billing-stripe` still resolves every subject to the default plan and gates features on it. That is why this is a module of its own rather than part of `billing`.

## Where the answers come from

Two sources, both yours:

- `packages/billing/src/plans.ts` — the plan table, in code. `features` are booleans, `limits` are numbers, `-1` means unmetered. Exactly one plan carries no `providerIds`, and that one is the default.
- `billing_subscriptions` — the projection, written only from the event path.

## The resolution rule

The subject's **latest** row counts when its status is `trialing`, `active` or `past_due` **and** `lockedAt` is null. Anything else resolves to the default plan:

| State | Resolves to |
|---|---|
| No row at all | default plan |
| `trialing`, `active`, `past_due`, unlocked | that row's plan |
| `past_due` with `lockedAt` set by the dunning sweep | default plan |
| `canceled`, `unpaid`, `incomplete`, `paused` | default plan |
| A row naming a plan `plans.ts` no longer has | default plan |

`past_due` keeps the paid plan on purpose. The daily lockout job is what ends the grace period, not the first failed charge — see the `saasaloy-billing` skill.

The last row is worth knowing about: dropping a tier out of `plans.ts` while someone is still subscribed to it puts them on the free plan rather than failing every request they make. The row is still in the table for an operator to see.

## Read an entitlement

```ts
import { currentPlan, hasFeature, limit, withinLimit } from "@repo/billing/entitlements";

const plan = await currentPlan(store, subject);
const canExport = await hasFeature(store, subject, "export");
const seats = await limit(store, subject, "seats"); // -1 means unmetered
const roomForOneMore = await withinLimit(store, subject, "seats", filled);
```

`store` is the `BillingStore` port — `createBillingStore(db)` inside `withDb`, exactly as a billing route builds it. `subject` comes from `resolveSubject(c)`.

An unknown feature name is `false` and an unknown limit is `0`. A typo denies rather than granting an unbounded quota.

## Gate a route

```ts
import { requireFeature, requireWithinLimit } from "../middleware/require-feature";
import type { EntitlementVariables } from "../middleware/require-feature";

export const exportRoute = new Hono<{
  Bindings: AuthDbBindings;
  Variables: EntitlementVariables;
}>()
  .post("/export", requireFeature("export"), (c) => c.json({ ok: true }))
  .post("/projects", requireWithinLimit("projects", countProjects), create);
```

Both refuse with **402 Payment Required** and name what was short:

```json
{ "error": { "code": "feature_required", "feature": "export", "message": "…" } }
{ "error": { "code": "limit_reached", "limit": "projects", "message": "…" } }
```

402 rather than 403 because it is the one status a plan picker can act on without a second round trip. An anonymous caller gets 401 instead: they have no plan to be short of.

## The per-request memo

The resolved plan is cached in `c.var.entitlements` for the life of the request, so two gates on one route do one read between them. The cache is an argument rather than a module-level map, and that is mandatory rather than tidy: a Workers isolate is reused across requests, so a module-level cache would answer the next subject with this one's plan.

Pass the same cache when you call the functions directly:

```ts
const cache = withEntitlementCache(c);
await hasFeature(store, subject, "export", cache);
await limit(store, subject, "seats", cache);   // no second query
```

Omit it and each call is its own read, which is the right default for a one-off check.

## Caching beyond the request

There is none yet. `invalidateEntitlements(subject)` is a no-op the event consumer already calls, and it is the single function a `kv` cache would fill in — that is a follow-up issue, after the `kv` capability lands. Do not add a cache with a lifetime longer than a request until then.

## Adding a feature or a limit

Edit `plans.ts` and nothing else. There is no table to seed, no migration, and no admin editor — that was settled against on purpose. A new feature flag needs a `features` entry on every plan that grants it; anything unset reads as denied.

Remember that the landing page's `pricing-table` block keeps its own copy in `content/landing.ts`. Nothing patches one from the other.
