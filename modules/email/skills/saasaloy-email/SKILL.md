---
name: saasaloy-email
description: Runbook for the email capability — a provider-agnostic sender in packages/email with per-provider modules (email-cloudflare, email-console). Use when sending mail from a route, authoring or changing a template, onboarding a domain to Cloudflare Email Sending, choosing or switching EMAIL_PROVIDER, writing a custom provider, or wiring email into waitlist/auth signup flows.
---

# email — provider-agnostic sending from `packages/email`

`packages/email` (`@repo/email`) is the capability core: a template convention, an escaping
`html` helper, and a **provider registry**. It has **zero runtime dependencies** and knows nothing
about any particular email service. Each provider ships as its own module — `email-cloudflare`
(Cloudflare Email Sending, via a Worker binding) and `email-console` (dev) — dropping one file into
`src/providers/` and registering itself in the array in `src/index.ts`.

Callers import `@repo/email`, call `createEmail(env)`, and never learn which provider is active.

> **`email-console` is dev-only, unlike the identically-named `logger-console`.** The two share a
> naming pattern and mean opposite things: logging a message *instead of sending it* is a
> substitute you must never deploy (it puts the rendered body, including one-time links, in your
> log retention), whereas `logger-console` writes to the Workers Logs pipeline and is the
> production default. Set `EMAIL_PROVIDER=console` in dev and tests only.

## Send from a route

```ts
// apps/api/src/routes/widgets.ts
import { Hono } from "hono";
import { createEmail } from "@repo/email";
import { welcome } from "@repo/email/templates/welcome";

const widgets = new Hono();

widgets.post("/", async (c) => {
  const mail = createEmail(c.env);
  await mail.send({
    to: "person@example.com",
    ...welcome({ name: "Ada", appName: "Acme", ctaUrl: "https://app.acme.com" }),
  });
  return c.json({ ok: true });
});

export default widgets;
```

The import is `@repo/email` — the real package name — not `@email/...`. `@email` is only the
**file-placement alias** `saasaloy.json` uses to resolve a module's `files[].target` when copying
files onto disk; it is not a TypeScript or Vite import alias.

`createEmail(env)` takes the **whole env**, not one binding, because which key the active provider
reads (`EMAIL` binding? an API key?) is precisely what a route isn't supposed to know. It throws
immediately when `EMAIL_PROVIDER` is unset or names a provider that isn't installed, with the
registered names in the message.

### Awaiting vs. `waitUntil` — decide per message

The package **never retries**, deliberately: a retry loop inside a request handler holds the
Worker's response open. Choose how a failure should behave instead.

Both branches below sit inside a route handler like the one above, so `c` is the Hono context.

```ts
import { EmailError } from "@repo/email"; // alongside `createEmail` — needed by the catch below

const mail = createEmail(c.env);

// Non-critical (welcome mail): don't make the user's request wait on it, and don't let a
// mail outage fail an operation that already succeeded.
c.executionCtx.waitUntil(
  mail.send({ to: user.email, ...welcome(props) }).catch((error) => console.error("email failed", error)),
);

// Critical (password reset, verification): the caller must know it didn't arrive.
try {
  await mail.send({ to: user.email, ...resetPassword(props) });
} catch (error) {
  if (error instanceof EmailError && error.retryable) return c.json({ error: "try_again" }, 503);
  throw error;
}
```

Both shapes stay correct if a `queue` capability lands later — that's where a real retry belongs,
and `EmailError.retryable` is the flag it will read.

## Env checklist (`add email` prints this)

| Var | What | Required |
|---|---|---|
| `EMAIL_PROVIDER` | Which registered provider sends: `cloudflare`, `console`, … | **Always**, even with one provider installed |
| `EMAIL_FROM` | Default sender (`hello@x.com`), on a domain that provider may send from | Unless every message passes its own `from` |

`EMAIL_PROVIDER` has **no default** on purpose. A default would mean a production deploy can
silently stop sending, or a test run can silently start — both are worse than a startup error that
names the providers you actually have.

## Templates: `(props) => { subject, html, text? }`

A template is a plain function in `src/templates/`. There is no registry and no discovery step —
import the one you want. `src/templates/welcome.ts` is the worked example; copy it to start a new
one.

