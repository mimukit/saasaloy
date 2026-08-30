import { EmailError } from "./provider";
import { deriveText } from "./render";
import type {
  EmailEnv,
  EmailMessage,
  EmailProvider,
  EmailResult,
  ResolvedEmailMessage,
} from "./provider";

// The provider registry and the `createEmail(env)` factory behind it. This file holds
// everything that is true of *every* provider — selection, sender resolution,
// plaintext derivation — so a provider module only ever ships a `send()`.

export interface EmailConfig {
  providers: EmailProvider[];
}

/** What a caller sends with. Returned by `createEmail(env)`. */
export interface EmailClient {
  /** The selected provider's name — handy in logs and in a `doctor` check. */
  provider: string;
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface EmailRegistry {
  providers: EmailProvider[];
  create(env: EmailEnv): EmailClient;
}

/**
 * Build the provider registry. The `providers` array is the patch point every
 * `email-<provider>` module appends to — see `src/index.ts`.
 */
export function defineEmail(config: EmailConfig): EmailRegistry {
  const { providers } = config;

  return {
    create(env: EmailEnv): EmailClient {
      const provider = selectProvider(providers, env.EMAIL_PROVIDER);

      return {
        provider: provider.name,
        async send(message: EmailMessage): Promise<EmailResult> {
          // Resolved outside the `try` on purpose: a missing sender or an empty
          // recipient list is the caller's mistake, not the provider's, and wrapping it
          // as `provider_error` would blame the wrong layer. It still throws an
          // `EmailError` — `invalid_message` — because this runs inside `send()`, and
          // `provider.ts` promises that `send()` throws exactly one kind of error.
          const resolved = resolve(env, message);

          try {
            return await provider.send(env, resolved);
          } catch (error) {
            // A provider is contractually responsible for normalizing its own failures,
            // but a bespoke one written in a consumer's project may not — and a raw
            // `TypeError` from a failed `fetch` reaching the caller would break the
            // `EmailError` contract `provider.ts` promises. Re-throw a well-formed error
            // untouched; wrap anything else, keeping the original in `cause`.
            if (error instanceof EmailError) {
              throw error;
            }
            throw new EmailError(
              "provider_error",
              `${provider.name}: send failed`,
              {
                retryable: false,
                cause: error,
              }
            );
          }
        },
      };
    },
    providers,
  };
}

/**
 * `EMAIL_PROVIDER` is required even when exactly one provider is installed, and an
 * unknown value is an error rather than a fallback. Both directions of the silent
 * failure are worse than a throw: a production deploy that quietly stops sending, and
 * a test run that quietly starts.
 */
function selectProvider(
  providers: EmailProvider[],
  selected: string | undefined
): EmailProvider {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered — install one, e.g. `saasaloy add email-console`.";

  if (!selected) {
    throw new Error(`EMAIL_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `EMAIL_PROVIDER is "${selected}", which is not registered. ${known}`
    );
  }
  return provider;
}

function resolve(env: EmailEnv, message: EmailMessage): ResolvedEmailMessage {
  const from = message.from ?? env.EMAIL_FROM;
  if (!from) {
    throw new EmailError(
      "invalid_message",
      "No sender address: set EMAIL_FROM, or pass `from` on the message. It must be an " +
        "address on a domain your provider is allowed to send from."
    );
  }

  const to = Array.isArray(message.to) ? message.to : [message.to];
  if (to.length === 0) {
    throw new EmailError(
      "invalid_message",
      "No recipients: `to` must hold at least one address."
    );
  }

  return {
    ...message,
    from,
    text: message.text ?? deriveText(message.html),
    to,
  };
}
