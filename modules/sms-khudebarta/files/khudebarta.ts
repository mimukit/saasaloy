import { SmsError } from "../provider";
import type {
  ResolvedSmsMessage,
  SmsEnv,
  SmsErrorCode,
  SmsProvider,
  SmsResult,
} from "../provider";

// Khudebarta, a Bangladeshi bulk-SMS gateway, reached over HTTPS: `POST <base>/sendtext` with a
// JSON body carrying the API key and secret. No SDK and no Workers binding, so this provider adds
// no npm dependency and packages/sms stays at zero runtime dependencies (ADR 0020).
//
// Three env vars, all read off the `env` the core hands in (`process.env` does not exist on
// Workers): `KHUDEBARTA_API_KEY` and `KHUDEBARTA_SECRET_KEY` (required) and `KHUDEBARTA_API_URL`
// (optional). The sender is the capability's own `SMS_FROM`, resolved by the core.
//
// Three things about this gateway that break a provider copied from `email-plunk`:
//
// 1. **It answers HTTP 200 on every failure.** Success is `Status === "0"` in the JSON body.
//    `response.ok` says nothing, so this file never reads it.
// 2. **Workers strip a custom port from a plain `http://` subrequest.** The vendor's documented
//    HTTP endpoint on `:3775` would land on port 80. Custom ports work over HTTPS only, which is
//    why the default is the HTTPS endpoint on `:3770`. An `http://` override is not refused here;
//    the `KHUDEBARTA_API_URL` description says what breaks.
// 3. **The bulk form reports one `Status` for the whole batch.** A partly rejected batch reads as
//    a success, so this provider sends one request per recipient and stops at the first
//    rejection. Earlier recipients stay sent, and the caller cannot tell how far the loop got.
//
// Bangladesh only. International traffic belongs to another provider, so a recipient outside
// `+880` is refused before anything is sent.

const DEFAULT_API_URL = "https://portal.khudebarta.com:3770";

/** Bounds one request. An abort is not retryable: the gateway may already have billed it. */
const REQUEST_TIMEOUT_MS = 15_000;

const BANGLADESH_PREFIX = "+880";

interface KhudebartaPayload {
  apikey: string;
  secretkey: string;
  callerID: string;
  toUser: string;
  messageContent: string;
}

interface KhudebartaResponse {
  Status?: unknown;
  StatusDescription?: unknown;
  Message_ID?: unknown;
}

export function khudebarta(): SmsProvider {
  return {
    name: "khudebarta",

    async send(env: SmsEnv, message: ResolvedSmsMessage): Promise<SmsResult> {
      const apiKey =
        typeof env.KHUDEBARTA_API_KEY === "string"
          ? env.KHUDEBARTA_API_KEY
          : "";
      const secretKey =
        typeof env.KHUDEBARTA_SECRET_KEY === "string"
          ? env.KHUDEBARTA_SECRET_KEY
          : "";
      if (!apiKey || !secretKey) {
        throw new SmsError(
          "provider_error",
          "khudebarta: `KHUDEBARTA_API_KEY` and `KHUDEBARTA_SECRET_KEY` must both be set on " +
            "this Worker's env. Set them in apps/api/.dev.vars for local development and with " +
            "`wrangler secret put` for a deployed Worker."
        );
      }

      // The gateway requires `callerID`. The core leaves the sender optional on purpose, so the
      // requirement is checked here, where it is true.
      if (!message.from) {
        throw new SmsError(
          "invalid_message",
          "khudebarta: no sender. Set `SMS_FROM` to the sender id registered with Khudebarta, " +
            "or pass `from` on the message."
        );
      }

      // Checked across the whole list before the first request: a prefix check is free and
      // deterministic, so spending a real SMS on the recipients before a bad one is waste.
      for (const recipient of message.to) {
        if (!recipient.startsWith(BANGLADESH_PREFIX)) {
          throw new SmsError(
            "invalid_number",
            `khudebarta: ${recipient} is not a Bangladeshi number. This provider sends to ` +
              `${BANGLADESH_PREFIX} numbers only.`
          );
        }
      }

      const baseUrl =
        typeof env.KHUDEBARTA_API_URL === "string" && env.KHUDEBARTA_API_URL
          ? env.KHUDEBARTA_API_URL
          : DEFAULT_API_URL;
      const endpoint = `${baseUrl.replace(/\/+$/, "")}/sendtext`;

      let firstMessageId: string | undefined;

      for (const recipient of message.to) {
        const payload: KhudebartaPayload = {
          apikey: apiKey,
          secretkey: secretKey,
          callerID: message.from,
          // E.164 minus the `+`: `+8801712345678` becomes `8801712345678`.
          toUser: recipient.slice(1),
          // No encoding flag: the gateway accepts ASCII and Unicode alike, so Bangla needs none.
          messageContent: message.body,
        };

        const messageId = await sendOne(endpoint, payload);
        firstMessageId ??= messageId;
      }

      // The core guarantees a non-empty `to`, so the loop ran at least once. The first
      // recipient's id is the representative; the rest are in Khudebarta's portal.
      return { messageId: firstMessageId ?? "" };
    },
  };
}

