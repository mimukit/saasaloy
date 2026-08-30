import { html, layout, safeUrl } from "../render";
import type { EmailTemplate } from "../provider";

// A worked example of the template contract: `(props) => { subject, html, text? }`.
// Copy this file to start a new one. Templates are plain functions — no registry, no
// discovery, no build step; import the one you want and spread it into `send()`:
//
//   await createEmail(c.env).send({ to: user.email, ...welcome({ name, appName, ctaUrl }) });

export interface WelcomeProps {
  /** Display name of the person receiving this. Escaped by the `html` tag. */
  name: string;
  appName: string;
  /**
   * Absolute `https:` URL — a relative one has nothing to resolve against in an inbox.
   * Checked by `safeUrl`, which throws rather than render a link it can't vouch for.
   */
  ctaUrl: string;
}

export const welcome: EmailTemplate<WelcomeProps> = ({
  name,
  appName,
  ctaUrl,
}) => {
  // Validated, not merely escaped. The `html` tag below escapes every interpolation,
  // which stops markup — but a `javascript:` URL has no markup in it to escape and
  // would reach the inbox as a working link. Any template dropping a caller's value
  // into an `href` needs this line; that's why the worked example carries it.
  const href = safeUrl(ctaUrl);

  return {
    subject: `Welcome to ${appName}`,
    html: layout({
      content: html`
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">
          Welcome, ${name}.
        </h1>
        <p style="margin:0 0 24px;">
          Your ${appName} account is ready. There's nothing else to set up —
          pick up where you left off whenever you like.
        </p>
        <p style="margin:0 0 24px;">
          <a
            href="${href}"
            style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
            >Open ${appName}</a
          >
        </p>
        <p style="margin:0;">
          If you didn't create this account, you can ignore this email.
        </p>
      `,
      footer: html`You're receiving this because someone signed up for
      ${appName} with this address.`,
      preheader: `Your ${appName} account is ready.`,
      title: `Welcome to ${appName}`,
    }),
    // No `text` here on purpose: the core derives it from the HTML above, so every
    // message goes out multipart without this template being written twice. Add
    // `text: "..."` when the derived version reads badly — it always wins when present.
  };
};
