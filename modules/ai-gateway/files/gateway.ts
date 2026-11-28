import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { AiError } from "../provider";
import type { AiEnv, AiErrorCode, AiProvider } from "../provider";

/**
 * Models from any gateway that speaks the OpenAI chat completions API: Cloudflare AI
 * Gateway, OpenRouter or Vercel AI Gateway. The model id takes the gateway's own
 * `vendor/model` form. Reads `AI_GATEWAY_URL`, `AI_GATEWAY_API_KEY` and `AI_GATEWAY_HEADERS`.
 */
export function gateway(): AiProvider {
  return {
    languageModel(env: AiEnv, modelId: string): LanguageModelV4 {
      const baseURL = setting(env, "AI_GATEWAY_URL");
      const apiKey = setting(env, "AI_GATEWAY_API_KEY");
      // The model is returned as built: a wrapper that catches its errors would stop the
      // AI SDK's retries, so failures are mapped at the edge by `normalizeError`.
      return createOpenAICompatible({
        apiKey,
        baseURL,
        headers: parseHeaders(env.AI_GATEWAY_HEADERS),
        includeUsage: true,
        name: "gateway",
      }).chatModel(modelId);
    },
    name: "gateway",
    normalizeError,
  };
}

function setting(env: AiEnv, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new AiError(
      "not_configured",
      `${key} is not set. AI_PROVIDER=gateway needs AI_GATEWAY_URL and AI_GATEWAY_API_KEY.`
    );
  }
  return value.trim();
}

/** `AI_GATEWAY_HEADERS` is a JSON object of string names and values, or blank. */
export function parseHeaders(raw: unknown): Record<string, string> {
  if (
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "")
  ) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    parsed = undefined;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((value) => typeof value === "string")
  ) {
    throw new AiError(
      "not_configured",
      'AI_GATEWAY_HEADERS must be a JSON object of strings, such as {"cf-aig-gateway-id":"main"}.'
    );
  }
  return parsed as Record<string, string>;
}

type Fields = Record<string, unknown>;

function marked(error: unknown, name: string): error is Fields {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as Record<symbol, unknown>)[
      Symbol.for(`vercel.ai.error.${name}`)
    ] === true
  );
}

function record(value: unknown): Fields | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}

/** The `{ code, type, message }` an OpenAI-style body carries, from any of its shapes. */
function vendorDetails(...sources: unknown[]): Fields | undefined {
  for (const source of sources) {
    let value = source;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    const outer = value instanceof Error ? undefined : record(value);
    if (!outer) {
      continue;
    }
    const errors = Array.isArray(outer.errors)
      ? record(outer.errors[0])
      : undefined;
    const details = record(outer.error) ?? errors ?? outer;
    if (
      details.code !== undefined ||
      details.type !== undefined ||
      details.message !== undefined
    ) {
      return details;
    }
  }
  return undefined;
}

const VENDOR_CODES: [RegExp, AiErrorCode, boolean][] = [
  [/insufficient_quota|insufficient_credits|billing/, "quota", false],
  [/rate_limit/, "rate_limited", true],
  [
    /context_length|context_window|max_tokens_exceeded|string_above_max_length/,
    "context_length",
    false,
  ],
  [/invalid_api_key|authentication|unauthorized/, "auth", false],
  [/content_filter|content_policy|moderation/, "content_filtered", false],
  [/model_not_found/, "not_found", false],
];

function byStatus(status: number): [AiErrorCode, boolean] {
  if (status === 401 || status === 403) {
    return ["auth", false];
  }
  if (status === 402) {
    return ["quota", false];
  }
  if (status === 404) {
    return ["not_found", false];
  }
  if (status === 408 || status === 504) {
    return ["timeout", true];
  }
  if (status === 429) {
    return ["rate_limited", true];
  }
  if (status >= 500 || status === 409) {
    return ["unavailable", true];
  }
  if (status >= 400) {
    return ["invalid_request", false];
  }
  return ["unknown", false];
}

/**
 * Map a gateway failure onto `AiError`. It reads the AI SDK's `APICallError` and
 * `StreamProviderError` through their global symbols, unwraps a `RetryError` to its last
 * error, and also takes a raw mid-stream `{ error: { code } }` body. Imports nothing.
 */
export function normalizeError(error: unknown): AiError {
  const cause =
    marked(error, "AI_RetryError") && error.lastError !== undefined
      ? error.lastError
      : error;
  const fields = record(cause) ?? {};
  const isSdk =
    marked(cause, "AI_APICallError") || marked(cause, "AI_StreamProviderError");
  const details = vendorDetails(
    fields.data,
    fields.responseBody,
    isSdk ? undefined : cause
  );
  const status =
    typeof fields.statusCode === "number"
      ? fields.statusCode
      : typeof details?.code === "number" &&
          details.code >= 400 &&
          details.code <= 599
        ? details.code
        : undefined;
  const rawCode = details?.code ?? fields.code ?? details?.type ?? fields.type;
  const providerCode =
    typeof rawCode === "string" || typeof rawCode === "number"
      ? String(rawCode)
      : status === undefined
        ? undefined
        : String(status);
  const message =
    typeof details?.message === "string"
      ? details.message
      : String(fields.message ?? "");
  const vendorText = [details?.code, details?.type, fields.code, fields.type]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  let mapped: [AiErrorCode, boolean] | undefined;
  for (const [pattern, code, retryable] of VENDOR_CODES) {
    if (pattern.test(vendorText)) {
      mapped = [code, retryable];
      break;
    }
  }
  if (!mapped && status !== undefined) {
    mapped = byStatus(status);
  }
  if (
    !mapped &&
    (fields.name === "TimeoutError" || /timed? ?out/i.test(message))
  ) {
    mapped = ["timeout", true];
  }
  // An SDK error with no status is a request that never got an answer, such as a refused
  // connection: the gateway is unreachable.
  if (!mapped && isSdk && fields.isRetryable === true) {
    mapped = ["unavailable", true];
  }
  if (!mapped && !isSdk && details === undefined) {
    return new AiError("unknown", "gateway: the model call failed", {
      cause: error,
    });
  }
  const [code, retryable] = mapped ?? ["unknown", fields.isRetryable === true];
  return new AiError(code, `gateway: ${message || code}`, {
    cause: error,
    providerCode,
    retryable,
    status,
  });
}
