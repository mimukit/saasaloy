import { findPlan } from "../define";
import { plans } from "../plans";
import { BillingError } from "../provider";
import type {
  BillingEnv,
  BillingEvent,
  BillingProvider,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  PortalInput,
  QuantityInput,
  SubjectInput,
  Subscription,
  SubscriptionInput,
  SubscriptionStatus,
} from "../provider";

// The local provider: checkout completes in-process, with no vendor account, no secret and
// no network. It is what makes `pnpm dev` and `pnpm test` exercise the whole billing path
// on a machine that has never seen a Stripe key (AGENTS.md, "Ship a local provider").
//
// Set `BILLING_PROVIDER=console` to select it. It registers in the `providers` array in
// packages/billing/src/index.ts exactly like `stripe` does, so the routes, the subject
// resolution, the error normalization and the `billing.event` consumer under test are all
// the real ones. Only the vendor is missing.
//
// It writes no row. Nothing in this file touches the database, because the projection has
// exactly one writer — the event path (ADR 0034) — and a local provider that wrote rows
// directly would be testing a code path the Stripe path never takes. Instead every method
// that changes state returns a `CheckoutResult.event`, and `apps/api/src/routes/billing.ts`
// enqueues it. Under `queue-memory` the consumer runs inline, so the row is there by the
// time the route answers; under a real queue it lands a moment later, exactly as a vendor's
// webhook would.
//
// Reading the current state is the one thing it cannot do from here, and `cancel` and
// `restore` carry no plan of their own, so the route hands the live row in as
// `SubjectInput.current`. A vendor-backed provider ignores that field; this one would
// otherwise have to invent the plan it is cancelling and write the invention over the real
// row. The ids are derived from the subject rather than random, so the second call converges
// on the row the first one created instead of stacking a history row.

/** The value `BILLING_PROVIDER` must hold for this provider to be selected. */
const PROVIDER_NAME = "console";

/**
 * Everything this provider mints carries this prefix, so a `console_`-prefixed id in a
 * `billing_subscription` row is a loud signal that a deployment is running the local
 * provider — a mistake worth being able to spot in a query.
 */
const PREFIX = "console_";

/**
 * The subscription id for a subject.
 *
 * Derived rather than random on purpose. `provider_subscription_id` is the unique key the
 * projection converges on, so a second checkout by the same subject updates the row the
 * first one created instead of stacking a history row the local flow would then have to
 * reconcile. Randomness lives in the event ids below, where it belongs.
 */
function subscriptionId(referenceId: string, customerType: string): string {
  return `${PREFIX}sub_${customerType}_${referenceId}`;
}

function customerId(referenceId: string, customerType: string): string {
  return `${PREFIX}cus_${customerType}_${referenceId}`;
}

/** A fresh event id every time, so no two deliveries dedupe against each other. */
function eventId(): string {
  return `${PREFIX}evt_${crypto.randomUUID()}`;
}

/**
 * Build the normalized event a state change produces. The provider name here is the same
 * string `BILLING_PROVIDER` selects on, which is also half the dedupe key.
 */
function event(
  type: BillingEvent["type"],
  input: CheckoutInput | ChangePlanInput | SubjectInput | QuantityInput,
  subscription: SubscriptionInput
): BillingEvent {
  return {
    occurredAt: new Date(),
    provider: PROVIDER_NAME,
    providerEventId: eventId(),
    subject: input.subject,
    subscription,
    type,
  };
}

/**
 * The row a purchase produces. A plan carrying `trialDays` starts `trialing` with the trial
 * window filled in, which is what lets a project exercise the Phase 5 trial reminder with
 * no vendor; anything else starts `active`.
 *
 * A plan change keeps the trial it is already in rather than starting a new one. Stripe
 * carries `trial_end` across an upgrade, and a local provider that reset the clock would
 * hand a project a free month on every plan change and disagree with the vendor on the one
 * flow it can test offline. The window is only carried while it is still running: a change
 * made after the trial ended lands on the plan's own status.
 */
