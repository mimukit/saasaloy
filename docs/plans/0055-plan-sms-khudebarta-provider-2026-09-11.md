# Plan: `sms-khudebarta` provider module

Grilled: 2026-09-11

## Context

`packages/sms` ships with one provider, `sms-console`, which sends nothing. A project using the capability in Bangladesh has no way to actually deliver a message. [Khudebarta](https://khudebarta.com/) is a Bangladeshi bulk-SMS gateway with masking and non-masking routes, and its `/sendtext` endpoint is a single JSON POST — exactly the shape `SmsProvider` was designed for.

This module also earns its place as a test of the contract. Every provider the capability has been designed against so far is Twilio-shaped and global. Khudebarta is regional, returns HTTP 200 on failure, and has no rate-limit code at all. If `SmsProvider` survives it unchanged, the contract is not secretly Twilio's.

Success means a project runs `saasaloy add sms-khudebarta`, sets four env vars, and sends a real SMS to a Bangladeshi number through `createSms(env)` without any route learning which provider is active.

**Scope note.** This module covers sending only. Khudebarta's delivery-report, inbound-message and balance APIs are out of scope and get their own issue.

## The vendor contract

Sourced from Khudebarta's *SMS HTTP API Published* document (SMS API Version 5.4.0) and confirmed by a live probe on 2026-09-11. The platform is white-labelled, so the document describes a generic gateway engine rather than Khudebarta-specific behaviour.

**Request** — `POST <base>/sendtext`, `Content-Type: application/json`:

```json
{
  "apikey": "…",
  "secretkey": "…",
  "callerID": "testSender",
  "toUser": "8801835414333",
  "messageContent": "test message"
}
```

`callerID` is the masking or non-masking sender id, and it may also be a short code or a long code. `toUser` is `880XXXXXXXXX` with no leading `+`. `messageContent` supports ASCII and Unicode with no encoding flag, so Bangla text needs no special handling.

**Response** — HTTP 200 in every case, success and failure alike:

```json
{ "Status": "0",  "StatusDescription": "", "Text": "ACCEPTD", "Message_ID": "31771702" }
{ "Status": "-1", "StatusDescription": "Org Client Not Found", "Text": "REJECTD", "Message_ID": "-1" }
```

Success is `Status === "0"`. On any other status `Message_ID` is `"-1"`.

**Status codes** (28 documented, `0` and `-1` through `-68`): `-3` Invalid Dest No., `-4` Insufficient Balance, `-5` Org Rate Not Found, `-6` Org Blocked, `-7` Invalid Sender ID, `-36` Invalid Request Type, `-42` Authorization Failed, `-44` ContactNo Blocked, `-45` ContactNo Blocked by Admin, `-46` Dipping Failed, `-47` Content not Whitelisted, `-48` URL Blocked, `-49` Content is Blocked, `-52` License Limit Exceeded, `-54` Sender ID Empty, `-55` Destination ID Empty, `-56` Message Content Empty, `-58` HLR Request Failed, `-59` IP Not Allowed, `-60` Invalid Hash value, `-61` Invalid parameter, `-62` Internal Server Error, `-63` Invalid Transaction ID, `-64` Sender ID Block, `-65` Bulk Limit Exceeded, `-66` Invalid API Key, `-67` Invalid Secret Key, `-68` Duplicate Transaction ID.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Provider or driver | **Provider.** Stateless third-party HTTP send, nothing to migrate. Sits squarely inside ADR 0001's amendment and on the provider side of ADR 0033's test. |
| Transport | **HTTPS on the custom port.** Cloudflare Workers strip a custom port from a plain `http://` subrequest, so the documented `:3775` HTTP endpoint would silently land on port 80. Custom ports work over HTTPS with a compatibility date after 2024-09-02; the template ships `2026-07-21` (`modules/api/files/wrangler.jsonc:5`), so no compatibility-flag patch is needed. |
| HTTP method | **POST with a JSON body.** The GET form puts `apikey` and `secretkey` in the query string, where they land in the gateway's access logs and any intermediary's. |
| Geographic scope | **Bangladesh only.** A recipient that is not `+880…` raises `SmsError("invalid_number")` before any request leaves the Worker. International traffic is a future `sms-twilio`, not this module's problem. |
| Number format | Strip the leading `+` from the core's E.164 recipient. `+8801712345678` becomes `8801712345678`. |
| Sender | `callerID` is required by the vendor, so the provider raises `SmsError("invalid_message")` when neither `message.from` nor `SMS_FROM` resolves. The core deliberately leaves this to the provider. |
| Success detection | Read the JSON `Status` field, never `response.ok`. The gateway answers 200 on every failure. |
| Multiple recipients | **One request per recipient**, sequentially. The bulk form returns a single `Status` for the whole batch and a comma-separated `Message_ID` list, so a partly rejected batch reports success and the ids do not fit `SmsResult.messageId`. Rejected: one bulk call joining ids with commas (hides partial failure); refusing `to[]` outright (the core supports it). |
| Partial failure | **Throw on the first rejection and stop.** Earlier recipients stay sent. The caller gets one `SmsError` with the failing code, and cannot tell how far the loop got — documented, not fixed. |
| Base URL | `KHUDEBARTA_API_URL`, optional, defaulting to `https://portal.khudebarta.com:3770`. The doc writes the host as `<IP>:<port>` because it varies per client. Same shape as `PLUNK_API_URL`. |
| Retry | `retryable: true` on `Status -62` only. The gateway answered `REJECTD`, so the message was not accepted and not billed, which is the narrow case the sms core reserves `retryable` for. Every other code, and every `fetch` failure including a timeout, is `retryable: false`. |
| Unused capability codes | `unroutable`, `message_too_long` and `rate_limited` never fire on this provider. Khudebarta publishes no equivalent, and no rate-limit code at all. Stated in the runbook rather than left for a reader to infer. |
| Tests | **Ships `files/khudebarta.test.ts`, repo-only.** Stubbed `fetch`, every status code asserted, plus the success path, the `+880` guard and the missing-sender throw. The error map is a 28-row table transcribed by hand from a PDF, and the live API is unreachable until the certificate is renewed, so a test is the only thing that ever reads it back. Follows `kv-cloudflare` and `billing-console`; the descriptor's `files[]` names the provider file alone. |
| `+880` guard placement | **Validate every recipient before the loop starts.** Nothing is sent when any recipient is unusable. This does not reopen the partial-send rule, which covers vendor rejections we cannot predict; a prefix check is free and deterministic, so spending a real SMS before it is waste. |
| HTTPS enforcement | **Documentation only.** The default is already HTTPS, so only an explicit override can reintroduce the port-stripping failure. The `KHUDEBARTA_API_URL` description states what breaks; the provider does not check. |
| Request timeout | **`AbortSignal.timeout(15_000)` per request**, matching the WordPress plugin's own choice. An abort maps to `provider_error` with `retryable: false`, because an aborted send may already have been accepted and billed. Without it a hung gateway holds the Worker invocation until the platform kills it. |
| Recipient cap | **None. Documented instead.** One recipient is one subrequest, and Cloudflare allows 50 per invocation on the free plan and 1000 on paid. Any constant the provider picked would be wrong for half of users, so the runbook points a broadcast at the `queue` capability. |

**Error map.** `providerCode` carries the numeric `Status` verbatim; the message carries `StatusDescription`.

| `SmsErrorCode` | Khudebarta `Status` |
|---|---|
| `invalid_number` | `-3`, `-55` |
| `opted_out` | `-44`, `-45` |
| `account_error` | `-1`, `-4`, `-5`, `-6`, `-7`, `-42`, `-52`, `-54`, `-59`, `-64`, `-66`, `-67` |
| `provider_error` | `-62` (retryable), and every unmapped code including `-36`, `-46`, `-47`, `-48`, `-49`, `-56`, `-58`, `-60`, `-61`, `-63`, `-65`, `-68` |

Sender-not-owned, empty balance and blocked account collapse into `account_error` by the capability's own rule: they are operator alerts with one caller response, and `providerCode` keeps the vendor's code for whoever fixes it.

Three codes stay `provider_error` deliberately, and the reasoning goes in a comment beside the `default` branch so nobody re-derives it. `-65` Bulk Limit Exceeded is unreachable on a per-recipient loop. `-47`, `-48` and `-49` are content-policy rejections with no matching capability code, and inventing a `content_rejected` code would change `packages/sms`, which this plan forbids on principle. Revisit `-65` if a real account ever produces one.

## Approach

The standard provider shape from `.agents/skills/create-provider/SKILL.md`, `sms` mode. Reuses `sms-console`'s descriptor as the structural template and `email-plunk`'s as the HTTP-provider template, including its `*_API_URL` treatment. No new CLI patch kind, no scaffold, no npm dependency, no skill folder.

```text
modules/sms-khudebarta/
  registry-item.json
  provider.ts                →  test-only resolution shim, not shipped
  files/khudebarta.ts        →  @sms/providers/khudebarta.ts
  files/khudebarta.test.ts   →  repo-only, runs under `pnpm test:modules`
```

### Phase 1: the descriptor

`modules/sms-khudebarta/registry-item.json`. `type: "saasaloy:feature"`, `dependsOn: ["sms"]`, empty `dependencies` and `scaffolds`. One `plugin-array` patch on `packages/sms/src/index.ts` registering `khudebarta` into `providers`. One file entry targeting `@sms/providers/khudebarta.ts`.

`envVars`, each with the description style the registry already uses (what it is, where to get it, where it is read from, and what breaks when it is wrong):

- `KHUDEBARTA_API_KEY` — required.
- `KHUDEBARTA_SECRET_KEY` — required.
- `KHUDEBARTA_API_URL` — optional, defaults to `https://portal.khudebarta.com:3770`. Must be HTTPS, because Workers strip the custom port from a plain HTTP subrequest.

The sender comes from the capability's existing `SMS_FROM`, so this module declares no env var of its own for it.

### Phase 2: the provider

`files/khudebarta.ts`, one exported factory `khudebarta(): SmsProvider` with `name: "khudebarta"`.

- Read `KHUDEBARTA_API_KEY`, `KHUDEBARTA_SECRET_KEY` and `KHUDEBARTA_API_URL` off the `env` argument. Never `process.env`.
- Raise `SmsError("provider_error")` when either credential is missing, before the request is built.
- Raise `SmsError("invalid_message")` when `message.from` is absent.
- Raise `SmsError("invalid_number")` for any recipient not starting `+880`, naming the number and the reason. **Check every recipient before the first request goes out.**
- Loop `message.to` sequentially. Per recipient: build the JSON body, `POST` with `AbortSignal.timeout(15_000)`, parse, branch on `Status`, throw through the error map on anything but `"0"`.
- Return `{ messageId }` from the first recipient's `Message_ID`.
- Do not touch `estimatedSegments`, do not retry, do not sleep, do not truncate.
- Map a thrown `fetch` failure, including an abort, to `SmsError("provider_error", …, { retryable: false, cause })`.

### Phase 3: the test

`modules/sms-khudebarta/provider.ts`, a one-line shim re-exporting `../sms/files/src/provider`, so `files/khudebarta.ts`'s `../provider` import resolves in this repo the way it will in a generated project. `billing-console/index.ts` carries the same shim with a comment explaining why it is not shipped; copy that shape.

`files/khudebarta.test.ts` on `node:test`, with `fetch` stubbed and no network:

- `Status: "0"` returns `Message_ID` as `messageId`.
- Every mapped status produces the right `SmsErrorCode`, with `providerCode` holding the numeric status and the message carrying `StatusDescription`. Table-driven, so the 28 rows read back as a table.
- An HTTP 200 carrying a failure status throws. This is the trap a provider copied from `email-plunk` falls into, and it is the single most likely defect.
- `-62` is the only code with `retryable: true`.
- A non-`+880` recipient anywhere in `to[]` throws `invalid_number` and issues no request at all.
- A missing `from` throws `invalid_message`; a missing credential throws `provider_error`.
- The request body carries `toUser` with the `+` stripped.

### Phase 4: the capability runbook

Update `modules/sms/skills/saasaloy-sms/SKILL.md`:

- Add the row to the provider table: module, provider name `khudebarta`, needs, adds.
- Add a short setup section — get the API key and secret from the portal, register a sender id, set `SMS_PROVIDER=khudebarta` and `SMS_FROM`.
- State the Bangladesh-only restriction, and that `SMS_FROM` is required on this provider.
- Update the "codes no shipped provider raises" note: `unroutable`, `message_too_long` and `rate_limited` still have no source, but `account_error` now does.
- Correct the claim that there is no provider with an account to fail.
- State the two operational limits: one subrequest per recipient against Cloudflare's 50-free / 1000-paid cap, so a broadcast belongs on the `queue` capability; and the 15-second request timeout, whose abort is not retryable because the message may already have been accepted and billed.

### Phase 5: registry wiring and verification

There is no registry index file. `modules/` is the registry, discovered by directory, so the only listings to update are two hand-maintained prose tables. `scripts/build-cli-readme.ts` does not generate either.

- Add `sms-khudebarta` to the provider row in `README.md:110` and in `modules/README.md:47`.
- `pnpm lint` (all four passes), `pnpm test` (which runs `test:modules` and picks up Phase 3), and `pnpm deps:check`.
- In `.dev/`: `saasaloy add sms-khudebarta`, confirm the import and the `khudebarta()` call land in `packages/sms/src/index.ts`, confirm re-running changes nothing, confirm the env vars appear.
- Send one real SMS to a Bangladeshi number with `wrangler dev`, and read the `Message_ID` back.
- Prove one error path by sending with a deliberately wrong `KHUDEBARTA_API_KEY`, expecting `account_error` with `providerCode: "-66"`.

## Known risks

No decisions are left open. Two facts sit outside our control.

- **The TLS certificate on `portal.khudebarta.com:3770` expired on 2025-12-11.** A live probe on 2026-09-11 only succeeded with `curl -k`. Workers `fetch` validates certificates and offers no way to skip, so the default base URL cannot be reached from a deployed Worker until Khudebarta renews. The certificate is a lapsed Sectigo DV one, so renewal should be routine. Phase 5's live verification is blocked until it lands; every other phase, including the test, proceeds without it. Recorded as a risk, not a task.
- **No transaction id is sent.** Codes `-63` Invalid Transaction ID and `-68` Duplicate Transaction ID imply the gateway supports an idempotency key that the documented `/sendtext` body has no field for. The PDF cannot settle it and it changes nothing until Khudebarta's tech team answers. If the field does exist, it would make a retry safe and reopen the retry decision, which is the only reason to keep the observation.

## Non-goals

- **Delivery reports.** `/getstatus` and the `/submitstatus` DLR push are out of scope. `SmsProvider` has one method and the capability has no delivery-receipt contract yet. `Message_ID` is the join key such a feature would use. Files as its own issue.
- **Inbound messages.** The MO HTTP endpoints need a Worker route and a core-level inbound contract that does not exist.
- **Balance and recharge APIs.** `/api/v3/balance` and the billing endpoints have no slot in the provider contract.
- **Changing `packages/sms`.** The point of this module is that the contract holds unchanged. A change needed here is a finding about the contract, not a task in this plan.
- **International routing.** Explicitly another provider's job.
- **A skill folder.** Provider modules ship none; the capability's runbook documents them.
