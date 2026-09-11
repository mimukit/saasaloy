// The provider contract every `billing-<provider>` module implements, the row and event
// shapes the capability projects a vendor's record into, and the single error type
// providers normalize their failures into. Nothing in this file imports a vendor SDK, a
// Workers binding, `@repo/auth` or an ORM — the core of `packages/billing` is
// provider-agnostic and has zero npm runtime dependencies (ADR 0034, ADR 0020).

/**
 * The Worker environment, handed to `createBilling(env)` whole rather than one key at a
 * time. Deliberately opaque: *which* key a provider reads — a secret, a webhook signing
 * key, nothing at all — is exactly what a calling route must not have to know for
 * providers to stay swappable. The core never reads `process.env`.
 */
export interface BillingEnv {
  /** Which registered provider carries the work. Always required — there is no default. */
  BILLING_PROVIDER?: string;
  /** Days a subscription may stay `past_due` before the lockout job sets `lockedAt`. */
  BILLING_LOCKOUT_DAYS?: string;
  [key: string]: unknown;
}

/**
 * What a contract method gets besides its input, supplied by the route in `apps/api`.
 *
 * The dependency runs `auth` → `billing` and never back (ADR 0034), so `packages/billing`
 * cannot import the auth instance to reach a vendor plugin mounted on it. `apps/api` is
 * the one workspace that imports both packages, so it hands the instance in. `auth` is
 * `unknown` on purpose and is cast inside the provider file, which keeps every Better
 * Auth type out of the core.
 */
export interface HostContext {
  /** The incoming request's headers, forwarded so the provider can resolve the session. */
  headers: Headers;
  /** The project's auth instance. Opaque here; cast by the provider that needs it. */
  auth: unknown;
}

/**
 * Who the bill is addressed to. Opaque by construction: `subject.ts` resolves it, and
 * nothing else in the capability learns whether it is looking at a user or an
 * organization. See CONTEXT.md → "Billable subject".
 */
export interface BillableSubject {
  /** The id of the thing being billed — a user id by default, an organization id with `teams`. */
  referenceId: string;
  /** What kind of thing that id names. `"user"` by default, `"organization"` with `teams`. */
  customerType: string;
}

/** The billing intervals a plan can carry a price for. */
export type PlanInterval = "monthly" | "yearly";

/** What a caller passes `definePlans`. See CONTEXT.md → "Plan". */
export interface PlanConfig {
  /** Stable identifier, stored in `billing_subscription.plan` and read by entitlements. */
  id: string;
  /** What the plan is called on a page. */
  name: string;
  /** Boolean entitlements. `hasFeature(name)` reads this map. */
  features?: Record<string, boolean>;
  /** Numeric entitlements. `limit(name)` reads this map. `-1` means unmetered. */
  limits?: Record<string, number>;
  /** Free-trial length. A provider maps it onto its own trial field. */
  trialDays?: number;
  /**
   * Per-provider price ids, keyed by provider name then interval — e.g.
   * `{ stripe: { monthly: "price_123", yearly: "price_456" } }`. The default plan carries
   * none, which is how `definePlans` finds it.
   */
  providerIds?: Record<string, Partial<Record<PlanInterval, string>>>;
}

/** A registered plan. Same shape as its config, with the maps and the default resolved. */
export interface Plan {
  readonly id: string;
  readonly name: string;
  readonly features: Readonly<Record<string, boolean>>;
  readonly limits: Readonly<Record<string, number>>;
  readonly trialDays?: number;
  readonly providerIds: Readonly<
    Record<string, Partial<Record<PlanInterval, string>>>
  >;
  /** True for the one plan with no `providerIds` — what an unsubscribed subject resolves to. */
  readonly isDefault: boolean;
}

/**
 * Normalized subscription statuses. A provider maps its own vocabulary onto these and
 * keeps the raw value in `metadata`, so an entitlement check branches on a stable set.
 */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "paused";

/**
 * The statuses that still entitle a subject to its paid plan. `past_due` is in the set on
 * purpose: a failed payment keeps the plan until the lockout job sets `lockedAt`, which is
 * the column entitlements check second.
 */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
];

