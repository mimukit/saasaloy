import { EmailError } from "../provider";
import type {
  EmailEnv,
  EmailErrorCode,
  EmailProvider,
  EmailResult,
  ResolvedEmailMessage,
} from "../provider";

// Plunk, reached over plain HTTP: `POST /v1/send` with the project's **secret** key as a
// bearer token. No SDK and no Workers binding, so this provider adds no npm dependency and
// packages/email stays at zero runtime dependencies (ADR 0020). The same code path runs in
// `wrangler dev` and in production — unlike email-cloudflare, nothing here needs a paid plan
// or a domain onboarded through the Cloudflare dashboard.
//
// Two env vars, both read off the `env` the core hands in (`process.env` does not exist on
// Workers): `PLUNK_API_KEY` (required, the `sk_` key) and `PLUNK_API_URL` (optional, for a
// self-hosted Plunk instance).
//
// Three things about Plunk that this file cannot hide from you:
//
// 1. **Every send upserts the recipient as a contact** in your Plunk project. That is Plunk's
//    behaviour, not a choice made here. The payload deliberately omits `subscribed`: a new
//    contact lands unsubscribed either way, and sending an explicit `subscribed: false` would
//    flip an already-subscribed contact and emit an unsubscribe event. Omission is the only
//    non-destructive option.
// 2. **Plunk has no plaintext field.** `/v1/send` takes one `body`, so the `text` the core
//    derived from the HTML is dropped. Messages go out HTML-only through this provider.
// 3. **A retry can double-send.** Plunk's send endpoint takes no idempotency key, so a caller
//    that retries a `retryable` failure may deliver the message twice — the request can fail
//    after Plunk accepted it. Retrying is the caller's decision (the package never retries);
//    email idempotency is tracked separately.

const DEFAULT_API_URL = "https://next-api.useplunk.com";

/**
 * Plunk answers a rejection with an HTTP status and a JSON body carrying its own `code`
 * string. Status decides first, because it is the one field always present; a code listed
 * here then refines the mapping. Anything unlisted falls through to `provider_error` with the
 * status's own retryability, and an unrecognized status is `provider_error` / `retryable:
 * false` — guessing that an unknown failure is safe to retry is the more expensive mistake,
 * since it means duplicate mail. Add a row when you meet a new code in the wild.
 *
 * | Status | Meaning |
 * |---|---|
 * | 401 | `PLUNK_API_KEY` is wrong, or holds the `pk_` public key instead of `sk_` |
 * | 403 | the key is valid but the project may not send |
 * | 404 | wrong `PLUNK_API_URL`, or a project that no longer exists |
 * | 413, 422 + size code | the message is too big |
 * | 422 | Plunk rejected the payload (bad address, empty body, unverified sender) |
 * | 429 | rate limited |
 * | 5xx | Plunk's failure, not the message's |
 */
const ERROR_CODES: Record<
  string,
  { code: EmailErrorCode; retryable: boolean }
> = {
  // Populated as real codes are observed; empty until one is. The unverified-sender rejection
  // is the first one to add here: it arrives as a 422 today, which is honest but coarse.
};

interface PlunkPayload {
  to: string[];
  subject: string;
  body: string;
  from: string;
  reply?: string;
}

