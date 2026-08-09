---
name: saasaloy-sms
description: Runbook for the sms capability — a provider-agnostic text sender in packages/sms with per-provider modules (sms-console today). Use when sending an SMS from a route, authoring an SMS template, choosing or switching SMS_PROVIDER, estimating what a body costs in segments, writing a custom SMS provider, or working out what consent and STOP handling the project still owes.
---

# sms — provider-agnostic texting from `packages/sms`

`packages/sms` (`@repo/sms`) is the capability core: a template convention, a segment
estimator, and a **provider registry**. It has **zero runtime dependencies** and knows nothing
about any particular SMS service. Each provider ships as its own module — `sms-console` (dev)
today — dropping one file into `src/providers/` and registering itself in the array in
`src/index.ts`.

Callers import `@repo/sms`, call `createSms(env)`, and never learn which provider is active.

It is the same shape as `@repo/email`, on purpose, with **three deliberate differences**: `from` is
optional and unvalidated, `retryable` is enforced by the core rather than trusted to the provider,
and there is no `render.ts`. Each one is called out where it bites.

## Send from a route

```ts
// apps/api/src/routes/signup.ts
import { Hono } from "hono";
import { createSms } from "@repo/sms";
import { verificationCode } from "@repo/sms/templates/verification-code";

const signup = new Hono();

signup.post("/verify", async (c) => {
  const texts = createSms(c.env);
  await texts.send({
    to: "+14155550123",
    ...verificationCode({ code: "123456", appName: "Acme", expiresInMinutes: 10 }),
  });
  return c.json({ ok: true });
});

export default signup;
```

The import is `@repo/sms` — the real package name — not `@sms/...`. `@sms` is only the
**file-placement alias** `saasaloy.json` uses to resolve a module's `files[].target` when copying
files onto disk; it is not a TypeScript or Vite import alias.

`createSms(env)` takes the **whole env**, not one secret, because which key the active provider
reads is precisely what a route isn't supposed to know. It throws immediately when `SMS_PROVIDER`
is unset or names a provider that isn't installed, with the registered names in the message.

**Recipients must be E.164** — a `+`, the country code, then the national number, digits only
(`+14155550123`). The core validates the shape and rejects anything else as `invalid_message`
before a provider is reached. It does **not** normalize: turning `(415) 555-0123` into E.164 needs
a ~145 kB phone-number library and a default country this package can't know. Normalize at your
edge — a form, a signup handler — and store E.164.

### Awaiting vs. `waitUntil` — decide per message

The package **never retries**, deliberately: a retry loop inside a request handler holds the
Worker's response open. Choose how a failure should behave instead.

Both branches below sit inside a route handler like the one above, so `c` is the Hono context.

```ts
import { SmsError } from "@repo/sms"; // alongside `createSms` — needed by the catch below

const texts = createSms(c.env);

// Non-critical (a shipping notification): don't make the user's request wait on it, and
// don't let an SMS outage fail an operation that already succeeded.
c.executionCtx.waitUntil(
  texts.send({ to: user.phone, ...shipped(props) }).catch((error) => console.error("sms failed", error)),
);

// Critical (a verification code): the caller is staring at a "enter the code" screen and
// must be told it never arrived.
try {
  await texts.send({ to: user.phone, ...verificationCode(props) });
} catch (error) {
  if (error instanceof SmsError && error.retryable) return c.json({ error: "try_again" }, 503);
  throw error;
}
```

The lean is further toward `await` than it is for email. An SMS is usually the *only* channel
carrying its payload — nobody has a second copy of a one-time code — so a silent failure inside
`waitUntil` strands the user on a screen waiting for something that will never come.

## Env checklist (`add sms` prints this)

| Var | What | Required |
|---|---|---|
| `SMS_PROVIDER` | Which registered provider sends: `console`, … | **Always**, even with one provider installed |
| `SMS_FROM` | Default sender — an E.164 number, a short code, or an alphanumeric id | Only if your provider needs one |

`SMS_PROVIDER` has **no default** on purpose. A default would mean a production deploy can
silently stop sending, or a test run can silently start — both are worse than a startup error that
names the providers you actually have.

`SMS_FROM` is optional, which is where this differs from `EMAIL_FROM`. Whether a sender is required
is a fact about the *provider's configuration*, not about the message: a Twilio account sending
through a Messaging Service assigns the sender itself, and one sending from a purchased number
can't send without it. No core-level rule states that correctly, so the core resolves `SMS_FROM`
when it's there, passes `from` through untouched, and leaves "I need a sender" to the provider that
actually needs one.

