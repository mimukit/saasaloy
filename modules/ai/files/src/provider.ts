// A type import only: `@ai-sdk/provider` is the shared `LanguageModelV4` spec, and a value
// import would make this core load a vendor package at runtime.
import type { LanguageModelV4 } from "@ai-sdk/provider";

/**
 * The Worker environment, handed to `createAi(env)` whole. Opaque on purpose: which key a
 * provider reads is what a calling route must not know, so providers stay swappable.
 */
export interface AiEnv {
  /** Which registered provider serves models. Always required: there is no default. */
  AI_PROVIDER?: string;
  /** The model id for every feature with no id of its own, such as `openai/gpt-6-luna`. */
  AI_MODEL?: string;
  [key: string]: unknown;
}

/** One model vendor or gateway behind the `ai` core. A provider never wraps the model. */
export interface AiProvider {
  /** The value `AI_PROVIDER` holds to select this provider, such as `gateway`. */
  name: string;
  /** The model for one id, in the id form this provider takes. */
  languageModel(env: AiEnv, modelId: string): LanguageModelV4;
  /** Map any thrown value onto `AiError`. Pure: it reads the error and imports nothing. */
  normalizeError(error: unknown): AiError;
}

/**
 * Normalized failure codes. A provider maps its vendor code onto one of these and keeps
 * the raw one in `providerCode`, so a caller branches on a stable value.
 */
export type AiErrorCode =
  /** The key is missing, wrong or revoked. */
  | "auth"
  /** Too many requests in a window. Retry later. */
  | "rate_limited"
  /** The account is out of credit or over its spend limit. */
  | "quota"
  /** The prompt and the reply do not fit the model's context window. */
  | "context_length"
  /** The vendor refused the request shape: a bad parameter or tool schema. */
  | "invalid_request"
  /** The model id or the endpoint does not exist. */
  | "not_found"
  | "timeout"
  /** The vendor or the gateway is down or overloaded. */
  | "unavailable"
  /** A content filter blocked the prompt or the reply. */
  | "content_filtered"
  /** No model id resolves for a feature. Raised by the core. */
  | "not_configured"
  | "unknown";

export interface AiErrorOptions {
  /** Whether the same call could succeed if it runs again. */
  retryable?: boolean;
  /** The vendor's own code, verbatim, such as `insufficient_quota`. */
  providerCode?: string;
  /** The HTTP status the vendor answered with, when there was one. */
  status?: number;
  cause?: unknown;
}

/** The one error shape a caller of `@repo/ai` catches. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;
  readonly status?: number;

  constructor(
    code: AiErrorCode,
    message: string,
    options: AiErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "AiError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode;
    this.status = options.status;
  }
}
