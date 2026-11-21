import { defineSms } from "./define";
import type { SmsEnv } from "./provider";
import { smsProviders } from "./providers.generated";

export { defineSms } from "./define";
export type { SmsClient, SmsConfig, SmsRegistry } from "./define";
export { SmsError } from "./provider";
export type {
  ResolvedSmsMessage,
  SmsContent,
  SmsEnv,
  SmsErrorCode,
  SmsErrorOptions,
  SmsMessage,
  SmsProvider,
  SmsResult,
  SmsTemplate,
} from "./provider";
export { countSegments, measureSegments } from "./segments";
export type { SmsEncoding, SmsSegmentation } from "./segments";

// The provider registry. Every `sms-<provider>` module adds a row to the `sms.providers`
// table, and the CLI writes `./providers.generated.ts` from those rows on every run:
// `saasaloy add sms-console` adds `consoleSms()`, and `saasaloy remove` takes it back out.
// A provider of your own goes after the spread, never in the generated file: the CLI
// overwrites it, and `saasaloy update` refuses when it was edited.
export const sms = defineSms({ providers: [...smsProviders] });

/**
 * Get a sender for this request's environment. Mirrors `getDb(c.env.DB)`, except it takes
 * the whole `env`: which key the active provider reads is precisely what a calling route
 * isn't supposed to know.
 *
 * ```ts
 * const texts = createSms(c.env);
 * await texts.send({ to: user.phone, ...verificationCode({ code, appName: "Acme" }) });
 * ```
 *
 * Throws when `SMS_PROVIDER` is unset or names a provider that isn't installed.
 */
export function createSms(env: SmsEnv) {
  return sms.create(env);
}
