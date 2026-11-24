import type {
  EmailEnv,
  EmailProvider,
  EmailResult,
  ResolvedEmailMessage,
} from "../provider";

// The development provider: renders the message to the Worker's log and returns a
// synthetic id. No binding, no API key, no paid plan, no domain onboarding — which is
// what makes `pnpm dev` and tests work on a machine that can't send real mail.
//
// Set `EMAIL_PROVIDER=console` to select it. It is registered exactly like any other
// provider, so the code path under test is the real one; only the transport differs.
//
// Never select it in a deployed environment. Logging the message *is* the feature, so
// the body goes to the log whole — including whatever one-time link the template put in
// it (password reset, magic link, invitation), which in production is a live credential
// sitting in log retention for anyone with dashboard access.
//
// The factory is `consoleEmail`, not `console`, so the generated import in
// packages/email/src/index.ts can't shadow the global `console`. The provider's *name*
// — the value EMAIL_PROVIDER takes — is still plain "console".
//
// EMAIL_FROM may stay blank under this provider. The core then sends from the provider's
// `defaultFrom`, which is `dev@localhost` unless `consoleEmail({ from })` names another.

export interface ConsoleEmailOptions {
  /** Log the full HTML body as well as the plaintext. Off by default: it's noisy. */
  html?: boolean;
  /** The sender used when neither the message nor EMAIL_FROM names one. */
  from?: string;
}

export function consoleEmail(options: ConsoleEmailOptions = {}): EmailProvider {
  return {
    name: "console",
    defaultFrom: options.from ?? "dev@localhost",

    async send(
      _env: EmailEnv,
      message: ResolvedEmailMessage
    ): Promise<EmailResult> {
      const messageId = `console-${crypto.randomUUID()}`;

      const lines = [
        "───── email (console provider) ─────",
        `message-id: ${messageId}`,
        `from:       ${message.from}`,
        `to:         ${message.to.join(", ")}`,
        ...(message.replyTo ? [`reply-to:   ${message.replyTo}`] : []),
        `subject:    ${message.subject}`,
        "",
        message.text,
        ...(options.html ? ["", "───── html ─────", message.html] : []),
        "────────────────────────────────────",
      ];
      console.log(lines.join("\n"));

      return { messageId };
    },
  };
}
