// The provider contract every `email-<provider>` module implements, plus the single
// error type providers normalize their failures into. Nothing in this file imports a
// vendor SDK or a Workers binding — the core of `packages/email` is provider-agnostic
// and has zero runtime dependencies (ADR 0001's amendment, ADR 0020).

/**
 * The Worker environment, handed to `createEmail(env)` whole rather than one binding
 * at a time. Deliberately opaque: *which* key a provider reads (an `EMAIL` binding, a
 * `RESEND_API_KEY` secret, nothing at all) is exactly what the calling route must not
 * have to know for providers to stay swappable.
 */
export interface EmailEnv {
  /** Which registered provider sends. Always required — there is no implicit default. */
  EMAIL_PROVIDER?: string;
  /** Default sender address, used for any message that doesn't carry its own `from`. */
  EMAIL_FROM?: string;
  [key: string]: unknown;
}

/** A message as a caller writes it. `from` and `text` are filled in by the core. */
export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  /** Plaintext alternative. Derived from `html` when omitted — see `deriveText`. */
  text?: string;
  /** Overrides `EMAIL_FROM` for this one message. */
  from?: string;
  replyTo?: string;
}

/**
 * What a provider actually receives. The core resolves `from` (from `EMAIL_FROM`),
 * derives `text` (from `html`) and normalizes `to` to an array first, so no provider
 * re-implements any of that.
 */
export interface ResolvedEmailMessage extends EmailMessage {
  to: string[];
  from: string;
  text: string;
}

/** Every provider returns the same thing: the id its service assigned the message. */
export interface EmailResult {
  messageId: string;
}

export interface EmailProvider {
  /** The value `EMAIL_PROVIDER` must hold to select this provider (e.g. "cloudflare"). */
  name: string;
  send(env: EmailEnv, message: ResolvedEmailMessage): Promise<EmailResult>;
}

/** What a template returns: the message minus its recipients. */
export interface EmailContent {
  subject: string;
  html: string;
  text?: string;
}

/**
 * The template contract: `(props) => { subject, html, text? }`. See
 * `src/templates/welcome.ts` for a worked example.
 */
export type EmailTemplate<Props = void> = (props: Props) => EmailContent;

/**
 * Normalized failure codes. Providers map their own vendor codes onto these and keep
 * the raw one in `providerCode`, so a caller can branch on a stable value without
 * learning any provider's error vocabulary.
 */
export type EmailErrorCode =
  | "sender_not_verified"
  | "rate_limited"
  | "too_large"
  | "provider_error";

export interface EmailErrorOptions {
  /** Whether re-sending the same message could plausibly succeed. */
  retryable?: boolean;
  /** The provider's own code, verbatim (e.g. "E_RATE_LIMIT_EXCEEDED"). */
  providerCode?: string;
  cause?: unknown;
}

/**
 * The one error a `send()` throws. The package itself never retries — a retry loop
 * inside a request handler holds the Worker's response open. `retryable` is the hook
 * for a caller (or a future queue consumer) to decide.
 */
export class EmailError extends Error {
  readonly code: EmailErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(code: EmailErrorCode, message: string, options: EmailErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "EmailError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode;
  }
}
