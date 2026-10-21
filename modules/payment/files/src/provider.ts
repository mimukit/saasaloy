// The provider contract every `payment-<provider>` module implements, the payment row and
// event shapes the capability keeps, and the single error type every failure is
// normalized into. Nothing in this file imports a vendor SDK, a Workers binding, an ORM or
// `@repo/auth`: the core of `packages/payment` is vendor-blind and has zero npm runtime
// dependencies (ADR 0020, ADR 0045).
//
// A provider never writes the database. It answers what to show the payer (`create`),
// checks what the payer typed (`submit`), and reports what its gateway said
// (`handleCallback`). The core owns every status change, the `payment_events` history, the
// refund bounds and the listeners, so one rule set holds whichever provider took the money.

/**
 * The Worker environment, handed to `createPayment(env)` whole. Deliberately opaque:
 * which key a provider reads (a store password, a merchant id, nothing at all) is exactly
 * what a calling route must not have to know. The core never reads `process.env`.
 */
export interface PaymentEnv {
  /**
   * Which registered providers take payments, as a comma list in priority order
   * (`manual,sslcommerz`). Always required; there is no default.
   */
  PAYMENT_PROVIDER?: string;
  /** The one origin a `returnUrl` may name. Unset, only `http://localhost` passes. */
  PAYMENT_APP_URL?: string;
  /** The api's own origin, set by `auth`. Callback URLs are built on it. */
  BETTER_AUTH_URL?: string;
  [key: string]: unknown;
}

/** Every status a payment can hold. There is no `refunded`: see `payment_refunds`. */
export type PaymentStatus =
  /** Created. The payer has not paid, or has not told us yet. */
  | "pending"
  /** The payer submitted a transaction id. Staff confirm or reject it. */
  | "submitted"
  /** The money arrived. Final, except for refunds. */
  | "successful"
  /** Staff rejected the submission, or the gateway declined. Final. */
  | "failed"
  /** The payer gave up at the gateway. Final. */
  | "cancelled";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "pending",
  "submitted",
  "successful",
  "failed",
  "cancelled",
];

/** Why staff rejected a submission. Required on every rejection. */
export type RejectReason =
  "amount_mismatch" | "not_found" | "duplicate" | "other";

export const REJECT_REASONS: readonly RejectReason[] = [
  "amount_mismatch",
  "not_found",
  "duplicate",
  "other",
];

/** Free-form data a provider keeps on its own row. Stored as JSON. */
export type ProviderData = Record<string, unknown>;

