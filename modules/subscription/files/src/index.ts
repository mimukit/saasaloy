import { defineSubscription } from "./define";
import type { SubscriptionEnv } from "./provider";

export {
  subscriptionConfig,
  DEFAULT_LOCKOUT_DAYS,
  readLockoutDays,
  setSubscriptionConfig,
} from "./config";
export type { SubscriptionConfigValues } from "./config";
export {
  defaultPlan,
  defineSubscription,
  definePlans,
  findPlan,
} from "./define";
export type {
  SubscriptionClient,
  SubscriptionConfig,
  SubscriptionRegistry,
} from "./define";
export { enqueueSubscriptionEvent, setSubscriptionEnqueuer } from "./enqueue";
export type { SubscriptionEnqueuer } from "./enqueue";
export { subscriptionEventJob } from "./jobs/event";
export type { RegisteredJob } from "./jobs/event";
export {
  SUBSCRIPTION_EVENT_JOB,
  handleSubscriptionEvent,
  reviveEvent,
} from "./jobs/event-handler";
export type { SubscriptionEventPayload } from "./jobs/event-handler";
export {
  SUBSCRIPTION_PAST_DUE_LOCKOUT_CRON,
  SUBSCRIPTION_PAST_DUE_LOCKOUT_JOB,
  SUBSCRIPTION_PAST_DUE_LOCKOUT_SCHEDULE,
  pastDueLockoutJob,
  pastDueLockoutSchedule,
  runPastDueLockout,
} from "./jobs/past-due-lockout";
export type {
  LockoutResult,
  RegisteredSchedule,
} from "./jobs/past-due-lockout";
export { notifySubscription, setSubscriptionNotifier } from "./notify";
export type {
  SubscriptionNotification,
  SubscriptionNotificationKind,
  SubscriptionNotifier,
  SubscriptionRecipient,
} from "./notify";
export { plans } from "./plans";
export { SubscriptionError, isLiveStatus, LIVE_STATUSES } from "./provider";
export type {
  BillableSubject,
  SubscriptionEnv,
  SubscriptionErrorCode,
  SubscriptionErrorOptions,
  SubscriptionEvent,
  SubscriptionEventType,
  SubscriptionProvider,
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
export {
  inSubscriptionStore,
  requireSubscriptionStore,
  setSubscriptionStoreResolver,
  setSubscriptionStoreRunner,
} from "./store";
export type { SubscriptionStoreRunner } from "./store";
export { assertSubject, authorizeSubject, resolveSubject } from "./subject";
export type { SubjectAction, SubjectContext, SubjectUser } from "./subject";
export {
  applyEvent,
  currentSubscription,
  invalidateEntitlements,
} from "./subscription";
export type {
  ApplyEventResult,
  SubscriptionEventRecord,
  SubscriptionStore,
  SubscriptionPatch,
} from "./subscription";

// The provider registration table, and the patch point every `subscription-<provider>` module
// writes into. `saasaloy add subscription-stripe` adds its import and appends `stripeSubscription()`
// to `providers`. The patch is idempotent, so a re-run changes nothing, and
// `saasaloy remove` takes the same line back out.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal for each property. The codemod behind the `plugin-array` patch
// kind (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and an
// install fails silently. Never omit the array, even while it's empty.
export const subscription = defineSubscription({
  providers: [],
});

/**
 * Get a subscription client for this request's environment. Mirrors `createQueue(c.env)`: it
 * takes the whole `env`, because which key the active provider reads — a Stripe secret, a
 * webhook signing key, nothing — is precisely what a calling route isn't supposed to know.
 *
 * ```ts
 * const { url } = await createSubscription(c.env).createCheckout(
 *   { auth, headers: c.req.raw.headers },
 *   { cancelUrl, interval: "monthly", planId: "pro", subject, successUrl }
 * );
 * ```
 *
 * Throws when `SUBSCRIPTION_PROVIDER` is unset or names a provider that isn't installed.
 */
export function createSubscription(env: SubscriptionEnv) {
  return subscription.create(env);
}