**`from` is never validated.** `to` is checked against E.164 and `from` isn't, because a sender is
legitimately a phone number, a short code (`61011`), an alphanumeric sender id (`ACME`) or a
messaging-pool id — the rule that governs `to` would reject three of the four. Alphanumeric sender
ids are also not accepted everywhere (the US and Canada don't take them at all), which is one more
reason the answer belongs to the provider.

## Templates: `(props) => { body }`

A template is a plain function in `src/templates/`. There is no registry and no discovery step —
import the one you want. `src/templates/verification-code.ts` is the worked example; copy it to
start a new one.

```ts
import type { SmsTemplate } from "../provider";

export interface ShippedProps { orderId: string; trackingUrl: string }

export const shipped: SmsTemplate<ShippedProps> = ({ orderId, trackingUrl }) => ({
  body: `Order ${orderId} is on its way. Track it: ${trackingUrl}`,
});
```

**There is no `render.ts`, and there shouldn't be.** `@repo/email` has an entire rendering module —
an escaping `html` tag, a `layout` wrapper, a plaintext deriver — and none of it has an analogue
here. An SMS body is plain text all the way to the handset: no markup for a caller's value to
inject, no layout to wrap it in, no alternative part to derive. Copying that module across would be
symmetry for its own sake.

What replaces escaping as the thing to be careful about is **length**, because on this channel
length is money.

## Segment counting: what a body actually costs

Nothing is truncated and nothing is blocked. The core measures and reports; what to do about a
three-part message is a product decision it has no business making. Every resolved message carries
`estimatedSegments`, and the same function is exported for use before a send:

```ts
import { countSegments, measureSegments } from "@repo/sms";

countSegments("Your code is 123456");
// 1

measureSegments("Your code is 123456 ✅");
// { encoding: "ucs-2", units: 22, segments: 1 }
```

The rules, which are not the ones most people carry in their head:

| | Single message | Each part of a longer one |
|---|---|---|
| **GSM-7** (plain Latin text) | 160 septets | **153** |
| **UCS-2** (anything else) | 70 characters | **67** |

- **The concatenated figures are lower** because a User Data Header telling the handset how to
  reassemble the parts eats the difference. 161 characters is two parts of 153, not 160 + 1.
- **Nine characters cost two septets each** — `^ { } \ [ ~ ] |` and `€`. They are still GSM-7, but
  each is sent as an escape plus the character. This is why a length-only estimate is silently
  wrong, and `€` makes it wrong for any European price string.
- **One character outside GSM-7 re-encodes the whole message.** A single emoji, a curly quote
  pasted from a word processor, or a Cyrillic name drops the entire body to UCS-2 and its
  70-character budget. Smart quotes are the usual culprit and the hardest to spot.
- **A two-unit character never straddles a part boundary.** An escape pair or a UTF-16 surrogate
  pair moves whole into the next part, leaving a unit unused behind it — so 153 tildes is three
  parts, not two. The counter models this.

**Known inaccuracy: toll-free senders.** A US/CA toll-free number uses a 16-bit concatenation
reference and gets **152/66** per part instead of 153/67, so a long message from one can need one
part more than reported. The core is handed a `from` it deliberately doesn't parse, so it cannot
know the sender's type. Documented rather than modelled; if it matters to your billing, check
against your provider's own figure.

Providers are not asked to report their own count, and `SmsResult` has no field for one. Twilio
returns `num_segments: 0` for anything sent through a Messaging Service — the sender isn't assigned
yet — so a provider-reported number is missing in exactly the case a pooled sender is used. Two
numbers that legitimately disagree is worse than one estimate whose name says it's an estimate.

## Providers

| Module | Provider name | Needs | Adds |
|---|---|---|---|
| `sms-console` | `console` | nothing | nothing — logs the message and its segment count |

Installing another provider is the same command again (`saasaloy add sms-<provider>`); the codemod
appends to the `providers` array idempotently, so several can be registered at once and
`SMS_PROVIDER` picks between them per environment.

There is no Cloudflare-native provider and there won't be one: Cloudflare has no SMS product, and
its own Workers documentation points at Twilio over `fetch`. `sms` is the first capability where
every provider is a third-party HTTP call.

### Local development

Use `sms-console` and `SMS_PROVIDER=console`. Nothing sends, the message goes to the Worker's log
with its segment count, and `send()` returns a synthetic `console-<uuid>` message id. Because the
provider is registered through the same registry, the code path under test is the real one — only
the transport differs.

This provider earns its place more than `email-console` does. Email's alternative is onboarding a
domain you probably already own; the alternative here is buying a number and registering an A2P
10DLC campaign, which takes days and costs money before the first message goes anywhere.

> [!WARNING]
> **Never set `SMS_PROVIDER=console` in a deployed environment.** Writing the message to the log is
> the whole point of this provider, so it logs the body in full — and on this channel the body is
> typically a **live one-time code**, printed next to the phone number it was issued to. In
> production that is a working second factor sitting in your log retention, readable by anyone with
> dashboard access. The provider is for `wrangler dev` and tests; production selects a real one.

## Compliance: what the provider handles and what you owe

This is legal exposure, not a feature gap, so it is spelled out rather than left to be discovered.
The capability's job is to make the outcome legible; almost everything else is yours.

**Handled below you.** STOP, UNSTOP and HELP are handled at the carrier and provider level — a
recipient who replies STOP is added to an opt-out list you don't maintain, and subsequent sends
fail. That surfaces as `SmsError` with `code: "opted_out"`. Treat it as a standing instruction:
never retry it, and stop trying to reach that number until something changes outside your system.

**Yours, and not built here.** All of these need persistence, so they are application concerns and
explicit non-goals of this capability:

- **Consent.** Record who agreed to be texted, when, and to what — before the first message. For
  marketing traffic in the US that is a legal requirement (TCPA), not a nicety.
- **Quiet hours.** Many jurisdictions restrict marketing messages by local time. Local time means
  the *recipient's*, which means you need to know their region.
- **Your own opt-out record.** The provider's list stops sends; it does not tell your product to
  stop trying, stop counting, or stop showing "we texted you".
- **Registration.** US A2P 10DLC and short codes require campaign registration with the carriers.
  No CLI can perform or verify it, exactly as domain onboarding isn't performed for `email`.

**Transactional messages — a verification code, a delivery alert — carry much lighter obligations
than marketing ones.** If you are unsure which one you're sending, you're sending marketing.

## Not proven yet

Three parts of the interface ship as *contracts*, not as tested behavior, because nothing installed
today can raise them: `sms-console` needs no sender, has no account, and accepts any body length.

- **Optional `from`** — nothing shipped ever says "I need a sender".
- **`account_error`** — no shipped provider has an account to fail.
- **`message_too_long`** — no shipped provider has a cap.

They are shaped against Twilio's real API rather than guessed at, and the first real provider
module exercises all three against Twilio's free test credentials and magic numbers. Until then,
treat them as designed-but-unexercised: if you write a provider and one of them fits badly, say so
rather than working around it.

## Writing a custom provider in your own project

You don't need a registry module to add a provider — a file and a line will do. Implement
`SmsProvider` in `packages/sms/src/providers/<name>.ts`.

**Read this before you write the `catch` block.** `retryable` works differently here than it does
in `@repo/email`, and it is the one thing a provider copied from that skill gets wrong:

- Email's worked provider returns `retryable: true` on a request timeout, because the request may
  never have left and a duplicate email is a minor annoyance.
- **The same timeout on SMS may already have been accepted and billed.** A retry buzzes the
  person's phone a second time, charges you twice, and — for a one-time code — issues a second code
  that invalidates the one they are already typing. Twilio's message-create has no idempotency key,
  so the caller can't make the retry safe either.
- So: **an ambiguous failure is `retryable: false`, and a timeout is explicitly non-retryable.**
  `retryable: true` is only for failures where the provider positively confirmed it did **not**
  accept the message — a 429, or a 5xx.
- **The core enforces this.** `SmsError` accepts `retryable: true` on `rate_limited` and
  `provider_error` only, and silently drops it on any other code. It does not throw: replacing your
  real failure with a second error about the error constructor would be worse. Don't rely on the
  coercion — set it correctly, and know that it's there.

```ts
import { SmsError } from "../provider";
import type { ResolvedSmsMessage, SmsEnv, SmsProvider, SmsResult } from "../provider";

export function twilio(): SmsProvider {
  return {
    name: "twilio", // the value SMS_PROVIDER must hold
    async send(env: SmsEnv, message: ResolvedSmsMessage): Promise<SmsResult> {
      // This provider sends from a number, so it needs one. That check belongs here and
      // not in the core: a provider routing through a messaging service wouldn't want it.
      if (!message.from) {
        throw new SmsError("invalid_message", "twilio: set SMS_FROM, or pass `from`.");
      }

      const accountSid = String(env.TWILIO_ACCOUNT_SID ?? "");
      let response: Response;
      try {
        response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              authorization: `Basic ${btoa(`${accountSid}:${String(env.TWILIO_AUTH_TOKEN ?? "")}`)}`,
            },
            // One recipient per request: this API takes a single `To`. Loop in the
            // provider and decide what a partial failure means for your project.
            body: new URLSearchParams({
              To: message.to[0] ?? "",
              From: message.from,
              Body: message.body,
            }),
            // Bound the call. Without this a hung provider holds the Worker's response
            // open until the platform kills it, and the caller gets no `SmsError` at all.
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch (cause) {
        // The request never completed — a timeout, DNS, TLS, a dropped connection. NOT
        // retryable, unlike the email equivalent: the message may already have been
        // accepted, and a second send is a second charge and a second buzz.
        throw new SmsError("provider_error", "twilio: request failed or timed out", {
          retryable: false,
          cause,
        });
      }

      const body = (await response.json().catch(() => ({}))) as { sid?: string; code?: number };

      if (!response.ok) {
        throw new SmsError("provider_error", `twilio: ${response.status}`, {
          // Confirmed non-acceptance: safe to retry.
          retryable: response.status === 429 || response.status >= 500,
          providerCode: body.code === undefined ? String(response.status) : String(body.code),
        });
      }

      // Don't take the cast's word for it — `SmsResult.messageId` is a string, and
      // returning `undefined` here would break that contract silently.
      if (!body.sid) throw new SmsError("provider_error", "twilio: response carried no sid");
      return { messageId: body.sid };
    },
  };
}
```

Then register it by hand in `src/index.ts`:

```ts
// Add the import; `defineSms` is already imported at the top of this file.
import { twilio } from "./providers/twilio";

// Then add the call to the existing array literal — don't replace the line's shape.
export const sms = defineSms({ providers: [twilio()] });
```

Contract notes:

- The core hands you a **resolved** message: `to` normalized to an array and validated as E.164,
  `from` resolved from `SMS_FROM` (still possibly `undefined`), `estimatedSegments` attached. Don't
  re-implement any of that, and don't re-validate `to`.
- Map vendor failures onto the codes a provider may raise — `invalid_number`, `unroutable`,
  `opted_out`, `account_error`, `rate_limited`, `message_too_long`, `provider_error` — and keep the
  vendor's own code in `providerCode`. (`invalid_message` is the core's, for a message that never
  reached you; raise it yourself only for a precondition of *your* provider, like the missing
  sender above.) Map only codes you've actually seen; let the rest fall through to `provider_error`.