```ts
import { html, layout } from "../render";
import type { EmailTemplate } from "../provider";

export interface ResetProps { name: string; resetUrl: string }

export const resetPassword: EmailTemplate<ResetProps> = ({ name, resetUrl }) => ({
  subject: "Reset your password",
  html: layout({
    title: "Reset your password",
    content: html`
      <p>Hi ${name}, use the link below within the hour.</p>
      <p><a href="${resetUrl}">Choose a new password</a></p>
    `,
  }),
});
```

- **`html` escapes every interpolation.** A name, a subject, anything a user typed can't inject
  markup. Nested `html` fragments and arrays of them compose as-is; `null`/`undefined`/`false`
  render as nothing, so `${isTrial && html`<p>…</p>`}` works. Use `raw()` only for markup you
  built yourself. Escaping covers unquoted attribute positions too (spaces, `=` and backticks
  become entities), but it stops *markup*, not *meaning* — a `javascript:` URL contains nothing
  to escape, so run any caller-supplied `href` through `safeUrl` and validate `style` values
  yourself.
- **`layout({ title, content, footer?, preheader? })`** wraps a fragment in a complete document
  with inline styles. Email clients strip `<style>` blocks and ignore most of CSS — keep styling
  inline and the structure a single column.
- **`text` is optional and auto-derived** from the HTML (`deriveText`), so every message goes out
  multipart without any template being written twice. Links keep their destination
  (`<a href="x">y</a>` → `y (x)`). Supply `text` by hand when the derived version reads badly; an
  explicit one always wins.

## Providers

| Module | Provider name | Needs | Adds |
|---|---|---|---|
| `email-cloudflare` | `cloudflare` | Workers **paid plan** + a domain onboarded in the dashboard | `send_email` binding in `apps/api/wrangler.jsonc` |
| `email-console` | `console` | nothing | nothing — logs the rendered message |

Installing another provider is the same command again (`saasaloy add email-console`); the codemod
appends to the `providers` array idempotently, so both can be registered at once and
`EMAIL_PROVIDER` picks between them per environment.

### Cloudflare Email Sending: the dashboard runbook

Two prerequisites the CLI **cannot** perform or verify — do them before expecting a send to work:

1. **Workers paid plan.** Email Sending is not on the free tier.
2. **Onboard a sending domain.** Cloudflare dashboard → **Compute** → **Email Service** →
   **Email Sending** → add your domain. The domain must already use Cloudflare DNS. Onboarding
   adds SPF, DKIM and DMARC records plus a `cf-bounce` subdomain automatically; wait for them to
   verify. `EMAIL_FROM` must be an address on that domain, or every send fails
   `sender_not_verified`.

The binding this module patches in:

```jsonc
"send_email": [{ "name": "EMAIL", "remote": false }]
```

