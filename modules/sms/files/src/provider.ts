// The provider contract every `sms-<provider>` module implements, plus the single error
// type providers normalize their failures into. Nothing in this file imports a vendor SDK
// or a Workers binding — the core of `packages/sms` is provider-agnostic and has zero
// runtime dependencies (ADR 0001's amendment, ADR 0020).

/**
 * The Worker environment, handed to `createSms(env)` whole rather than one binding at a
 * time. Deliberately opaque: *which* key a provider reads (a `TWILIO_AUTH_TOKEN` secret, a
 * messaging-service sid, nothing at all) is exactly what the calling route must not have
 * to know for providers to stay swappable.
 */
export interface SmsEnv {
  /** Which registered provider sends. Always required — there is no implicit default. */
  SMS_PROVIDER?: string;
  /** Default sender, used for any message that doesn't carry its own `from`. */
  SMS_FROM?: string;
  [key: string]: unknown;
}

/** A message as a caller writes it. `to` is normalized and `from` resolved by the core. */
export interface SmsMessage {
  /** One or more recipients in E.164 form (`+14155550123`). Validated by the core. */
  to: string | string[];
  /** The text that goes out, verbatim. Never truncated — see `src/segments.ts`. */
  body: string;
  /**
   * Overrides `SMS_FROM` for this one message.
   *
   * Deliberately **not validated**, while every entry in `to` is checked against E.164.
   * The asymmetry is real, not an oversight: a recipient is always a phone number, but a
   * sender is legitimately a phone number, a short code (`61011`), an alphanumeric sender
   * id (`ACME`) or a messaging-pool id — and the rule that governs `to` would reject three
   * of the four. Whether this value is acceptable is the provider's question to answer.
   */
  from?: string;
}

/**
 * What a provider actually receives. The core normalizes `to` to an array, validates every
 * recipient, resolves `from` (from `SMS_FROM`) and attaches `estimatedSegments` first, so
 * no provider re-implements any of that.
 */
export interface ResolvedSmsMessage extends SmsMessage {
  to: string[];
  /**
   * Still optional, unlike email's resolved `from`. The requirement is per-provider config
   * rather than a property of the message — Twilio needs a sender *unless* a messaging
   * service is configured, a short-code account has one implicitly — so no core-level rule
   * states it correctly. A provider that needs a sender and doesn't get one raises
   * `invalid_message` itself.
   */
  from?: string;
  /**
   * What this body will cost to send, computed by `countSegments`. An *estimate*, and the
   * name says so: it can't know the sender is toll-free (152/66 septets per part, not
   * 153/67) and it is not what any provider bills from. Reported, never enforced — the
   * core does not truncate and does not refuse a long message.
   */
  estimatedSegments: number;
}

/**
 * Every provider returns the same thing: the id its service assigned the message. It is
 * also the join key a future delivery-receipt webhook will match a status callback on,
 * which is the only room `send()` owes that feature.
 */
export interface SmsResult {
  messageId: string;
}

export interface SmsProvider {
  /** The value `SMS_PROVIDER` must hold to select this provider (e.g. "console"). */
  name: string;
  send(env: SmsEnv, message: ResolvedSmsMessage): Promise<SmsResult>;
}

/** What a template returns: the message minus its recipients. */
export interface SmsContent {
  body: string;
}

/**
 * The template contract: `(props) => { body }`. See
 * `src/templates/verification-code.ts` for a worked example. There is no `render.ts`
 * counterpart to email's — an SMS body is plain text, so there is no markup to escape, no
 * layout to wrap it in, and no plaintext alternative to derive.
 */
export type SmsTemplate<Props = void> = (props: Props) => SmsContent;

/**
 * Normalized failure codes. Providers map their own vendor codes onto these and keep the
 * raw one in `providerCode`, so a caller can branch on a stable value without learning any
 * provider's error vocabulary.
 */
export type SmsErrorCode =
  /** The number is not a number the carrier network will accept. */
  | "invalid_number"
  /** A well-formed number with no route to it — unallocated, landline, wrong region. */
  | "unroutable"
  /** The recipient replied STOP. Never retry; it is a standing instruction, not a blip. */
  | "opted_out"
  /**
   * The *account* is what's wrong, not the message: the sender isn't owned by this
   * account, the balance is empty, the destination country isn't enabled. All three are
   * operator alerts with the same caller response — nobody's request handler branches
   * between them — so they collapse into one code, and `providerCode` keeps the vendor's
   * own so whoever fixes it knows which.
   */
  | "account_error"
  | "rate_limited"
  /** Longer than the provider's own channel limit. Provider-raised: the cap is theirs. */
  | "message_too_long"
  /**
   * The message never reached a provider: `to` was empty, a recipient wasn't E.164, or the
   * body was empty. Raised by the core rather than mapped from a vendor, and never
   * `retryable` — the same call will fail identically until the caller changes it.
   */
  | "invalid_message"
  | "provider_error";

export interface SmsErrorOptions {
  /**
   * Whether re-sending the same message could plausibly succeed. Honored only on
   * `rate_limited` and `provider_error` — see the constructor.
   */
  retryable?: boolean;
  /** The provider's own code, verbatim (e.g. "21610"). */
  providerCode?: string;
  cause?: unknown;
}

/**
 * The only codes that may carry `retryable: true`, and the reason this is enforced in code
 * rather than written down.
 *
 * A retried email is a duplicate in an inbox. A retried SMS is a second buzz on someone's
 * phone, a second charge, and — for the one-time codes this capability mostly carries — a
 * second code that invalidates the first one the person is already typing. Twilio's
 * message-create has no idempotency key, so a caller cannot make the retry safe.
 *
 * That inverts email's rule: there, an ambiguous failure (a timeout, a dropped connection)
 * is retryable because the request may never have left. Here an ambiguous failure may
 * already have been accepted and billed, so it is **not** retryable. `retryable: true` is
 * reserved for failures where the provider positively confirmed it did not accept the
 * message — it rate-limited the request, or it answered with a server error.
 */
const RETRYABLE_CODES: ReadonlySet<SmsErrorCode> = new Set<SmsErrorCode>([
  "rate_limited",
  "provider_error",
]);

/**
 * The one error a `send()` throws — including the validation the core does before a
 * provider is reached, which surfaces as `invalid_message` rather than a bare `Error` so a
 * caller's `catch` only ever has one shape to handle. (Selecting the provider happens
 * earlier still, in `createSms(env)`, and a bad `SMS_PROVIDER` throws a plain `Error`
 * there: it is a deploy-time misconfiguration, not a failed message.)
 *
 * The package itself never retries — a retry loop inside a request handler holds the
 * Worker's response open. `retryable` is the hook for a caller (or a future queue
 * consumer) to decide.
 */
export class SmsError extends Error {
  readonly code: SmsErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(
    code: SmsErrorCode,
    message: string,
    options: SmsErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "SmsError";
    this.code = code;
    // Coerced, not rejected. A provider author who copies a retry-on-timeout pattern from
    // somewhere else gets `retryable: false` and a message that still describes their real
    // failure; throwing here would replace their timeout with a second error about this
    // constructor, at the exact moment the original one mattered. The guarantee callers
    // need is that `retryable` is never wrong, not that a wrong argument is loud.
    this.retryable = (options.retryable ?? false) && RETRYABLE_CODES.has(code);
    this.providerCode = options.providerCode;
  }
}