/** One `payments` row, as the core and every provider see it. */
export interface Payment {
  id: string;
  /** The provider that took the payment, matching `PaymentProvider.name`. */
  provider: string;
  /** The payment method the payer chose, e.g. `card`, `bkash`, `bank`. */
  method: string;
  status: PaymentStatus;
  /** What the payer owes, in the currency's minor unit. */
  amount: number;
  /** ISO 4217, upper case. */
  currency: string;
  /** What the vendor reported as received, in minor units. Null until settled. */
  settledAmount: number | null;
  /** What the payer said they sent, in minor units. `submit` fills it. */
  claimedAmount: number | null;
  /** The sum of this payment's `payment_refunds` rows, in minor units. */
  refundedAmount: number;
  /** What the payment is for. Opaque to the core; the app authorizes it. */
  referenceType: string;
  referenceId: string;
  /** Who pays, when the app knows. Nullable: a guest checkout has no user. */
  userId: string | null;
  /** The transaction id as the payer typed it or the vendor reported it. */
  transactionId: string | null;
  /** The same id normalized by the provider. The duplicate check runs on it. */
  transactionIdNormalized: string | null;
  /** The account the payer sent from, normalized by the provider. */
  senderAccount: string | null;
  /** Where the browser goes when a hosted checkout finishes. Checked against PAYMENT_APP_URL. */
  returnUrl: string | null;
  /** Whatever the provider asked the core to keep, plus `instructions` for a manual payment. */
  providerData: ProviderData | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One way to pay that a provider offers, and whether it is switched on. */
export interface PaymentMethod {
  /** The value `create({ method })` names, e.g. `card` or `bkash`. */
  id: string;
  /** What a payment page calls it. */
  label: string;
  /** False when the provider knows the method but cannot take it here, e.g. no account set. */
  available: boolean;
}

/** One input a manual payment asks the payer to fill. */
export interface SubmitField {
  /** The `SubmitInput` key the value travels under. */
  id: "transactionId" | "senderAccount" | "amount";
  label: string;
  /** A hint for the input, e.g. `8N7A6D5E4F`. */
  placeholder?: string;
}

/** What a manual payment shows the payer: where to send money, and what to type back. */
export interface PaymentInstructions {
  /** The account the payer sends money to. Also shown to staff in the review queue. */
  account: {
    /** e.g. `bKash personal`, `City Bank`. */
    label: string;
    /** The wallet number or account number. */
    number: string;
    /** The account holder's name, when the method shows one. */
    name?: string;
    /** e.g. `personal`, `merchant`, `agent`. */
    kind?: string;
  };
  /** The fields `submit` expects, in display order. */
  fields: SubmitField[];
  /** One short line of extra guidance, e.g. "Use Send Money, not Cash Out." */
  note?: string;
}

/**
 * What the payer does next. `create` answers one of three kinds:
 *
 * - `instructions`: a manual method. Show the account, then call `submit`.
 * - `redirect`: a hosted checkout. Send the browser to `url`.
 * - `client`: an embedded form. Hand `token` to the vendor's browser SDK.
 */
export type PaymentNext =
  | { kind: "instructions"; instructions: PaymentInstructions }
  | { kind: "redirect"; url: string }
  | { kind: "client"; token: string };

/** What a provider's `create` returns: the next step, plus anything it wants kept on the row. */
export type CreateResult = PaymentNext & { providerData?: ProviderData };

/** What a caller passes `createPayment(env).create`. */
export interface CreateInput {
  method: string;
  /** Minor units: 1050 is 10.50 in a two-decimal currency. A positive integer. */
  amount: number;
  /** ISO 4217. Upper-cased before it is stored. */
  currency: string;
  referenceType: string;
  referenceId: string;
  userId?: string | null;
  /** Where a hosted checkout sends the browser afterwards. Checked against PAYMENT_APP_URL. */
  returnUrl?: string;
}

/** What a provider's `create` receives. The row already exists, with status `pending`. */
export interface ProviderCreateInput {
  payment: Payment;
  /**
   * An absolute URL on this provider's callback surface:
   * `callbackUrl("checkout/abc")` is `https://api.x.com/payment/callback/<name>/checkout/abc`.
   * Built on `BETTER_AUTH_URL`, the api's own origin, and throws `provider_error` when that
   * is unset, so call it only when the provider really needs a callback.
   */
  callbackUrl(path?: string): string;
}

/** What the payer typed after a manual payment. Every key is optional; the provider checks. */
export interface SubmitInput {
  transactionId?: string;
  senderAccount?: string;
  /** What the payer says they sent, in minor units. */
  amount?: number;
}

/** What a provider's `submit` returns: the normalized values the core writes. */
export interface SubmitResult {
  transactionId: string;
  /** Normalized for the duplicate check, e.g. trimmed and upper-cased. Required. */
  transactionIdNormalized: string;
  senderAccount?: string | null;
  claimedAmount?: number | null;
  providerData?: ProviderData;
}

/** What a provider's optional `confirm` may report back. */
export interface ConfirmResult {
  /** What actually arrived. Defaults to the claimed amount, then to the amount. */
  settledAmount?: number;
  providerData?: ProviderData;
}

/** What a caller passes `refund`. */
export interface RefundInput {
  /** Minor units, a positive integer. The core keeps the sum at or below `amount`. */
  amount: number;
  note?: string | null;
  actorUserId?: string | null;
}

/** What a provider's `refund` returns. */
export interface RefundResult {
  /** The vendor's refund id, when it has one. A manual refund has none. */
  providerRefundId?: string | null;
}

/**
 * A gateway's verdict on one payment, reported from `handleCallback`. The core applies it
 * as a conditional update from `pending` (or `submitted`), so a replayed callback changes
 * nothing.
 */
export interface PaymentOutcome {
  paymentId: string;
  status: "successful" | "failed" | "cancelled";
  /** What the vendor reports as received, in minor units. Set it on `successful`. */
  settledAmount?: number;
  transactionId?: string;
  transactionIdNormalized?: string;
  providerData?: ProviderData;
}

/**
 * What `handleCallback` answers. From PR #169, plus `response` for a provider that serves
 * a page of its own (`payment-console`'s checkout).
 *
 * - `event`: a server-to-server notification. Apply `outcome`, answer 204.
 * - `redirect`: a browser return. Apply `outcome` when present, then 303 to `url`.
 * - `response`: serve this response as is, after applying `outcome` when present.
 * - `ignored`: nothing to apply. Answer 204.
 */
export type CallbackResult =
  | { kind: "event"; outcome: PaymentOutcome }
  | { kind: "redirect"; url: string; outcome?: PaymentOutcome }
  | { kind: "response"; response: Response; outcome?: PaymentOutcome }
  | { kind: "ignored" };

/** The read-only view of the payments table a callback gets. Providers never write. */
export interface CallbackContext {
  payment(id: string): Promise<Payment | undefined>;
}

/**
 * What one `payment-<provider>` module implements, in one runtime file. Every method takes
 * the whole `env`.
 */
export interface PaymentProvider {
  /** The value `PAYMENT_PROVIDER` lists to select this provider (e.g. "console"). */
  name: string;
  /** The methods this provider knows, and which of them it can take right now. */
  methods(env: PaymentEnv): PaymentMethod[];
  /** Start a payment. The row exists; answer what the payer does next. */
  create(env: PaymentEnv, input: ProviderCreateInput): Promise<CreateResult>;
  /**
   * Check and normalize what the payer typed after a manual payment. Optional: a provider
   * without it answers every `submit` with `invalid_request`.
   */
  submit?(
    env: PaymentEnv,
    payment: Payment,
    input: SubmitInput
  ): Promise<SubmitResult>;
  /** Called before staff confirm a submission. Throw to refuse it. Optional. */
  confirm?(
    env: PaymentEnv,
    payment: Payment
  ): Promise<ConfirmResult | undefined>;
  /** Called before staff reject a submission. Optional. */
  reject?(env: PaymentEnv, payment: Payment): Promise<void>;
  /** Send money back, or record that staff sent it by hand. */
  refund(
    env: PaymentEnv,
    payment: Payment,
    input: RefundInput
  ): Promise<RefundResult>;
  /**
   * Answer one request to `/payment/callback/<name>/<path>`. Nothing on the request is
   * evidence: verify every fact against the vendor before reporting an outcome. Optional;
   * a provider without it has no callback surface.
   */
  handleCallback?(
    env: PaymentEnv,
    request: Request,
    path: string,
    ctx: CallbackContext
  ): Promise<CallbackResult>;
}

/** What a status-change listener receives. */
export interface PaymentChange {
  payment: Payment;
  from: PaymentStatus | null;
  to: PaymentStatus;
}

/**
 * Called after every status write, in order, awaited. A listener that throws is logged
 * with the payment id and the call still succeeds, so a listener must be idempotent and
 * must not be the only record of anything: the `payments` row is the source of truth.
 */
export type PaymentListener = (
  env: PaymentEnv,
  change: PaymentChange
) => Promise<void> | void;

/**
 * Normalized failure codes. Providers map their vendor codes onto these and keep the raw
 * one in `providerCode`.
 */
export type PaymentErrorCode =
  /** The caller asked for something the input or the state does not allow. */
  | "invalid_request"
  /** No payment under that id. */
  | "not_found"
  /** The payment changed under the caller, e.g. another staff member reviewed it first. */
  | "conflict"
  /** That transaction id is already claimed by a live payment with the same provider. */
  | "duplicate_transaction"
  /** No listed provider takes that method. */
  | "method_unavailable"
  /** The vendor refused the payment or the refund. Never retryable. */
  | "declined"
  /** A callback failed verification. */
  | "callback_invalid"
  | "rate_limited"
  | "provider_error";

export interface PaymentErrorOptions {
  /** Whether running the same work again could plausibly succeed. */
  retryable?: boolean;
  /** The provider's own code, verbatim. */
  providerCode?: string;
  cause?: unknown;
}

/** The one error every `packages/payment` call throws. */
export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(
    code: PaymentErrorCode,
    message: string,
    options: PaymentErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "PaymentError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode;
  }
}
