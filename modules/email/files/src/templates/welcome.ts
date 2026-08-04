import { html, layout } from "../render";
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
  /** Absolute URL — a relative one has nothing to resolve against in an inbox. */
  ctaUrl: string;
}

export const welcome: EmailTemplate<WelcomeProps> = ({ name, appName, ctaUrl }) => ({
  subject: `Welcome to ${appName}`,
  html: layout({
    title: `Welcome to ${appName}`,
    preheader: `Your ${appName} account is ready.`,
    content: html`
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">Welcome, ${name}.</h1>
      <p style="margin:0 0 24px;">
        Your ${appName} account is ready. There's nothing else to set up — pick up where
        you left off whenever you like.
      </p>
      <p style="margin:0 0 24px;">
        <a
          href="${ctaUrl}"
          style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
          >Open ${appName}</a
        >
      </p>
      <p style="margin:0;">If you didn't create this account, you can ignore this email.</p>
    `,
    footer: html`You're receiving this because someone signed up for ${appName} with this
    address.`,
  }),
  // No `text` here on purpose: the core derives it from the HTML above, so every
  // message goes out multipart without this template being written twice. Add
  // `text: "..."` when the derived version reads badly — it always wins when present.
});
