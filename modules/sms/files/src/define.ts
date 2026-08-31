import { SmsError } from "./provider";
import { countSegments } from "./segments";
import type {
  SmsEnv,
  SmsMessage,
  SmsProvider,
  SmsResult,
  ResolvedSmsMessage,
} from "./provider";

// The provider registry and the `createSms(env)` factory behind it. This file holds
// everything that is true of *every* provider — selection, recipient validation, sender
// resolution, segment estimation — so a provider module only ever ships a `send()`.

export interface SmsConfig {
  providers: SmsProvider[];
}

/** What a caller sends with. Returned by `createSms(env)`. */
export interface SmsClient {
  /** The selected provider's name — handy in logs and in a `doctor` check. */
  provider: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

export interface SmsRegistry {
  providers: SmsProvider[];
  create(env: SmsEnv): SmsClient;
}

/**
 * E.164: a `+`, a country code that can't start with 0, and at most 15 digits in total.
 *
 * Shape only. This is not normalization — turning `(415) 555-0123` into `+14155550123`
 * needs a ~145 kB phone-number library and a default country the capability has no way to
 * know, and zero runtime dependencies is a property of this package worth more than the
 * convenience. Callers pass E.164.
 */
const E164 = /^\+[1-9]\d{1,14}$/;

/**
 * Build the provider registry. The `providers` array is the patch point every
 * `sms-<provider>` module appends to — see `src/index.ts`.
 */
export function defineSms(config: SmsConfig): SmsRegistry {
  const providers = config.providers;

  return {
    providers,
    create(env: SmsEnv): SmsClient {
      const provider = selectProvider(providers, env.SMS_PROVIDER);

      return {
        provider: provider.name,
        async send(message: SmsMessage): Promise<SmsResult> {
          // Resolved outside the `try` on purpose: a badly formed number or an empty body
          // is the caller's mistake, not the provider's, and wrapping it as
          // `provider_error` would blame the wrong layer. It still throws an `SmsError` —
          // `invalid_message` — because this runs inside `send()`, and `provider.ts`
          // promises that `send()` throws exactly one kind of error.
          const resolved = resolve(env, message);

          try {
            return await provider.send(env, resolved);
          } catch (error) {
            // A provider is contractually responsible for normalizing its own failures,
            // but a bespoke one written in a consumer's project may not — and a raw
            // `TypeError` from a failed `fetch` reaching the caller would break the
            // `SmsError` contract `provider.ts` promises. Re-throw a well-formed error
            // untouched; wrap anything else, keeping the original in `cause`.
            if (error instanceof SmsError) {
              throw error;
            }
            throw new SmsError(
              "provider_error",
              `${provider.name}: send failed`,
              {
                // Not retryable, even though the wrapped failure is usually a network one.
                // On this channel an ambiguous failure may already have been accepted and
                // billed, and re-sending buzzes the phone twice — see `provider.ts`.
                retryable: false,
                cause: error,
              }
            );
          }
        },
      };
    },
  };
}

/**
 * `SMS_PROVIDER` is required even when exactly one provider is installed, and an unknown
 * value is an error rather than a fallback. Both directions of the silent failure are
 * worse than a throw: a production deploy that quietly stops sending, and a test run that
 * quietly starts.
 */
function selectProvider(
  providers: SmsProvider[],
  selected: string | undefined
): SmsProvider {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered — install one, e.g. `saasaloy add sms-console`.";

  if (!selected) {
    throw new Error(`SMS_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `SMS_PROVIDER is "${selected}", which is not registered. ${known}`
    );
  }
  return provider;
}

function resolve(env: SmsEnv, message: SmsMessage): ResolvedSmsMessage {
  const to = Array.isArray(message.to) ? message.to : [message.to];
  if (to.length === 0) {
    throw new SmsError(
      "invalid_message",
      "No recipients: `to` must hold at least one number."
    );
  }

  for (const number of to) {
    if (!E164.test(number)) {
      throw new SmsError(
        "invalid_message",
        `"${number}" is not an E.164 number. Recipients must be written as a "+", the ` +
          'country code and the national number, digits only — e.g. "+14155550123". This ' +
          "package validates the shape and never rewrites it; normalize before you call it."
      );
    }
  }

  if (message.body.length === 0) {
    throw new SmsError(
      "invalid_message",
      "Empty body: there is nothing to send."
    );
  }

  // `from` is passed through exactly as given, including when it resolves to `undefined`:
  // a provider routing through a pool assigns the sender itself, and one that needs a
  // sender raises `invalid_message` from its own `send()`. See `provider.ts`.
  const from = message.from ?? env.SMS_FROM;

  return {
    ...message,
    to,
    from,
    estimatedSegments: countSegments(message.body),
  };
}
