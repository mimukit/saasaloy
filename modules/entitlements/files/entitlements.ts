import { currentSubscription, defaultPlan, findPlan, plans } from "./index";
import type { BillableSubject, BillingStore, Plan } from "./index";

// What a subject is allowed to do, answered from the project's own two sources: the plan
// table in `plans.ts` and the live row in `billing_subscriptions`. Nothing here calls a
// payment provider, and nothing here needs one installed — a project with `billing` and
// `entitlements` and no provider at all still resolves every subject to the default plan and
// gates features on it. That is the whole reason `entitlements` is its own module.
//
// Everything reaches the database through the same `BillingStore` port the rest of the core
// uses (packages/billing/src/subscription.ts), so this file has zero imports outside the
// package and the rules below are unit-testable against a fake.
//
// Imports come from `./index` rather than from `./plans`, `./define` and `./subscription`
// one at a time. `entitlements.ts` ships from a *different* module than the barrel it reads,
// and one import line is one thing for that module's test shim to stand in for.

/**
 * Where a request keeps the plan it already resolved.
 *
 * The memo is an argument rather than a module-level map, and that is load-bearing on
 * Workers: a module-level cache outlives the request in a warm isolate, so the second
 * request for a *different* subject would read the first one's plan. Passing the cache makes
 * its lifetime the caller's to state, and `requireFeature` states "one request".
 */
export interface EntitlementCache {
  plan?: Promise<Plan>;
}

/** A fresh, empty cache. One per request; `apps/api` keeps it in `c.var`. */
export function createEntitlementCache(): EntitlementCache {
  return {};
}

/**
 * The plan a subject is entitled to right now.
 *
 * The rule, in one place: the subject's latest row counts when its status is `trialing`,
 * `active` or `past_due` **and** `lockedAt` is null (`currentSubscription`); anything else —
 * no row, a canceled row, a row the dunning sweep locked — resolves to the default plan.
 * `past_due` still entitles the paid plan on purpose, because the lockout job is what ends
 * the grace period, not the first failed charge.
 *
 * A row naming a plan that is no longer in `plans.ts` also resolves to the default. That is
 * a deploy that dropped a tier out from under a live subscriber, and every request they make
 * failing with `not_found` is a worse answer than the free plan plus a row an operator can
 * still see.
 *
 * The cache is optional and defaults to a throwaway, so a one-off call is one query and two
 * calls sharing a cache are one query between them.
 */
export function currentPlan(
  db: BillingStore,
  subject: BillableSubject,
  cache: EntitlementCache = createEntitlementCache()
): Promise<Plan> {
  // The *promise* is memoized, not the resolved value, so two `hasFeature` calls that start
  // before either finishes still share the one read rather than racing two.
  cache.plan ??= resolvePlan(db, subject);
  return cache.plan;
}

async function resolvePlan(
  db: BillingStore,
  subject: BillableSubject
): Promise<Plan> {
  const live = await currentSubscription(db, subject);
  if (!live) {
    return defaultPlan(plans);
  }
  try {
    return findPlan(plans, live.plan);
  } catch {
    return defaultPlan(plans);
  }
}

/**
 * Whether the subject's plan carries this boolean feature.
 *
 * A name no plan declares is `false`, not a throw. A feature flag is read from a route and a
 * template, and the safe answer to "is this unknown thing allowed" is no.
 */
export async function hasFeature(
  db: BillingStore,
  subject: BillableSubject,
  name: string,
  cache?: EntitlementCache
): Promise<boolean> {
  const plan = await currentPlan(db, subject, cache);
  return plan.features[name] === true;
}

/**
 * The subject's numeric allowance for this limit.
 *
 * `-1` means unmetered, as `plans.ts` documents. A name no plan declares is `0`: same rule
 * as `hasFeature`, so a typo denies rather than granting an unbounded quota.
 */
export async function limit(
  db: BillingStore,
  subject: BillableSubject,
  name: string,
  cache?: EntitlementCache
): Promise<number> {
  const plan = await currentPlan(db, subject, cache);
  return plan.limits[name] ?? 0;
}

/**
 * Whether the subject is within a numeric limit at `used`. The one place the `-1` convention
 * is spelled out, so no caller has to remember it.
 */
export async function withinLimit(
  db: BillingStore,
  subject: BillableSubject,
  name: string,
  used: number,
  cache?: EntitlementCache
): Promise<boolean> {
  const allowance = await limit(db, subject, name, cache);
  return allowance === -1 || used < allowance;
}

// Re-exported so a caller has one import for the whole surface. It is still a no-op in the
// core; the `kv` cache that will make it do something is a follow-up after #129, and this
// module is where the invalidation would then land.
export { invalidateEntitlements } from "./index";