- **Sender-not-owned, empty balance and missing geo permission are all `account_error`.** They read
  like three different problems and they aren't: no request handler branches between them, they are
  all pages for an operator, and `providerCode` keeps the distinction for whoever fixes it.
- The core is a backstop, not a substitute. Anything that escapes your `send()` without being an
  `SmsError` is wrapped as `provider_error` / `retryable: false`, with the original kept in `cause`.
- Never retry, sleep, or queue inside `send()`. The caller decides.
- Read secrets off the `env` you're handed. `process.env` does not exist on Workers.
- Any npm dependency belongs in `packages/sms/package.json`, not in another workspace — only this
  package touches provider SDKs (ADR 0020). A REST call over `fetch` needs none at all, which is
  how every provider so far avoids the question.

## Boundaries to honor

- **`export const sms = defineSms({ providers: [] })` stays in exactly that shape** — a real array
  literal, never omitted. It is the patch point every provider module appends to; without it a
  provider install fails silently.
- **Only `packages/sms` talks to a provider's SDK or endpoint.** Everything else imports
  `@repo/sms` (ADR 0020).
- **`SMS_PROVIDER` never gets a default**, in code or in an example.
- **No retry inside the package**, and no retry in a caller on an ambiguous failure. Retry belongs
  to a queue, and only on `retryable`.
- **Never truncate a body to fit a segment.** Measure it, tell someone, and send what you were
  given.
- **Templates stay plain functions** returning `{ body }` — no rendering framework, and no
  `render.ts`.