`remote: false` is the shipped default so that installing this module never breaks the dev loop —
see [Sending for real from dev](#sending-for-real-from-dev) for the one-key flip that turns on a
live send, and why it isn't the default.

The module deliberately leaves `allowed_sender_addresses` unset so each project picks its own; add
it yourself to lock the Worker down to specific senders.

Known limits: 50 combined to/cc/bcc recipients, 5 MiB per message, 32 attachments, 16 KB of
headers. Errors arrive as `EmailError` with `code` one of `sender_not_verified`, `rate_limited`,
`too_large`, `invalid_message`, `provider_error`, the raw Cloudflare code kept in `providerCode`.
`E_INTERNAL_SERVER_ERROR` maps to `provider_error` with `retryable: true` — it is Cloudflare's
failure, not the message's.

### Local development

Use `email-console` and `EMAIL_PROVIDER=console`. Nothing sends, the rendered message goes to the
Worker's log, and `send()` returns a synthetic `console-<uuid>` message id. Because the provider is
registered through the same registry, the code path under test is the real one — only the transport
differs.

> [!WARNING]
> **Never set `EMAIL_PROVIDER=console` in a deployed environment.** Writing the message to the log
> is the whole point of this provider, so it logs the body in full — which means recipient
> addresses, whatever the template rendered, and any one-time link in it: password resets, magic
> links, invitations. In production that is a credential sitting in your log retention, readable by
> anyone with dashboard access. The provider is for `wrangler dev` and tests; production selects a
> real one.

#### Sending for real from dev

A `send_email` binding only reaches Cloudflare's Email Sending API when it is marked `remote`. To
prove the path end to end, flip the one key in `apps/api/wrangler.jsonc`:

```jsonc
"send_email": [{ "name": "EMAIL", "remote": true }]
```

then run `wrangler dev` (not `vite dev`) with `EMAIL_PROVIDER=cloudflare` and a `EMAIL_FROM` on
your onboarded domain. Mail actually leaves your machine.

**Flip it back when you're done, and here is why it isn't the default.**
`@cloudflare/vite-plugin` opens a remote proxy session at startup for *any* `remote: true` binding,
before it knows or cares which email provider you selected. If it can't authenticate, the Vite dev
loop doesn't start at all — so with the flag on, `pnpm --filter @repo/api dev` fails for every
teammate who hasn't set up Cloudflare credentials:

```text
⎔ Establishing remote connection...
error when starting dev server:
Error: Failed to start the remote proxy session. Error reloading remote server: In a
non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable
for wrangler to work.
```

Nothing in that message mentions email. If you see it, either authenticate (`wrangler login`, or
set `CLOUDFLARE_API_TOKEN`) or set the binding back to `"remote": false`. Developing on
`EMAIL_PROVIDER=console` does **not** exempt you — the binding is read before provider selection
happens.

If you *are* authenticated, `remote: true` starts fine and you may never see this — a past
`wrangler login` persists in `~/.config/.wrangler/` and keeps working long after you've forgotten
it. That's exactly why the default is `false`: the failure lands on whoever cloned the repo next,
not on the person who set the flag.

## Writing a custom provider in your own project

You don't need a registry module to add a provider — a file and a line will do. Implement
`EmailProvider` in `packages/email/src/providers/<name>.ts`:

```ts
import { EmailError } from "../provider";
import type { EmailEnv, EmailProvider, EmailResult, ResolvedEmailMessage } from "../provider";

export function postmark(): EmailProvider {
  return {
    name: "postmark", // the value EMAIL_PROVIDER must hold
    async send(env: EmailEnv, message: ResolvedEmailMessage): Promise<EmailResult> {
      let response: Response;
      try {
        response = await fetch("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-postmark-server-token": String(env.POSTMARK_TOKEN ?? ""),
          },
          body: JSON.stringify({
            From: message.from,
            To: message.to.join(","),
            Subject: message.subject,
            HtmlBody: message.html,
            TextBody: message.text,
          }),
          // Bound the call. Without this a hung provider holds the Worker's response
          // open until the platform kills it, and the caller gets no `EmailError` at all.
          signal: AbortSignal.timeout(10_000),
        });
      } catch (cause) {
        // The request never completed — a timeout, DNS, TLS, a dropped connection.
        // Retryable either way; the abort is worth naming so logs distinguish it.
        const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
        throw new EmailError(
          "provider_error",
          timedOut ? "postmark: request timed out" : "postmark: request failed",
          { retryable: true, cause },
        );
      }

      if (!response.ok) {
        throw new EmailError("provider_error", `postmark: ${response.status}`, {
          retryable: response.status === 429 || response.status >= 500,
          providerCode: String(response.status),
        });
      }

      let body: { MessageID?: string };
      try {
        body = (await response.json()) as { MessageID?: string };
      } catch (cause) {
        // A 2xx we can't parse. Re-sending is unlikely to help.
        throw new EmailError("provider_error", "postmark: unreadable response", { cause });
      }

      // Don't take the cast's word for it — `EmailResult.messageId` is a string, and
      // returning `undefined` here would break that contract silently.
      if (!body.MessageID) {
        throw new EmailError("provider_error", "postmark: response carried no MessageID");
      }
      return { messageId: body.MessageID };
    },
  };
}
```

Then register it by hand in `src/index.ts`:

```ts
// Add the import; `defineEmail` is already imported at the top of this file.
import { postmark } from "./providers/postmark";

// Then add the call to the existing array literal — don't replace the line's shape.
export const email = defineEmail({ providers: [postmark()] });
```

Contract notes:

- The core hands you a **resolved** message: `from` filled in from `EMAIL_FROM`, `to` normalized to
  an array, `text` derived from `html`. Don't re-implement any of that.
- Normalize failures into `EmailError` with one of the four `code` values a provider may raise
  (`sender_not_verified`, `rate_limited`, `too_large`, `provider_error` — `invalid_message` is the
  core's, for a message that never reached you), set `retryable` honestly, and keep the vendor's
  own code in `providerCode`. Default to
  `provider_error` / `retryable: false` for anything you don't recognize — a wrong `retryable: true`
  means duplicate mail. Cover *every* path out of the call, not just a non-2xx status: a rejected
  request, an abort, and an unparseable body each reach the caller otherwise.
- The core is a backstop, not a substitute. Anything that escapes your `send()` without being an
  `EmailError` is wrapped as `provider_error` / `retryable: false`, with the original kept in
  `cause` — so a caller can always branch on `code`. Relying on that costs you the accurate
  `retryable` only you can determine.
- Read secrets off the `env` you're handed. `process.env` does not exist on Workers.
- Any npm dependency belongs in `packages/email/package.json`, not in another workspace — only this
  package touches provider SDKs (ADR 0020).

## Wiring recipes (manual, for now)

Nothing depends on `email` automatically: `dependsOn` is a hard prerequisite list with no way to
say *"use `email` if it's installed"*, so `waitlist` and `auth` ship without it rather than forcing
it on every project. Wire it yourself with one of these; an optional-dependency mechanism is a
tracked follow-up that will make them unnecessary.

### `waitlist` — confirm a signup

In `apps/api/src/routes/waitlist.ts`, after the insert succeeds:

```ts
import { createEmail } from "@repo/email";
import { welcome } from "@repo/email/templates/welcome";

// …inside the POST handler, after the row is written:
c.executionCtx.waitUntil(
  createEmail(c.env)
    .send({ to: email, ...welcome({ name: email, appName: "Acme", ctaUrl: "https://acme.com" }) })
    .catch((error) => console.error("waitlist email failed", error)),
);
```

`waitUntil` on purpose: the row is already saved, so a mail outage must not turn a successful
signup into an error for the user.

### `auth` — email verification and password reset

In `packages/auth/src/auth.ts`, flip the flag and supply the sender. Better Auth calls these with
the user and a pre-built URL:

```ts
import { createEmail, html, layout } from "@repo/email";
import { env } from "cloudflare:workers";

export const auth = betterAuth({
  // …
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // was false — off until email existed
    sendResetPassword: async ({ user, url }) => {
      await createEmail(env).send({
        to: user.email,
        subject: "Reset your password",
        html: layout({ title: "Reset your password", content: html`<p><a href="${url}">Choose a new password</a></p>` }),
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await createEmail(env).send({
        to: user.email,
        subject: "Verify your email",
        html: layout({ title: "Verify your email", content: html`<p><a href="${url}">Confirm this address</a></p>` }),
      });
    },
  },
});
```

`packages/auth` reads `cloudflare:workers`' importable `env` because its `auth` export is a
module-scope singleton — that's the one place `createEmail` isn't handed a request's `c.env`. Add
`"@repo/email": "workspace:*"` to `packages/auth/package.json` when you do this, and don't turn
`requireEmailVerification` on before a provider is installed and `EMAIL_PROVIDER` is set: sign-up
will appear to hang.

## Boundaries to honor

- **`export const email = defineEmail({ providers: [] })` stays in exactly that shape** — a real
  array literal, never omitted. It is the patch point every provider module appends to; without it
  a provider install fails silently.
- **Only `packages/email` talks to a provider's SDK or binding.** Everything else imports
  `@repo/email` (ADR 0020).
- **`EMAIL_PROVIDER` never gets a default**, in code or in an example.
- **No retry inside the package.** Use `waitUntil` or an explicit `await` with a catch; retry
  belongs to a queue.
- **Escape by default.** Interpolate through the `html` tag; reach for `raw()` only on markup you
  constructed.
- **Templates stay plain functions** returning `{ subject, html, text? }` — no rendering framework
  in the api Worker's bundle.
