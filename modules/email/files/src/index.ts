import { defineEmail } from "./define";
import type { EmailEnv } from "./provider";

export { defineEmail } from "./define";
export type { EmailClient, EmailConfig, EmailRegistry } from "./define";
export { EmailError } from "./provider";
export type {
  EmailContent,
  EmailEnv,
  EmailErrorCode,
  EmailErrorOptions,
  EmailMessage,
  EmailProvider,
  EmailResult,
  EmailTemplate,
  ResolvedEmailMessage,
} from "./provider";
export { deriveText, html, layout, raw, SafeHtml } from "./render";
export type { LayoutOptions } from "./render";

// The provider registry, and the patch point every `email-<provider>` module writes
// into. `saasaloy add email-cloudflare` adds its import and appends `cloudflare()`
// here — idempotently, so re-running it changes nothing.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal. The codemod behind the `plugin-array` patch kind
// (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and a
// provider install fails silently. Never omit `providers`, even while it's empty.
export const email = defineEmail({ providers: [] });

/**
 * Get a sender for this request's environment. Mirrors `getDb(c.env.DB)`, except it
 * takes the whole `env`: which key the active provider reads is precisely what a
 * calling route isn't supposed to know.
 *
 * ```ts
 * const mail = createEmail(c.env);
 * await mail.send({ to: user.email, ...welcome({ name: user.name }) });
 * ```
 *
 * Throws when `EMAIL_PROVIDER` is unset or names a provider that isn't installed.
 */
export function createEmail(env: EmailEnv) {
  return email.create(env);
}
