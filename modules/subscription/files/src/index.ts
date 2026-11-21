import { defineSubscription } from "./define";
import type { SubscriptionEnv } from "./provider";
import { subscriptionProviders } from "./providers.generated";

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

// The provider registration table. Every `subscription-<provider>` module adds a row to
// the `subscription.providers` table, and the CLI writes `./providers.generated.ts` from
// those rows on every run: `saasaloy add subscription-stripe` adds `stripeSubscription()`,
// and `saasaloy remove` takes it back out. A provider of your own goes after the spread,
// never in the generated file: the CLI overwrites it, and `saasaloy update` refuses when
// it was edited.
export const subscription = defineSubscription({
  providers: [...subscriptionProviders],
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
