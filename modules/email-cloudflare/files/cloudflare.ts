import { EmailError } from "../provider";
import type {
  EmailEnv,
  EmailErrorCode,
  EmailProvider,
  EmailResult,
  ResolvedEmailMessage,
} from "../provider";

// Cloudflare Email Sending, reached through a Worker binding. There is no API key and
// no secret here — the `send_email` binding in apps/api/wrangler.jsonc *is* the
// credential, which is why this provider declares no envVars of its own.
//
// Requires a Workers **paid plan** and a domain onboarded through the Cloudflare
// dashboard (Compute → Email Service → Email Sending). Neither is something the CLI
// can do or check for you; `email-console` exists so local dev needs neither.
//
// `SendEmail` and `EmailMessageBuilder` are ambient globals from
// @cloudflare/workers-types, which packages/email already carries as a devDependency —
// nothing is imported, and there is no npm dependency to add.

export interface CloudflareEmailOptions {
  /** Binding name in wrangler.jsonc. The module's own patch writes `EMAIL`. */
  binding?: string;
}

/**
 * Cloudflare's runtime rejects a send by throwing an error carrying a `code` string.
 * Those codes appear nowhere in @cloudflare/workers-types — they are runtime-only
 * values, so this table is ours to keep accurate. Anything unlisted falls through to
 * `provider_error` / `retryable: false`: guessing that an unknown failure is safe to
 * retry is the more expensive mistake (duplicate mail, or a hot loop against a hard
 * rejection). Add a row when you meet a new code in the wild.
 */
const ERROR_CODES: Record<string, { code: EmailErrorCode; retryable: boolean }> = {
  E_SENDER_NOT_VERIFIED: { code: "sender_not_verified", retryable: false },
  E_RATE_LIMIT_EXCEEDED: { code: "rate_limited", retryable: true },
  E_CONTENT_TOO_LARGE: { code: "too_large", retryable: false },
};

export function cloudflare(options: CloudflareEmailOptions = {}): EmailProvider {
  const bindingName = options.binding ?? "EMAIL";

  return {
    name: "cloudflare",

    async send(env: EmailEnv, message: ResolvedEmailMessage): Promise<EmailResult> {
      const binding = env[bindingName] as SendEmail | undefined;
      if (!binding || typeof binding.send !== "function") {
        throw new EmailError(
          "provider_error",
          `No \`${bindingName}\` Email Sending binding on this Worker's env. Check the ` +
            "send_email entry in apps/api/wrangler.jsonc, and that this account is on a " +
            "Workers paid plan with a domain onboarded to Email Service.",
        );
      }

      try {
        const result = await binding.send({
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        });
        return { messageId: result.messageId };
      } catch (cause) {
        throw normalize(cause);
      }
    },
  };
}

function normalize(cause: unknown): EmailError {
  if (cause instanceof EmailError) return cause;

  const providerCode = readCode(cause);
  const mapped = providerCode ? ERROR_CODES[providerCode] : undefined;
  const message = cause instanceof Error ? cause.message : String(cause);

  return new EmailError(mapped?.code ?? "provider_error", message, {
    retryable: mapped?.retryable ?? false,
    providerCode,
    cause,
  });
}

function readCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
