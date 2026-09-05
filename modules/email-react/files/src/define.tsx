import { render } from "@react-email/render";
import type { EmailContent } from "@repo/email";
import type { ReactElement } from "react";

/**
 * The JSX counterpart of the core's `EmailTemplate<Props>`, and the one place the two
 * idioms differ: this one is **async**.
 *
 * `@react-email/render`'s `render()` returns a `Promise<string>` under the `workerd`
 * export condition, so a JSX template cannot satisfy the core's synchronous
 * `(props) => EmailContent`. The core contract is left exactly as it is and this type
 * lives here instead; see
 * `docs/adr/adr-0031-react-email-is-an-opt-in-render-engine-2026-09-03.md`.
 *
 * The only thing that changes at a call site is one `await`:
 *
 * ```ts
 * await mail.send({ to: user.email, ...(await welcome({ name, appName, ctaUrl })) });
 * ```
 */
export type ReactEmailTemplate<Props = void> = (
  props: Props
) => Promise<EmailContent>;

/** What a JSX template hands back: the subject line, plus the element to render. */
export interface ReactEmailDocument {
  /** The subject line. Plain text — React Email never sees it. */
  subject: string;
  /** The email body, built from `@react-email/components` primitives. */
  element: ReactElement;
}

/**
 * Wrap a `(props) => { subject, element }` builder into a template that resolves to the
 * `{ subject, html, text }` object every provider already consumes.
 *
 * `text` comes from React Email's own plaintext renderer rather than the core's
 * `deriveText()`. `deriveText()` reads the tagged templates' single-column markup; React
 * Email emits nested tables, and `render({ plainText: true })` is the renderer built for
 * them. Pass your own `text` only by writing it into the returned object at the call
 * site — the core keeps an explicit `text` over anything derived.
 *
 * ```tsx
 * export const welcome = defineReactTemplate<WelcomeProps>(({ name }) => ({
 *   subject: `Welcome, ${name}`,
 *   element: <Html>…</Html>,
 * }));
 * ```
 */
export function defineReactTemplate<Props = void>(
  build: (props: Props) => ReactEmailDocument
): ReactEmailTemplate<Props> {
  return async (props: Props): Promise<EmailContent> => {
    const { element, subject } = build(props);
    // Rendered twice on purpose. React Email has no single call that returns both
    // representations, and the plaintext pass walks the same element tree rather than
    // re-deriving from the HTML string.
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ]);
    return { html, subject, text };
  };
}
