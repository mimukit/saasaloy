import type {
  ResolvedSmsMessage,
  SmsEnv,
  SmsProvider,
  SmsResult,
} from "../provider";

// The development provider: writes the message to the Worker's log and returns a synthetic
// id. No account, no API key, no purchased number, and no A2P 10DLC registration — which
// is what makes `pnpm dev` and tests work on a machine that cannot send a real text.
//
// That gate is the reason this provider is worth shipping rather than a convention copied
// from `email-console`. Email's alternative is onboarding a domain you probably already
// own; SMS's alternative is buying a number and registering a campaign, which takes days
// and costs money before the first message goes anywhere.
//
// Set `SMS_PROVIDER=console` to select it. It is registered exactly like any other
// provider, so the code path under test is the real one; only the transport differs.
//
// Never select it in a deployed environment. Logging the message *is* the feature, so the
// body goes to the log whole — and on this channel the body is typically a live one-time
// code, next to the phone number it was issued to, sitting in log retention for anyone
// with dashboard access.
//
// The factory is `consoleSms`, not `console`, so the generated import in
// packages/sms/src/index.ts can't shadow the global `console`. The provider's *name* — the
// value SMS_PROVIDER takes — is still plain "console".

export function consoleSms(): SmsProvider {
  return {
    name: "console",

    async send(_env: SmsEnv, message: ResolvedSmsMessage): Promise<SmsResult> {
      const messageId = `console-${crypto.randomUUID()}`;

      const lines = [
        "───── sms (console provider) ─────",
        `message-id: ${messageId}`,
        // A pool-routed provider assigns the sender itself, so `from` is legitimately
        // absent here rather than a misconfiguration worth printing an empty row for.
        ...(message.from ? [`from:       ${message.from}`] : []),
        `to:         ${message.to.join(", ")}`,
        // The number the real bill is computed from, surfaced where a developer will
        // actually see it: a body that quietly became three parts in dev is a body that
        // quietly costs triple in production.
        `segments:   ${message.estimatedSegments}`,
        "",
        message.body,
        "──────────────────────────────────",
      ];
      console.log(lines.join("\n"));

      return { messageId };
    },
  };
}
