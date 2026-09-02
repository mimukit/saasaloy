# Plan: Plunk email provider module (#65)

Grilled: 2026-09-01

## Context

Issue #65 asks for a third provider behind the `EmailProvider` interface, so a generated app sends through Plunk with `EMAIL_PROVIDER=plunk`. Plunk has a plain HTTP send API, so the provider is one `fetch` call with no SDK, no Workers binding, and no new dependency. That keeps ADR 0020 (capability owns vendor packages) and the zero-runtime-dependency note in `provider.ts` true. Success is `saasaloy add email-plunk` installing cleanly in `.dev` and a real send verified against a Plunk account.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| API target | `POST https://next-api.useplunk.com/v1/send` with `Authorization: Bearer <secret key>`. Confirmed against docs.useplunk.com on 2026-09-01. The provider targets this current public API; Plunk does not version the path beyond `/v1`. |
| Secret naming | `PLUNK_API_KEY`, holding the secret key (`sk_...`). Plunk calls it the "secret key", but the sibling descriptors use `<VENDOR>_API_KEY`, and the envVars text spells out that it must be the `sk_` key, not the `pk_` key. Set in `apps/api/.dev.vars` for dev and `wrangler secret put PLUNK_API_KEY` for production. No `saasaloy env` change: envVars docs are the existing surface. |
| Self-hosting | Support it now, cheaply: optional `PLUNK_API_URL` env var, defaulted to `https://next-api.useplunk.com`. One `??` in the provider; no second code path. |
| Options bag | `plunk()` is argument-free. Both knobs (key, base URL) are env vars, which matches how `EmailEnv` is designed to work. `email-cloudflare` takes options only because its binding name is code-level config; Plunk has no such thing. |
| Marketing side effect | Omit `subscribed` from the payload. Plunk upserts every recipient as a contact regardless; a new contact defaults to unsubscribed, and an explicit `subscribed: false` would flip an already-subscribed contact and emit an unsubscribe event. Omission is the only non-destructive choice. |
| Payload mapping | `to: message.to` (Plunk accepts an array of address strings), `subject`, `body: message.html`, `from: message.from`, `reply: message.replyTo` (omitted when unset). Plunk has no plaintext field, so the core-derived `text` is dropped; a comment in the provider says so. |
| messageId | The success response is `{ success, data: { emails: [{ email: <id>, ... }] } }`. Return the first `emails[].email` id. Multi-recipient sends get one id per recipient, and the `EmailResult` contract carries exactly one; the first is the honest representative. |
| Error mapping | Map on HTTP status first, then refine from the JSON `error.code`, keeping the raw code in `providerCode`. 429 → `rate_limited`, retryable. Payload/attachment size rejection → `too_large`, not retryable. 401/403/404/422 → `provider_error`, not retryable (bad key, disabled project, schema failure; resending the same bytes cannot succeed). 5xx and a thrown `fetch` (network) → `provider_error`, retryable. Unknown falls through to `provider_error`, not retryable, same rationale as the Cloudflare table. |
| Missing key | `PLUNK_API_KEY` unset throws `EmailError("provider_error", ...)` before the fetch, with a message naming the env var and where to set it, mirroring the missing-binding guard in `cloudflare.ts`. |

## Approach

Mirror `email-cloudflare` and `email-console` exactly; the `create-provider` skill defines the shape. Reuse: the `EmailError`/`normalize` pattern and error-table comment style from `modules/email-cloudflare/files/cloudflare.ts`, the descriptor shape and `plugin-array` patch from both siblings, and the envVars voice from `modules/database-postgres/registry-item.json`.

### Phase 1: module descriptor and provider file (built 2026-09-01)

- `modules/email-plunk/registry-item.json`: `type: "saasaloy:feature"`, `dependsOn: ["email"]`, empty `dependencies`, the `plugin-array` patch appending `plunk` into `providers[]` of `packages/email/src/index.ts`, `files` targeting `@email/providers/plunk.ts`, and `envVars` for `PLUNK_API_KEY` (required) and `PLUNK_API_URL` (optional, self-hosting) in the what-it-is / where-to-get-it / what-breaks voice.
- `modules/email-plunk/files/plunk.ts`: `plunk(): EmailProvider` with `name: "plunk"`, the payload mapping, the missing-key guard, and the status+code error table per the decisions above. Header comment covers the contact-upsert side effect, the dropped `text`, and the self-hosted base URL.
- No `package.json`, so no `clean` script applies (matches `email-cloudflare`).

### Phase 2: install verification and lint (built 2026-09-01)

- `saasaloy add email-plunk` in `.dev`; re-run to prove idempotency of the codemod and file copy.
- `pnpm lint` (all four passes cover `modules/*/files/**`) and the repo test/build gate.

### Phase 3: docs and end-to-end proof

- Update `modules/email/skills/saasaloy-email/SKILL.md`: the frontmatter provider list, the `EMAIL_PROVIDER` table row, and the provider-selection prose that enumerates `cloudflare`/`console`.
- Update the provider-module line in `modules/README.md` (line 36 enumerates the provider modules).
- A real send through a Plunk account from the `.dev` app; record the result (message id, inbox screenshot or headers) on the PR.

## Grilled decisions (2026-09-01)

1. `sender_not_verified`: probe during the mandated e2e step. Send once with an unverified `from`, read the real `error.code`, and add the table row before the PR merges.
2. #59 (react-email render engine): confirmed independent. The issue states the provider layer needs no change and `ResolvedEmailMessage` keeps its shape.
3. Automated testing stops at lint, typecheck, and the idempotent `saasaloy add` check. The real send stays manual and is recorded on the PR.
4. `Idempotency-Key`: out of scope here. A separate issue covers email idempotency as its own feature; the provider's header comment notes the double-send risk of a naive retry.
5. No pre-validation of Plunk quirks (newline in `subject`, 998-char header values). Plunk's 422 surfaces as `provider_error` with the field detail from `error.errors[]` in the message.
6. Multi-recipient sends return the first `emails[].email` id as `messageId`. The provider comment says the remaining ids live in Plunk's dashboard.

## Non-goals

- No change to the `EmailProvider` interface, the core resolver, or existing providers.
- No template/campaign/contact/track Plunk endpoints; transactional `/v1/send` only.
- No attachments support (the interface has no attachment field).
- No automated integration test against the live Plunk API.
