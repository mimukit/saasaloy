import { defineEmail } from "./define";
import type { EmailEnv } from "./provider";
import { emailProviders } from "./providers.generated";

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
export { deriveText, html, layout, raw, SafeHtml, safeUrl } from "./render";
export type { LayoutOptions } from "./render";

// The provider registry. Every `email-<provider>` module adds a row to the
// `email.providers` table, and the CLI writes `./providers.generated.ts` from those rows
// on every run: `saasaloy add email-cloudflare` adds `cloudflare()`, and `saasaloy remove`
// takes it back out. A provider of your own goes after the spread, never in the generated
// file: the CLI overwrites it, and `saasaloy update` refuses when it was edited.
export const email = defineEmail({ providers: [...emailProviders] });

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
