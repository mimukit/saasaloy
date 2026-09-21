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

/**
 * What a plan costs for one interval, for a provider that is handed a figure rather than a
 * hosted price object.
 *
 * `amount` is in the currency's **minor unit** — 499 BDT is `49_900`, not `499`. Money is
 * never a float here: a gateway that echoes `499.00`, `499.0` and `499` for the same figure
 * has to be compared against an integer, and `0.1 + 0.2` is what the alternative makes of it.
 *
 * A vendor that owns its own price object (Stripe) carries a `providerIds` entry instead and
 * leaves this unset. A plan may carry both: they answer different providers.
 */
export interface PlanPrice {
  /** The figure in the currency's minor unit. */
  amount: number;
  /** ISO 4217, upper case — "BDT", "USD". A provider that accepts one currency checks it. */
  currency: string;
}

/** What a caller passes `definePlans`. See CONTEXT.md → "Plan". */
export interface PlanConfig {
  /** Stable identifier, stored in `billing_subscriptions.plan` and read by entitlements. */
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
  /**
   * What the plan costs per interval, for a provider that is handed a figure instead of a
   * price id — SSLCOMMERZ is the first. Optional, and orthogonal to `providerIds`: a plan
   * carrying only a price is still a paid plan, and `definePlans` counts it as one.
   */
  price?: Partial<Record<PlanInterval, PlanPrice>>;
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
  readonly price: Readonly<Partial<Record<PlanInterval, PlanPrice>>>;
  /**
   * True for the one plan that names no price of any kind — neither a `providerIds` entry
   * nor a `price`. That plan is what an unsubscribed subject resolves to.
   */
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
 * The part of a `billing_subscriptions` row a provider projects from the vendor's record.
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

/**
 * What the core writes to `billing_subscriptions`: the provider's projection plus the one
 * column only the core fills in.
 *
 * `provider` is deliberately *not* on `SubscriptionInput`. A provider that could set it
 * could name another provider on a row and take that row's renewals; `applyEvent` copies it
 * off `BillingEvent.provider` instead, which is already half the `billing_events` key.
 */
export interface SubscriptionWrite extends SubscriptionInput {
  /** Which provider owns this row — the same string as `BillingProvider.name`. */
  provider: string;
}

/** A `billing_subscriptions` row as the core reads it back. See CONTEXT.md → "Subscription". */
export interface Subscription extends SubscriptionInput {
  id: string;
  referenceId: string;
  customerType: string;
  /**
   * Which provider owns this row. Written by `applyEvent` from the event, never by a
   * provider. The renewal job filters on it, so a project that switched providers leaves
   * the old rows to the old provider's rules.
   */
  provider?: string | null;
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
 * `billing_events` first and returns early on a conflict, so a redelivery runs no side
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
  /**
   * The `billing_payment_submissions` row the core opened for this checkout, on a provider
   * that settles manually. Undefined for every vendor-settled provider, and for a trial.
   *
   * The core opens the row, because the queue is core-owned and vendor-blind; the provider
   * only decides where to send the subject to read the instructions and type the reference.
   */
  submissionId?: string;
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
 * What a provider answers a callback with.
 *
 * Three kinds, because a gateway's callbacks are two different things arriving at the same
 * handler: a server-to-server notification, which owes an event and no redirect, and a
 * browser return, which owes a place to send the reader. `ignored` is the honest answer to a
 * payment the gateway has not finished deciding on.
 */
export type CallbackResult =
  /** Enqueue this event. Answered to a notification the provider has verified. */
  | { kind: "event"; event: BillingEvent }
  /** Send the browser here, with a 303. Answered to a return the reader is sitting in front of. */
  | { kind: "redirect"; url: string; event?: BillingEvent }
  /** Nothing happened that the projection should hear about. Answered 204. */
  | { kind: "ignored" };

/**
 * Who decides that money arrived. See CONTEXT.md → "Manual settlement".
 *
 * `"vendor"` is every gateway: it takes the payment, it says so, and the projection follows
 * from a callback or a webhook. `"manual"` is a payment method with no API at all — a
 * personal mobile-money wallet, a bank transfer, cash — where the only witness is a human
 * reading their own statement. The core answers that with a queue, not with an integration.
 */
export type SettlementMode = "vendor" | "manual";

/** What the subject reads before they pay, under manual settlement. */
export interface ManualInstructions {
  /** One line naming the method — "Send Money on bKash". */
  heading: string;
  /** The steps, in order, each a full sentence the subject can follow on a phone. */
  steps: string[];
  /** Where the money goes, verbatim — a wallet number, an account number. */
  destination: string;
  /** Anything the subject has to know that is not a step. Optional. */
  note?: string;
}

/** What `manualInstructions` is told about the payment it is describing. */
export interface ManualInstructionsInput {
  subject: BillableSubject;
  planId: string;
  interval: PlanInterval;
  /** What the subject owes, in the currency's minor unit. The figure quoted at checkout. */
  expectedAmount: number;
  /** ISO 4217, upper case. */
  currency: string;
}

/** How a submission field is rendered. The core never guesses a widget from a label. */
export type SubmissionFieldType = "text" | "tel" | "amount";

/**
 * One value the provider asks the subject for after they pay.
 *
 * `normalize` is both the validator and the normalizer, and it is the provider's, because
 * what a valid transaction reference looks like is the one thing a payment method does not
 * share with any other. It returns the stored form or throws `BillingError("invalid_request")`
 * naming the field.
 */
export interface SubmissionField {
  /** Stable key, stored in `billing_payment_submissions.fields`. */
  id: string;
  /** What the form labels it. */
  label: string;
  type: SubmissionFieldType;
  /** Shown under the input. Optional. */
  help?: string;
  /**
   * True on exactly one field: the transaction reference the duplicate check runs on. The
   * core copies its normalized value into `transaction_ref_normalized`.
   */
  reference?: boolean;
  /**
   * True when the core pre-fills this field from the subject's most recent submission, and
   * flags a change in the admin queue. The sender's own wallet number is the case this
   * exists for.
   */
  remembered?: boolean;
  /** Validate and normalize one submitted value, or throw. */
  normalize(value: string): string;
}

/** Where a payment submission stands. See CONTEXT.md → "Payment submission". */
export type SubmissionStatus =
  /** Opened at checkout, and waiting — for the subject's reference, or for an admin. */
  | "pending"
  /** An admin matched it against their own statement and granted the period. */
  | "approved"
  /** An admin refused it, with a note. Grants nothing, and the reference frees up again. */
  | "rejected"
  /** The subject took it back before anyone reviewed it. */
  | "withdrawn";

/** One `billing_payment_submissions` row, as the core reads it back. */
export interface PaymentSubmission {
  id: string;
  /** Which provider opened it, matching `BillingProvider.name`. */
  provider: string;
  referenceId: string;
  customerType: string;
  /** The plan the subject is buying, matching a `Plan.id`. */
  plan: string;
  billingInterval: PlanInterval;
  /**
   * What the subject was told to pay, in the currency's minor unit, copied from the plan at
   * checkout and never recomputed. See CONTEXT.md → "Payment submission".
   */
  expectedAmount: number;
  currency: string;
  /** The reference as the subject typed it, or null while the shell is still empty. */
  transactionRef?: string | null;
  /** The same value trimmed and upper-cased. Half of the partial unique index. */
  transactionRefNormalized?: string | null;
  /** Every value `submissionFields` asked for, normalized. Empty on a fresh shell. */
  fields: Record<string, string>;
  status: SubmissionStatus;
  /** The reviewing admin's user id. */
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  /** What the admin wrote. On a rejection the subject reads it. */
  reviewNote?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What `approveSubmission` is handed. */
export interface ApproveSubmissionInput {
  /** The row the admin just approved, with its fields and its quoted amount. */
  submission: PaymentSubmission;
  /**
   * The subject's live row, when there is one. Same field and same reason as
   * `SubjectInput.current`: a provider gets no database, and a renewal has to extend the row
   * that is already there rather than invent one.
   */
  current?: Subscription;
}

/** How the subject pays for the next period. See CONTEXT.md → "Manual renewal". */
export type RenewalMode =
  /** The vendor charges a stored instrument on its own schedule. Every card vendor. */
  | "vendor"
  /** Nothing is stored and nothing recurs. The subject pays each period through a fresh checkout. */
  | "manual";

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
   * How the subject pays for the next period. `"vendor"` when unset, which is every
   * card-on-file vendor: it charges the stored instrument and the row never leaves
   * `active`. A provider that stores nothing declares `"manual"`, and the renewal job then
   * marks its rows `past_due` the moment a paid period ends.
   */
  renewal?: RenewalMode;
  /**
   * Who witnesses the payment. `"vendor"` when unset, which is every gateway.
   *
   * A provider that declares `"manual"` must also declare `manualInstructions`,
   * `submissionFields` and `approveSubmission`; `defineBilling` refuses one that does not,
   * at module load, rather than letting a subject reach a pay page with no form on it.
   */
  settlement?: SettlementMode;
  /** What the subject reads before they pay. Manual settlement only. */
  manualInstructions?(
    env: BillingEnv,
    input: ManualInstructionsInput
  ): ManualInstructions;
  /**
   * What the subject types in after they pay. Manual settlement only.
   *
   * Exactly one field carries `reference: true`; that is the value the duplicate check runs
   * on. `defineBilling` checks the count at load.
   */
  submissionFields?(env: BillingEnv): SubmissionField[];
  /**
   * Turn an approved submission into the event that grants the period. Manual settlement
   * only.
   *
   * It writes nothing: the projection has one writer and it is the event path (ADR 0034), so
   * the admin review route enqueues what this returns and touches no subscription row.
   */
  approveSubmission?(
    env: BillingEnv,
    input: ApproveSubmissionInput
  ): BillingEvent;
  /**
   * Handle one callback the vendor sent — an IPN, or a browser return from a hosted page.
   *
   * Optional: a provider whose vendor posts to an endpoint of its own (`billing-stripe`,
   * through its auth plugin) implements none of this, and the callback route answers 404.
   *
   * It is handed the raw `Request`, because a gateway's callback is form-encoded rather
   * than JSON and the core must not guess an encoding. It is handed no database and no
   * `HostContext`: there is no session behind an IPN, and the projection has one writer
   * (ADR 0034), so the provider answers with an event and the route enqueues it.
   *
   * `path` is what follows `/billing/callback/<provider>/` — `"ipn"`, `"return/success"`.
   * Nothing on the request is evidence. A provider verifies every fact it acts on against
   * the vendor, over a connection the caller cannot forge.
   */
  handleCallback?(
    env: BillingEnv,
    request: Request,
    path: string
  ): Promise<CallbackResult>;
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
  /**
   * Somebody else got there first, or the caller is already in the state they asked for.
   * A transaction reference already claimed, a second open payment submission, a submission
   * two admins reviewed at once. Distinct from `invalid_request` because the request was
   * well-formed and would have worked a moment earlier.
   */
  | "conflict"
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
