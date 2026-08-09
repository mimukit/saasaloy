import { defineSms } from "./define";
import type { SmsEnv } from "./provider";

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

// The provider registry, and the patch point every `sms-<provider>` module writes into.
// `saasaloy add sms-console` adds its import and appends `consoleSms()` here —
// idempotently, so re-running it changes nothing.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal. The codemod behind the `plugin-array` patch kind
// (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and a
// provider install fails silently. Never omit `providers`, even while it's empty.
export const sms = defineSms({ providers: [] });

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