function subscribed(
  input: CheckoutInput | ChangePlanInput,
  now: Date,
  current?: Subscription
): SubscriptionInput {
  // Throws `not_found` naming the registered ids rather than writing a row for a plan the
  // project does not have. The route checks this too; a provider that trusted its caller
  // would be the one place the check is missing when a job enqueues a checkout later.
  const plan = findPlan(plans, input.planId);
  const trialDays = plan.trialDays;

  // A trial already running on the subject's row, if the caller carried one and it has not
  // expired. `cancel`/`restore` reach this through `carried()` instead; only a plan change
  // mints a fresh row over a live one.
  const running = current?.trialEnd && current.trialEnd > now ? current : null;

  let status: SubscriptionStatus = "active";
  let trialStart: Date | null = null;
  let trialEnd: Date | null = null;

  if (running) {
    status = "trialing";
    trialStart = running.trialStart ?? now;
    trialEnd = running.trialEnd;
  } else if (trialDays) {
    status = "trialing";
    trialStart = now;
    trialEnd = addDays(now, trialDays);
  }

  return {
    billingInterval: input.interval === "yearly" ? "year" : "month",
    cancelAtPeriodEnd: false,
    metadata: { console: true, interval: input.interval, rawStatus: status },
    periodEnd: addDays(now, input.interval === "yearly" ? 365 : 30),
    periodStart: now,
    plan: plan.id,
    providerCustomerId: customerId(
      input.subject.referenceId,
      input.subject.customerType
    ),
    providerSubscriptionId: subscriptionId(
      input.subject.referenceId,
      input.subject.customerType
    ),
    seats: 1,
    status,
    trialEnd,
    trialStart,
  };
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * The local provider. Register it with `saasaloy add billing-console`, which appends
 * `consoleBilling()` to the `providers` array in `packages/billing/src/index.ts`.
 *
 * It carries no `authPlugin`: there is no vendor to mount an endpoint for, which is also
 * why this module patches one array and `billing-stripe` patches two.
 */
export function consoleBilling(): BillingProvider {
  return {
    cancel(
      _env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      const carriedRow = carried(input);
      return Promise.resolve({
        event: event("subscription.changed", input, {
          ...carriedRow,
          cancelAt: carriedRow.periodEnd ?? addDays(new Date(), 30),
          cancelAtPeriodEnd: true,
        }),
        url: "",
      });
    },

    changePlan(
      _env: BillingEnv,
      _ctx: HostContext,
      input: ChangePlanInput
    ): Promise<CheckoutResult> {
      const now = new Date();
      return Promise.resolve({
        event: event(
          "subscription.changed",
          input,
          subscribed(input, now, input.current)
        ),
        url: input.successUrl,
      });
    },

    // No hosted page and no redirect to fake. The row is minted here and delivered through
    // the event, so a caller that follows `url` lands on its own success page with the
    // subscription already applied — the same sequence a returning Stripe customer sees.
    createCheckout(
      _env: BillingEnv,
      _ctx: HostContext,
      input: CheckoutInput
    ): Promise<CheckoutResult> {
      const now = new Date();
      return Promise.resolve({
        event: event("subscription.changed", input, subscribed(input, now)),
        url: input.successUrl,
      });
    },

    // There is no portal to open, so the caller goes straight back where it came from.
    // Answering with a fabricated url would send a browser somewhere that does not exist.
    createPortal(
      _env: BillingEnv,
      _ctx: HostContext,
      input: PortalInput
    ): Promise<{ url: string }> {
      return Promise.resolve({ url: input.returnUrl });
    },

    // Invoices live at the vendor, and this provider has none. An empty list rather than a
    // throw: the admin page's invoice section renders empty, which is the honest answer.
    listInvoices(): Promise<Invoice[]> {
      return Promise.resolve([]);
    },

    name: PROVIDER_NAME,

    restore(
      _env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      return Promise.resolve({
        event: event("subscription.changed", input, {
          ...carried(input),
          cancelAt: null,
          cancelAtPeriodEnd: false,
        }),
        url: "",
      });
    },

    setQuantity(
      _env: BillingEnv,
      _ctx: HostContext,
      input: QuantityInput
    ): Promise<void> {
      if (input.seats < 1) {
        throw new BillingError(
          "invalid_request",
          `A subscription needs at least one seat; got ${input.seats}.`,
          { providerCode: "invalid_seats" }
        );
      }
      // Seats are a follow-up issue and nothing reads the column yet, so the method
      // validates and returns rather than minting an event whose plan it cannot know.
      return Promise.resolve();
    },
  };
}

/**
 * The row a `cancel` or a `restore` starts from — the live one the route read, minus the
 * columns the core owns.
 *
 * The contract hands a provider no database, and this provider has no webhook to learn the
 * record from, so the route supplies `SubjectInput.current`. Without it the event would
 * have to invent a plan and `upsertSubscription` would write the invention over the real
 * one. A vendor-backed provider ignores the field: its webhook carries the whole record.
 */
function carried(input: SubjectInput): SubscriptionInput {
  const current = input.current;
  if (!current) {
    throw new BillingError(
      "not_found",
      `No live subscription for ${input.subject.customerType} ${input.subject.referenceId}. Start one through POST /billing/checkout first.`,
      { providerCode: "no_subscription" }
    );
  }

  // `lockedAt`, `reminderSentAt` and the row's own id and timestamps are core-owned and
  // must not travel back through an event. Destructuring them out here is what keeps a
  // provider from writing a column it is not allowed to write.
  const {
    createdAt: _createdAt,
    customerType: _customerType,
    id: _id,
    lockedAt: _lockedAt,
    referenceId: _referenceId,
    reminderSentAt: _reminderSentAt,
    updatedAt: _updatedAt,
    ...projected
  } = current;

  return projected;
}