async function sendOne(
  endpoint: string,
  payload: KhudebartaPayload
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      // The body carries both credentials. Following a redirect would replay them at whatever
      // host the redirect names, so refuse instead.
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // The request never completed: a timeout, DNS, TLS, a dropped connection. Not retryable,
    // unlike email: the gateway may have accepted and billed the message before the connection
    // failed, and a retry would text the recipient twice.
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    throw new SmsError(
      "provider_error",
      timedOut ? "khudebarta: request timed out" : "khudebarta: request failed",
      { cause: error, retryable: false }
    );
  }

  let body: KhudebartaResponse;
  try {
    body = (await response.json()) as KhudebartaResponse;
  } catch (error) {
    // An HTML error page or an empty body from something in front of the gateway. Whether the
    // message went out is unknown, so this is not retryable either.
    throw new SmsError(
      "provider_error",
      `khudebarta: unreadable response (HTTP ${response.status})`,
      { cause: error, retryable: false }
    );
  }

  const status =
    typeof body?.Status === "string" || typeof body?.Status === "number"
      ? String(body.Status)
      : undefined;

  if (status !== "0") {
    throw normalize(status, body?.StatusDescription);
  }

  const messageId =
    typeof body.Message_ID === "string" || typeof body.Message_ID === "number"
      ? String(body.Message_ID)
      : "";
  if (!messageId) {
    // Accepted, but with no id to return. The message may well have gone out, so do not claim
    // an id that is not there, and do not invite a retry.
    throw new SmsError(
      "provider_error",
      "khudebarta: send accepted but the response carried no Message_ID"
    );
  }
  return messageId;
}

function normalize(status: string | undefined, description: unknown): SmsError {
  const detail =
    typeof description === "string" && description
      ? description
      : status === undefined
        ? "response carried no Status"
        : `Status ${status}`;
  const { code, retryable } = mapStatus(status);
  return new SmsError(code, `khudebarta: ${detail}`, {
    providerCode: status,
    retryable,
  });
}

/**
 * Khudebarta's documented `Status` codes, mapped onto the capability's. Sender-not-owned, empty
 * balance and a blocked account collapse into `account_error` by the capability's rule: one
 * caller response, and `providerCode` keeps the vendor's code for whoever fixes it.
 *
 * `unroutable`, `message_too_long` and `rate_limited` never come from here. The gateway publishes
 * no equivalent for any of them.
 */
function mapStatus(status: string | undefined): {
  code: SmsErrorCode;
  retryable: boolean;
} {
  switch (status) {
    case "-3": // Invalid Dest No.
    case "-55": {
      // Destination ID Empty
      return { code: "invalid_number", retryable: false };
    }

    case "-44": // ContactNo Blocked
    case "-45": {
      // ContactNo Blocked by Admin
      return { code: "opted_out", retryable: false };
    }

    case "-1": // Org Client Not Found
    case "-4": // Insufficient Balance
    case "-5": // Org Rate Not Found
    case "-6": // Org Blocked
    case "-7": // Invalid Sender ID
    case "-42": // Authorization Failed
    case "-52": // License Limit Exceeded
    case "-54": // Sender ID Empty
    case "-59": // IP Not Allowed
    case "-64": // Sender ID Block
    case "-66": // Invalid API Key
    case "-67": {
      // Invalid Secret Key
      return { code: "account_error", retryable: false };
    }

    case "-62": {
      // Internal Server Error. The one code where the gateway answered REJECTD for its own
      // reason: the message was not accepted and not billed, so sending it again is safe.
      return { code: "provider_error", retryable: true };
    }

    default: {
      // Every other code, documented or not. Three stay here on purpose:
      // - `-65` Bulk Limit Exceeded cannot happen on a one-recipient-per-request loop. Revisit it
      //   if a real account ever produces one.
      // - `-47` Content not Whitelisted, `-48` URL Blocked and `-49` Content is Blocked are
      //   content-policy rejections with no matching capability code. A `content_rejected` code
      //   would change packages/sms, and this provider exists to prove the contract holds as is.
      return { code: "provider_error", retryable: false };
    }
  }
}