/** Whether this status still counts as a live subscription. */
export function isLiveStatus(status: string): status is SubscriptionStatus {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * The part of a `billing_subscription` row a provider projects from the vendor's record.
 * Everything here comes from the vendor; the core owns `lockedAt` and `reminderSentAt`
 * and never lets a provider write them.
 */
export interface SubscriptionInput {
  /** The plan id this row entitles, matching a `Plan.id` in `plans.ts`. */
  plan: string;
  status: SubscriptionStatus;
  /** The vendor's own id for the subscription. Unique across the table. */
  providerSubscriptionId: string;
  /** The vendor's own id for the customer. */
  providerCustomerId: string;
  /** The vendor's id for a pending plan change, when it schedules one. */
  providerScheduleId?: string | null;
  seats?: number | null;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: Date | null;
  canceledAt?: Date | null;
  endedAt?: Date | null;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  /** Start of the interval currently paid for. */
  periodStart?: Date | null;
  /** End of it — the renewal date, and what the admin page shows beside the status. */
  periodEnd?: Date | null;
  /**
   * Which interval the subject is paying on, in the vendor's own words ("month",
   * "year"). Kept raw rather than mapped onto `PlanInterval`: it is a fact about the
   * vendor's record, and `plan` already carries the entitlement-bearing half.
   */
  billingInterval?: string | null;
  /** The provider's raw status and anything else it wants to keep, verbatim. */
  metadata?: Record<string, unknown> | null;
}

/** A `billing_subscription` row as the core reads it back. See CONTEXT.md → "Subscription". */
export interface Subscription extends SubscriptionInput {
  id: string;
  referenceId: string;
  customerType: string;
  /** Set by the lockout job once a `past_due` row has run past `BILLING_LOCKOUT_DAYS`. */
  lockedAt?: Date | null;
  /** Set when the trial-ending reminder went out, so a redelivery sends no second one. */
  reminderSentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The normalized events every provider maps its own webhook vocabulary onto. A vendor
 * event that maps to none of these is dropped in the provider, never enqueued.
 */
export type BillingEventType =
  | "subscription.changed"
  | "subscription.deleted"
  | "trial.ending"
  | "payment.failed"
  | "payment.succeeded";

/**
 * One normalized event, as the provider's webhook hands it to the `billing.event` job.
 * `(provider, providerEventId)` is the dedupe key: `applyEvent` inserts it into
 * `billing_event` first and returns early on a conflict, so a redelivery runs no side
 * effect twice.
 */
export interface BillingEvent {
  /** The provider that produced it — the same string as `BillingProvider.name`. */
  provider: string;
  /** The vendor's own event id, verbatim. Half of the dedupe key. */
  providerEventId: string;
  type: BillingEventType;
  occurredAt: Date;
  subject: BillableSubject;
  /** The projected row, on every event that carries subscription state. */
  subscription?: SubscriptionInput;
}

/** What `createCheckout` returns. */
export interface CheckoutResult {
  /** Where to send the browser. A local provider returns the success URL directly. */
  url: string;
  /**
   * An event to enqueue before returning. Only a provider with no webhook of its own —
   * `billing-console` — sets it; a real provider leaves it undefined and lets its webhook
   * deliver the state.
   */
  event?: BillingEvent;
}

/** One invoice, as the admin page lists them. */
export interface Invoice {
  id: string;
  /** The vendor's human-facing number, when it issues one. */
  number?: string | null;
  /** The total in the currency's minor unit. */
  amount: number;
  /** ISO 4217, lower case, as every vendor reports it. */
  currency: string;
  status: string;
  createdAt: Date;
  hostedUrl?: string | null;
  pdfUrl?: string | null;
}

export interface CheckoutInput {
  subject: BillableSubject;
  /** The plan to buy, matching a `Plan.id`. */
  planId: string;
  interval: PlanInterval;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalInput {
  subject: BillableSubject;
  returnUrl: string;
}

export interface ChangePlanInput {
  subject: BillableSubject;
  planId: string;
  interval: PlanInterval;
  successUrl: string;
  cancelUrl: string;
  /**
   * The subject's live row, when there is one, as the route already read it. Same field and
   * same reason as `SubjectInput.current` below.
   *
   * A local provider needs it to keep what a plan change does not touch. A trial is the one
   * that shows: Stripe carries `trial_end` across an upgrade, so a provider that minted the
   * new row from the plan alone would restart the trial on every change and diverge from
   * the vendor on the flow a project tests locally.
   */
  current?: Subscription;
}

export interface SubjectInput {
  subject: BillableSubject;
  /**
   * The subject's live row, when there is one, as the route already read it.
   *
   * Supplied because a contract method gets no database — the projection has one writer
   * and it is the event path (ADR 0034) — and `cancel` and `restore` carry no plan of
   * their own. A vendor-backed provider ignores this: its own webhook returns the whole
   * record. A local provider has no webhook, so without it the event it mints would have
   * to guess the plan it is cancelling and would overwrite the row with the guess.
   */
  current?: Subscription;
}

export interface QuantityInput extends SubjectInput {
  seats: number;
}

/**
 * What one `billing-<provider>` module implements, in one runtime file. Every method takes
 * the whole `env`, the route's `HostContext`, and its own input; none of them touches the
 * database, because the projection is written from the webhook path only (ADR 0034).
 */
export interface BillingProvider {
  /** The value `BILLING_PROVIDER` must hold to select this provider (e.g. "stripe"). */
  name: string;
  /** Start a purchase. Returns where to send the browser. */
  createCheckout(
    env: BillingEnv,
    ctx: HostContext,
    input: CheckoutInput
  ): Promise<CheckoutResult>;
  /** Open the vendor's own billing portal. */
  createPortal(
    env: BillingEnv,
    ctx: HostContext,
    input: PortalInput
  ): Promise<{ url: string }>;
  /** Move a live subscription to another plan, possibly through a hosted page. */
  changePlan(
    env: BillingEnv,
    ctx: HostContext,
    input: ChangePlanInput
  ): Promise<CheckoutResult>;
  /** Cancel at period end. The row stays live until the vendor says otherwise. */
  cancel(
    env: BillingEnv,
    ctx: HostContext,
    input: SubjectInput
  ): Promise<CheckoutResult | undefined>;
  /** Undo a pending cancellation. */
  restore(
    env: BillingEnv,
    ctx: HostContext,
    input: SubjectInput
  ): Promise<CheckoutResult | undefined>;
  /** Change the seat count. Seats themselves are a follow-up issue; the method ships now. */
  setQuantity(
    env: BillingEnv,
    ctx: HostContext,
    input: QuantityInput
  ): Promise<void>;
  listInvoices(
    env: BillingEnv,
    ctx: HostContext,
    input: SubjectInput
  ): Promise<Invoice[]>;
  /**
   * The auth plugin this provider needs mounted, when it has one. Opaque here for the same
   * reason `HostContext.auth` is: the core names no Better Auth type. `billing-console`
   * leaves it undefined.
   */
  authPlugin?: unknown;
}

/**
 * Normalized failure codes. Providers map their vendor codes onto these and keep the raw
 * one in `providerCode`, so a caller can branch on a stable value without learning any
 * vendor's error vocabulary.
 */
export type BillingErrorCode =
  /** The caller asked for something the state does not allow — a second live subscription, an unknown plan. */
  | "invalid_request"
  /** No subscription, customer or invoice under that id. */
  | "not_found"
  /** The payment instrument was refused. Never retryable by the core. */
  | "card_declined"
  | "rate_limited"
  /** A webhook failed signature verification, or carried an event body the provider refused. */
  | "webhook_invalid"
  | "provider_error";

export interface BillingErrorOptions {
  /** Whether running the same work again could plausibly succeed. */
  retryable?: boolean;
  /** The provider's own code, verbatim (e.g. "card_declined", "resource_missing"). */
  providerCode?: string;
  cause?: unknown;
}

/**
 * The one error every contract method throws, so a caller's `catch` has one shape to
 * handle. (Selecting the provider happens earlier, in `createBilling(env)`, and a bad
 * `BILLING_PROVIDER` throws a plain `Error` there: it is a deploy-time misconfiguration,
 * not a failed charge.)
 *
 * The package never retries. `retryable` is the hook the `billing.event` consumer reads to
 * decide between another delivery and the dead-letter queue.
 */
export class BillingError extends Error {
  readonly code: BillingErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(
    code: BillingErrorCode,
    message: string,
    options: BillingErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "BillingError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode;
  }
}