export function plunk(): EmailProvider {
  return {
    name: "plunk",

    async send(
      env: EmailEnv,
      message: ResolvedEmailMessage
    ): Promise<EmailResult> {
      const apiKey =
        typeof env.PLUNK_API_KEY === "string" ? env.PLUNK_API_KEY : "";
      if (!apiKey) {
        throw new EmailError(
          "provider_error",
          "No `PLUNK_API_KEY` on this Worker's env. Set it in apps/api/.dev.vars for local " +
            "development and with `wrangler secret put PLUNK_API_KEY` for a deployed Worker. " +
            "It must be the project's secret key (`sk_...`), not the public key (`pk_...`)."
        );
      }

      const baseUrl =
        typeof env.PLUNK_API_URL === "string" && env.PLUNK_API_URL
          ? env.PLUNK_API_URL
          : DEFAULT_API_URL;

      const payload: PlunkPayload = {
        to: message.to,
        subject: message.subject,
        body: message.html,
        from: message.from,
        // `text` has no home in Plunk's payload — see the note at the top of this file.
        ...(message.replyTo ? { reply: message.replyTo } : {}),
      };

      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/send`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          // Bound the call. Without this a hung provider holds the Worker's response open
          // until the platform kills it, and the caller gets no `EmailError` at all.
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        // The request never completed — a timeout, DNS, TLS, a dropped connection. Retryable
        // either way; the abort is worth naming so logs can tell the two apart.
        const timedOut =
          error instanceof DOMException && error.name === "TimeoutError";
        throw new EmailError(
          "provider_error",
          timedOut ? "plunk: request timed out" : "plunk: request failed",
          { cause: error, retryable: true }
        );
      }

      const body = await readJson(response);

      if (!response.ok) {
        throw normalize(response.status, body);
      }

      const messageId = readMessageId(body);
      if (!messageId) {
        // A 2xx we can't read. The mail may well have gone out, so don't claim an id that
        // isn't there — `EmailResult.messageId` is a string, and returning `undefined` would
        // break that contract silently.
        throw new EmailError(
          "provider_error",
          "plunk: send succeeded but the response carried no message id"
        );
      }

      return { messageId };
    },
  };
}

/** Parses the response body, tolerating a non-JSON one (an HTML error page, an empty 502). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * A multi-recipient send gets one id per recipient and `EmailResult` carries exactly one, so
 * the first is the honest representative; the rest are in Plunk's dashboard against the same
 * send. The top-level `emails` read is a fallback: the documented shape nests it under `data`,
 * and reading both costs one `??` rather than a send that succeeds and then throws.
 */
function readMessageId(body: unknown): string | undefined {
  const shape = body as
    | {
        data?: { emails?: { email?: unknown }[] };
        emails?: { email?: unknown }[];
      }
    | undefined;
  const emails = shape?.data?.emails ?? shape?.emails;
  const first = Array.isArray(emails) ? emails[0]?.email : undefined;
  return typeof first === "string" ? first : undefined;
}

function normalize(status: number, body: unknown): EmailError {
  const providerCode = readCode(body);
  const mapped = providerCode ? ERROR_CODES[providerCode] : undefined;
  const detail = readDetail(body) ?? `HTTP ${status}`;

  const fromStatus = mapStatus(status, providerCode);
  const code = mapped?.code ?? fromStatus.code;
  const retryable = mapped?.retryable ?? fromStatus.retryable;

  return new EmailError(code, `plunk: ${detail}`, {
    providerCode: providerCode ?? String(status),
    retryable,
  });
}

function mapStatus(
  status: number,
  providerCode: string | undefined
): { code: EmailErrorCode; retryable: boolean } {
  if (status === 429) {
    return { code: "rate_limited", retryable: true };
  }
  if (status === 413 || (status === 422 && isSizeCode(providerCode))) {
    return { code: "too_large", retryable: false };
  }
  // 401 (bad key), 403 (project may not send), 404 (wrong base URL), 422 (schema rejection,
  // including an unverified sender until that code is pinned down): re-sending the same bytes
  // with the same config cannot succeed, so none of them is retryable.
  if (status === 401 || status === 403 || status === 404 || status === 422) {
    return { code: "provider_error", retryable: false };
  }
  if (status >= 500) {
    return { code: "provider_error", retryable: true };
  }
  return { code: "provider_error", retryable: false };
}

function isSizeCode(providerCode: string | undefined): boolean {
  return providerCode !== undefined && /SIZE|TOO_LARGE/i.test(providerCode);
}

function readCode(body: unknown): string | undefined {
  const { code } = readError(body);
  return typeof code === "string" ? code : undefined;
}

/**
 * Plunk's rejections carry a human message plus, on a 422, a per-field `errors[]`. Keeping the
 * field detail in the thrown message is what makes an unrecognized 422 debuggable at all.
 */
function readDetail(body: unknown): string | undefined {
  const error = readError(body);
  const parts: string[] = [];

  if (typeof error.message === "string" && error.message) {
    parts.push(error.message);
  }
  if (Array.isArray(error.errors)) {
    const fields = error.errors
      .map((entry) =>
        typeof entry === "string" ? entry : describeField(entry)
      )
      .filter((entry): entry is string => Boolean(entry));
    if (fields.length > 0) {
      parts.push(fields.join("; "));
    }
  }

  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function describeField(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const { message, path } = entry as { message?: unknown; path?: unknown };
  if (typeof message !== "string") {
    return undefined;
  }
  const field = Array.isArray(path) ? path.join(".") : path;
  return typeof field === "string" && field ? `${field}: ${message}` : message;
}

/** The body is either `{ error: { … } }` or the flat `{ code, message }` shape. */
function readError(body: unknown): {
  code?: unknown;
  message?: unknown;
  errors?: unknown;
} {
  if (typeof body !== "object" || body === null) {
    return {};
  }
  const { error } = body as { error?: unknown };
  if (typeof error === "object" && error !== null) {
    return error as { code?: unknown; message?: unknown; errors?: unknown };
  }
  return body as { code?: unknown; message?: unknown; errors?: unknown };
}
