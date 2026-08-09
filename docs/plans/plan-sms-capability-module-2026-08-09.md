# Plan — `sms` capability module

**Grilled:** 2026-08-09

**Issue:** [#67](https://github.com/mimukit/saasaloy/issues/67) · **Created:** 2026-08-09 · **Status:** hardened

## Context

Generated apps can send email and cannot send SMS. A project that wants a verification code, a delivery alert, or a 2FA challenge on a phone has nothing to reach for.

`modules/email` is the template, and copying it closely is the point: a contributor who has written an `email-<provider>` module should write an `sms-<provider>` one without learning a second set of conventions. The pieces carry over — `provider.ts` for the contract and the one normalized error, `define.ts` for the registry plus everything true of *every* provider, `index.ts` as the `defineX({ providers: [] })` barrel the `plugin-array` codemod patches, and a provider module that is one file and one patch. ADR 0005, ADR 0013, ADR 0019 and ADR 0020 apply unchanged, and ADR 0001's 2026-08-04 amendment already names *"sending an SMS"* as inside the stateless-multi-provider carve-out, so no new ADR is needed to justify the shape.

Scope matches issue #67 as filed: **`sms` and `sms-console`.** `sms-twilio` is a follow-up. What the grill changed is not the scope but the *grounding* — the error union, the segment algorithm and the sender decision below are all shaped by Twilio's real API rather than by analogy with `email`, so the follow-up inherits a contract that was designed against a vendor instead of one that has to be renegotiated when the first vendor arrives.

Success: `saasaloy add sms sms-console` gives a project a working sender in `wrangler dev` with no account and no purchased number; a caller writing `createSms(c.env).send({ to, body })` never learns which provider is active; and `packages/sms` reports what a message will cost in segments before it goes.

## What the grill established

Four findings from Twilio's published API and the GSM 03.38 spec. None of them ships code in this issue; all of them shaped a decision below.

| Finding | Consequence |
|---|---|
| **Cloudflare has no SMS product.** Its own Workers docs point at Twilio over `fetch`. | `sms` is the first capability with no Cloudflare-native provider. Providers stay dependency-free — a REST call, no vendor SDK — exactly as `email-cloudflare` is. |
| **Segment math is not 160/70.** A *single* segment holds 160 GSM-7 septets or 70 UCS-2 characters; a *concatenated* part holds **153** or **67**, because the User Data Header consumes the difference. Nine characters — `^ { } \ [ ~ ] |` and `€` — cost **two** septets each. Toll-free US/CA parts hold 152/66. | Issue #67's Q2 states the wrong thresholds, and so did this plan's first draft. `segments.ts` implements the real rule; toll-free stays a documented inaccuracy. |
| **Twilio returns `num_segments: 0`** when a message is sent through a Messaging Service, because no sender is assigned yet. | Provider-reported segment counts are unavailable in precisely the pool case, which settles [who owns the count](#design-decisions-settled). |
| **Twilio test credentials plus magic numbers** exercise the live API with no purchased number and no charge — `+15005550006` as a valid `From`, and five `To` numbers returning documented errors (21211 invalid, 21612 unroutable, 21610 opted-out, 21614 can't-receive, 21408 no-international-permission). | The follow-up has a free, complete verification harness. It also surfaced 21408, a real failure with no home in the first draft's union. |

Sources: [test credentials](https://www.twilio.com/docs/iam/test-credentials) · [Messages resource](https://www.twilio.com/docs/messaging/api/message-resource) · [error 21617](https://www.twilio.com/docs/api/errors/21617) · [GSM-7 encoding](https://www.twilio.com/docs/glossary/what-is-gsm-7-character-encoding) · [GSM 03.38](https://handwiki.org/wiki/GSM_03.38) · [Cloudflare Workers + Twilio](https://developers.cloudflare.com/workers/tutorials/github-sms-notifications-using-twilio/)

## Retry means something different here

Email's core tells a provider to set `retryable` honestly, and `saasaloy-email`'s worked provider returns `retryable: true` on a request timeout — the request may never have left, so re-sending is right, and a duplicate email is a minor annoyance.

The same timeout on SMS may have been accepted and billed. A retry sends a second message, the person's phone buzzes twice, and the second code invalidates the first. Twilio's message-create has no idempotency key, so a caller cannot make the retry safe.

**An ambiguous failure is `retryable: false`, and a timeout is explicitly non-retryable.** `retryable: true` is reserved for failures where the provider positively confirmed it did not accept the message.

**The core enforces this rather than documenting it.** Only `rate_limited` and `provider_error` may carry `retryable: true`; the `SmsError` constructor drops a `true` on any other code. Guidance alone would not survive the first provider author who copies the email skill's worked example, and that copy ships a double-send. `provider.ts` carries the rationale so the constraint doesn't read as an oversight.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Architecture** | Capability core + provider modules, copying `email`'s file split. No CLI or schema work — every patch kind already exists. |
| **Scope** | **`sms` + `sms-console`**, matching #67 as filed. `sms-twilio` is a follow-up issue that inherits this contract and the test-credential harness. |
| **`dependsOn`** | `sms` → `["api"]`, same as `email` and for the same mechanical reason: it patches `apps/api/package.json`, and a module cannot patch a file that isn't there (ADR 0018's reasoning). `sms-console` → `["sms"]`. |
| **Recipient format** | **Validate E.164 shape in the core, never normalize.** `/^\+[1-9]\d{1,14}$/`, rejected as `invalid_message`. Real normalization needs `libphonenumber-js` (~145 kB) and a default country the capability cannot know; zero runtime dependencies is an acceptance criterion. |
| **Sender format** | **`from` is not validated at all.** An alphanumeric sender id (`ACME`), a short code and a pool id are all legitimately non-E.164, so the rule that governs `to` cannot govern `from`. `provider.ts` comments the asymmetry so it reads as chosen. |
| **Sender requirement** | **`from` is optional in the core**, unlike `EMAIL_FROM`. The requirement is *dynamic per provider config* — Twilio needs a sender unless `TWILIO_MESSAGING_SERVICE_SID` is set — so no core-level rule states it correctly. The core resolves `SMS_FROM` when present and passes `from?: string` through; a provider that needs one raises `invalid_message` itself. |
| **Templates** | A thin `SmsTemplate<Props> = (props) => SmsContent` type and one worked example. **No `render.ts`** — no markup to escape, no layout to wrap, no plaintext to derive. Email's entire rendering module has no analogue. |
| **Segments** | **The core computes and reports; it never truncates and never blocks.** Truncation is data loss nobody asked for; blocking is a policy that varies by project. |
| **Segment ownership** | **`estimatedSegments` on `ResolvedSmsMessage`, nothing on `SmsResult`.** The name carries the caveat. A provider-reported figure is absent for `console` and `0` for pool sends, and shipping both invites two numbers that legitimately disagree. |
| **Segment fidelity** | **Full.** GSM-7 base plus the extension table at two septets, 160/153 and 70/67 thresholds, and the rule that an escape pair (or a UTF-16 surrogate pair) never straddles a part boundary. A length-only approximation is silently wrong for any body containing `€ [ ] { } \ ~ ^ |`, which is the failure a cost estimate must not have. |
| **Provider selection** | `SMS_PROVIDER` **required**, no default, unknown value throws. Follows `email`, not `logger` — a send that silently stops or silently starts is the failure mode, and unlike logging, an SMS outage is not made worse by a loud boot error. |
| **Error taxonomy** | Eight members: `invalid_number`, `unroutable`, `opted_out`, `account_error`, `rate_limited`, `message_too_long`, `invalid_message` (core-raised), `provider_error`. Sender-not-owned, insufficient balance and missing geo permission collapse into **`account_error`** — all three are operator alerts rather than things a request handler branches on, and `providerCode` keeps the vendor's own code for the operator who has to fix it. |
| **Body length cap** | **Provider-side.** 1600 is Twilio's channel limit, not an SMS protocol limit (the protocol caps at 255 concatenated parts), so a core-side constant would hardcode one vendor's number into a provider-agnostic package. `message_too_long` stays in the union as a provider-raised code, distinct from the core's `invalid_message`. |
| **`retryable`** | Core-enforced, two codes only. See [above](#retry-means-something-different-here). |
| **Delivery receipts and inbound** | **Out of v1, and the interface needs no room now.** Both arrive as inbound webhooks — a route concern needing `api`, persistence and per-provider signature verification, not a `send()` concern. The only room they are owed is `SmsResult.messageId`, the join key they will key on, which it already carries. |
| **Compliance** | **Surfaced, not built.** Carrier-level STOP/HELP handling and the opt-out list live with the provider; the capability's job is to make the result legible, which is what `opted_out` does. Consent capture and quiet hours need persistence and are application concerns — non-goals, documented loudly in the skill because they are legal exposure rather than a feature gap. |
| **Console provider** | **Genuinely useful, not a copied convention.** Its substitute is a number purchase plus A2P 10DLC registration — a heavier gate than email's domain onboarding, not a lighter one. Same "never in production" warning, with a sharper reason: the body it logs is typically a live one-time code. |
| **Wiring recipe** | **The worked template is the recipe** — a verification-code send from a route, end to end against `sms-console`. No `auth` 2FA recipe: it needs a Better Auth plugin this repo does not install, and untested code in a runbook is worse than no runbook. |
| **Naming** | `consoleSms()` factory, for the reason `consoleEmail` exists — the generated import must not shadow the global `console`. The provider *name* stays `"console"`. |
| **Provider skills** | None. Per `create-provider`, provider modules ship no skill; `sms-console` gets a row in `saasaloy-sms`'s provider table. |
| **New ADRs** | **None.** ADR 0001's amendment already names SMS; ADR 0018's reasoning covers `dependsOn: ["api"]`. If the follow-up promotes the no-Cloudflare-provider point or the `retryable` inversion into a rule for future capabilities, that becomes an ADR then. |

## Contracts that ship unexercised

Three decisions above cannot be raised by anything this issue ships, because `sms-console` needs no sender, has no account and accepts any body length. They are contracts, not tested behaviour, and the plan says so rather than letting a green QA pass imply otherwise:

- **optional `from`** — nothing shipped ever raises "I need a sender"
- **`account_error`** — no shipped provider has an account to fail
- **`message_too_long`** — no shipped provider has a cap

All three are the first thing the `sms-twilio` follow-up exercises, against the magic numbers. Deferring them is the accepted cost of console-only scope; discovering them silently after a project has built on the interface is not, which is why they are named here and in the skill.

## Approach

### What it reuses

| Existing thing | Used for |
|---|---|
| `modules/email/registry-item.json` | The capability descriptor shape — `scaffolds` + `envVars` + `agent.skills` |
| `modules/email/files/src/{provider,define,index}.ts` | The three-file split, the comment voice, and the exact `export const x = defineX({ providers: [] })` barrel shape |
| `modules/email/files/{package.json,tsconfig.json}` | The `clean` script with exact-pinned `rimraf`, and the workers-types tsconfig |
| `modules/email-console/` | The whole provider-module template: descriptor, one file, one patch |
| `packages/cli/src/lib/patch/ts-module.ts` | `plugin-array` registration, unchanged |
| `packages/cli/src/lib/patch/` — `package-json-dependency` | The `apps/api/package.json` patch, unchanged |
| `.agents/skills/create-provider/SKILL.md` | The authoring rules; gains an `sms` mode |
| `pnpm play:init` → `.dev/playground` | The verification harness |

### Phase 1 — `packages/sms` core

Scaffold `packages/sms` with the `@sms` alias, mirroring `email`'s `scaffolds` block.

- `files/package.json` → `@repo/sms`, `"clean": "rimraf -g dist \"*.tsbuildinfo\""`, **zero runtime dependencies**, exact-pinned dev deps matching `email`'s.
- `files/tsconfig.json` — copied from `email`'s.
- `files/src/provider.ts` — `SmsEnv`, `SmsMessage`, `ResolvedSmsMessage`, `SmsResult`, `SmsProvider`, `SmsContent`, `SmsTemplate`, `SmsErrorCode`, `SmsError`. No vendor imports. Carries three rationale comments: the `retryable` constraint, the `to`/`from` validation asymmetry, and why there is no delivery-receipt surface.
- `files/src/segments.ts` — encoding detection and part counting, per [the real rule](#what-the-grill-established). Exported, because a caller wanting to warn before sending needs the same function the core uses. The toll-free 152/66 case is a comment, not an option.
- `files/src/define.ts` — `defineSms`, provider selection, and resolution done once: E.164 validation of every recipient, `to` normalized to an array, `from` resolved from `SMS_FROM` when present and passed through unvalidated, `estimatedSegments` attached.
- `files/src/index.ts` — the barrel and patch point, in exactly the shape `insertIntoPluginArray` requires, with the same "keep this line in exactly this shape" comment `email`'s barrel carries:

  ```ts
  export const sms = defineSms({ providers: [] });
  export function createSms(env: SmsEnv) { return sms.create(env); }
  ```

- `files/src/templates/verification-code.ts` — the worked example, chosen because it is the case where the length budget actually bites.
- `files/src/providers/.gitkeep` — the drop target.

Descriptor: `dependsOn: ["api"]`, the `apps/api/package.json` dependency patch, `envVars: { SMS_PROVIDER, SMS_FROM }` in the descriptors' established voice.

**Verify:** `pnpm typecheck` clean in a playground with `sms` added; workspace has zero runtime deps; `SmsError` refuses `retryable: true` on a code that may not carry it.

### Phase 2 — `sms-console`

One file into `@sms/providers/console.ts`, one `plugin-array` patch on `packages/sms/src/index.ts`. `dependsOn: ["sms"]`.

Logs the resolved message with its `estimatedSegments` and returns `console-<uuid>`. Same explicit "never select this in a deployed environment" warning as `email-console`, with the SMS-specific reason: the body it logs is usually a live one-time code.

**Verify:** `saasaloy add sms sms-console` twice leaves one `consoleSms()` in the providers array with comments intact.

### Phase 3 — the skills

- **`modules/sms/skills/saasaloy-sms/SKILL.md`** (ADR 0014 naming, ADR 0015 symlink), covering: sending from a route; `await` vs `waitUntil` per message, as `saasaloy-email` does; the env checklist; the template convention and why there is no `render.ts`; **segment counting** — the real thresholds, what an extension character costs, and the toll-free inaccuracy; the provider table; the **compliance** section — consent, STOP, quiet hours, what a provider handles and what the project owes; § "Writing a custom provider in your own project" leading with the `retryable` constraint and the fact that the core enforces it; and a short **"not proven yet"** note naming the three [unexercised contracts](#contracts-that-ship-unexercised).
- **`.agents/skills/create-provider/SKILL.md` gains an `sms` mode** alongside `email`. The `retryable` inversion and the unvalidated `from` both differ from `email` in ways a copied provider would get wrong.

### Phase 4 — verification

- `saasaloy add sms sms-console` on a clean playground resolves `api` first, then `sms`, then the provider; run twice and confirm idempotence.
- `pnpm deps:verify` clean.
- Under `wrangler dev` with `SMS_PROVIDER=console`: a send logs the message; a non-E.164 recipient throws `invalid_message` before any provider is reached; an alphanumeric `from` passes through untouched.
- Segment cases, which are the phase's real content: 160 plain characters → 1; 161 → 2; 160 tildes → 2 (extension characters at two septets each); one emoji anywhere → UCS-2 thresholds; a body whose 153rd septet would be an escape → the pair moves to the next part.
- QA doc under `docs/qa/`.

### Rejected alternatives

- **Ship `sms-twilio` in this issue.** Argued for during the grill on the strength of the free test-credential harness, and rejected on scope. The cost is recorded in [Contracts that ship unexercised](#contracts-that-ship-unexercised) rather than left implicit.
- **Don't build `sms` yet.** Worth stating plainly: nothing in the repo references SMS, `auth` has no phone or 2FA surface, and there is no `notifications` capability — this capability ships with **zero consumers**, which `email` never did. Rejected because the registry's value is having the module ready before the project that needs it.
- **Port `render.ts` and a full template system.** No markup, no escaping, no layout, no plaintext derivation. Copying it would be symmetry for its own sake.
- **Normalize phone numbers with `libphonenumber-js`.** ~145 kB in every Worker, and normalization needs a default country the capability cannot know.
- **Truncate at the segment boundary.** Silent data loss, and the truncation point is a product decision.
- **A length-only segment estimate.** Cheaper and silently wrong on nine common characters — including `€`, which any European price string carries.
- **Mirror email's `retryable: true` on timeout.** It is the double-send, and it costs money.
- **Keep `sender_not_allowed`, `insufficient_funds` and `not_permitted` as separate codes.** All three are operator alerts with the same caller response; `providerCode` preserves the distinction for whoever fixes it.
- **A core-side 1600-character cap.** Twilio's number, not the protocol's.

## Non-goals

- **`sms-twilio` or any real provider.** The follow-up issue, which inherits this contract and the test-credential harness.
- **Delivery receipts and inbound messages.** Webhook routes, persistence and signature verification — a separate capability-sized piece of work. `SmsResult.messageId` is the join key it will need.
- **Consent capture, opt-in records, and quiet hours.** Application concerns needing storage. Documented as the project's obligation; not built.
- **An opt-out list in the capability.** The carrier and the provider own it. `opted_out` is how it surfaces.
- **Phone number normalization or country inference.** Callers pass E.164.
- **Toll-free segment accuracy.** The 152/66 case needs sender-type knowledge the core does not have. Documented, not modelled.
- **MMS, media attachments, and WhatsApp.** Different message shapes and different provider surfaces.
- **Short-code or A2P registration automation.** Not something a CLI can perform or verify, exactly as domain onboarding isn't for `email`.
- **Wiring `auth` for phone-based 2FA.** Needs a Better Auth plugin this repo does not install; its own issue.
- **A queue or retry mechanism.** The package never retries, for the reason `email` doesn't — and here retrying is worse.
- **`saasaloy doctor` checks** for `SMS_PROVIDER`. Owned by #47.
