import { defineBilling } from "./define";
import type { BillingEnv } from "./provider";

export { defaultPlan, defineBilling, definePlans, findPlan } from "./define";
export type { BillingClient, BillingConfig, BillingRegistry } from "./define";
export { billingEventJob } from "./jobs/event";
export type { RegisteredJob } from "./jobs/event";
export {
  BILLING_EVENT_JOB,
  handleBillingEvent,
  reviveEvent,
} from "./jobs/event-handler";
export type { BillingEventPayload } from "./jobs/event-handler";
export { plans } from "./plans";
export { BillingError, isLiveStatus, LIVE_STATUSES } from "./provider";
export type {
  BillableSubject,
  BillingEnv,
  BillingErrorCode,
  BillingErrorOptions,
  BillingEvent,
  BillingEventType,
  BillingProvider,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  Plan,
  PlanConfig,
  PlanInterval,
  PortalInput,
  QuantityInput,
  SubjectInput,
  Subscription,
  SubscriptionInput,
  SubscriptionStatus,
} from "./provider";
export { requireBillingStore, setBillingStoreResolver } from "./store";
export { assertSubject, authorizeSubject, resolveSubject } from "./subject";
export type { SubjectAction, SubjectContext, SubjectUser } from "./subject";
export {
  applyEvent,
  currentSubscription,
  invalidateEntitlements,
} from "./subscription";
export type {
  ApplyEventResult,
  BillingEventRecord,
  BillingStore,
  SubscriptionPatch,
} from "./subscription";

// The provider registration table, and the patch point every `billing-<provider>` module
// writes into. `saasaloy add billing-stripe` adds its import and appends `stripeBilling()`
// to `providers`. The patch is idempotent, so a re-run changes nothing, and
// `saasaloy remove` takes the same line back out.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal for each property. The codemod behind the `plugin-array` patch
// kind (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and an
// install fails silently. Never omit the array, even while it's empty.
export const billing = defineBilling({
  providers: [],
});

/**
 * Get a billing client for this request's environment. Mirrors `createQueue(c.env)`: it
 * takes the whole `env`, because which key the active provider reads — a Stripe secret, a
 * webhook signing key, nothing — is precisely what a calling route isn't supposed to know.
 *
 * ```ts
 * const { url } = await createBilling(c.env).createCheckout(
 *   { auth, headers: c.req.raw.headers },
 *   { cancelUrl, interval: "monthly", planId: "pro", subject, successUrl }
 * );
 * ```
 *
 * Throws when `BILLING_PROVIDER` is unset or names a provider that isn't installed.
 */
export function createBilling(env: BillingEnv) {
  return billing.create(env);
}
