# Plan: the bKash merchant billing provider

Grilled: 2026-09-21

Issue: [#157](https://github.com/mimukit/saasaloy/issues/157)

## Context

bKash is the largest mobile financial service in Bangladesh, and its merchant product is a real API. A project that installs `billing-sslcommerz` reaches bKash through an aggregator and pays the aggregator's rate; a project with its own bKash merchant account wants the direct integration. This adds `modules/billing-bkash-merchant/` as a provider behind the `billing` capability, alongside `billing-stripe`, `billing-console`, `billing-sslcommerz` and `billing-bkash-personal`.

The integration is bKash Tokenized Checkout, v1.2.0-beta. The flow is four server calls and one redirect: hold a token, create a payment, send the browser to `bkashURL`, then execute the payment when the customer returns. Three facts from `developer.bka.sh` decide most of this plan.

**The token is rate limited and the docs will not say how.** An `id_token` lives 3600 seconds. `token-management-overview-3.md` carries the sentence "Do not call this API more than two times within an hour. If you exceed this limit, the API will return an error, and you will be blocked for one hour", and it sits on the Refresh Token page. `token-management-overview-1.md` carries the same sentence beside the grant lifetime. `refresh-token-3` states the refresh token's own lifetime "matches the `id_token`'s default expiration of 3600 seconds", which contradicts the 28-day figure every community package assumes. Nothing public settles which endpoint the limit governs or how long a refresh token lives, so this plan is built to be safe under the worst reading: **at most two token calls an hour, of any kind, across the whole deployment, and a one-hour block for exceeding it.** That single constraint is what forces the token onto a scheduled job and forces the job to reach `env` through a new core port.

**The callback carries almost nothing.** bKash returns the browser to `callbackURL` with `paymentID`, `status` and `apiVersion`. But `execute` echoes `payerReference`, `merchantInvoiceNumber`, `amount` and `currency` back, so the subject, the plan and the interval travel out and home on the payment itself. That is the same trick `value_a`/`value_b` play for SSLCOMMERZ, and it means no pending-checkout table.

**The webhook is SNS-shaped, hand-provisioned and undocumented.** bKash POSTs a notification carrying `Signature`, `SignatureVersion` and `SigningCertURL`, and a merchant hands its listener URL to bKash support during onboarding. There is no self-service registration, no sandbox, and no published canonical string or signature algorithm. Verification code written against a guess would look like a guarantee and would silently drop every real notification if the guess were wrong.

Success means a project runs `saasaloy add billing-bkash-merchant`, sets `BILLING_PROVIDER=bkash-merchant` and five env vars, and every existing billing route, the admin billing page, the entitlement reads and the dunning emails work against a real bKash sandbox merchant with no change to any consumer.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Which bKash product | Tokenized Checkout, **mode `0011`**, no agreement. One-off payment per period. |
| Whether to also ship agreement mode | No. `create-agreement` (mode `0000`) returns a `bkashURL` the customer must visit with wallet number and OTP, and `create-payment` mode `0001` **also** returns a `bkashURL` where the customer enters wallet number, OTP and PIN. The merchant cannot charge an agreement unilaterally, so an agreement does not enable merchant-initiated recurring. It buys a shorter form at the second payment and costs a stored `agreementID`, two more callback paths, an agreement-cancel path and a `mode` branch through every call. A non-goal, with this finding as the reason. |
| How a recurring plan renews | Manual renewal, `renewal: "manual"`, identical to `billing-sslcommerz`. Each period is a fresh hosted checkout. #156's renewal-due job marks the row `past_due` and sends `renewal_due`; the lockout job then sets `lockedAt`. |
| Where the grant token lives | The `kv` capability. The module declares `dependsOn: ["billing", "kv"]`, the provider file imports `@repo/kv`, and `@repo/kv` is patched into `packages/billing/package.json`. No Workers binding is read anywhere in the provider. |
| Who calls bKash for a token | A **provider-owned scheduled job**, and nothing else in the steady state. `cacheAside` is unusable here: it has no stampede protection, and `kv-cloudflare` carries a 60-second TTL floor plus a 60-second propagation window, so an on-demand refresh is exactly the miss storm that trips a two-per-hour limit. One cron caller makes the count deterministic. |
| The cron cadence | `*/15 * * * *`, with the job acting only when the stored token expires within 20 minutes. One call an hour in the steady state, and three spare ticks to recover a failed one. The guard lives in the job body, not the cron string, so it is unit-testable. |
| How the job reaches `env` | A new core port, `setBillingProviderEnv(env)`, called once at module load from `apps/api/src/billing-store.ts` beside `setBillingConfig`. A queue handler gets `(payload, ctx)` and no `env` (`packages/queue/src/provider.ts`), and the core holds no importable Workers env, so this is the same problem `setBillingConfig` already solves for `BILLING_LOCKOUT_DAYS`. Rejected: importing `env` from `cloudflare:workers` in the provider file, which would make the provider Cloudflare-only. |
| What a cold start does | One inline grant at checkout, guarded by a KV marker written before the call, so a fresh deploy does not wait up to 15 minutes for the first tick. If the marker is already set or the grant is refused, the checkout fails with `provider_error`, `retryable: true`, carrying bKash's own `statusCode` in `providerCode`. |
| Whether the module verifies the webhook signature | No, and it trusts nothing instead. The notification body is a bare hint: the provider reads `paymentID` or `trxID` off it and mints the event from `payment/status`. A forged or replayed notification costs one API call and grants nothing. The `SubscriptionConfirmation` handshake fetches `SubscribeURL` only when its host is a bKash domain. The skill states the notification is unauthenticated by design and why that is safe. |
| Which currencies | BDT only. bKash accepts no other. A plan whose `price` names another currency for the interval throws `invalid_request` at checkout, naming the plan and the currency. |
| How the subject travels | `payerReference` carries the subject's `referenceId`. `merchantInvoiceNumber` carries `<plan>:<interval>:<nonce>` with the nonce from `crypto.randomUUID`, capped at 255 characters with `<`, `>` and `&` stripped, which bKash refuses. Both are echoed on `execute` and on `payment/status`. |
| Why tampering with those fields is not a threat | Every fact the event is built from is read off bKash's own `execute` or `payment/status` answer, never off the redirect. `trxID` as `providerEventId` makes a replay a primary-key no-op against `billing_events`. |
| What settles a payment | The `execute` response, or `payment/status` when `execute` cannot be trusted. Never the callback query string. `status=success` on the return is a hint that `execute` is worth calling, never a statement that money moved. |
| What covers a payment bKash took but `execute` never settled | The webhook, plus a documented manual path. A project that does not register a listener with bKash support has a manual-recovery case, and the skill names `payment/status` and the `trxID` as how an admin settles it. A reconciliation job needs a created-but-unsettled payments table, which is core work with a wider blast radius, so it is its own follow-up issue. |
| What happens with no `kv` or no `KV_PROVIDER` | The provider factory throws `invalid_request` at construction, naming the first missing key, and checks the four bKash credentials at the same time. `dependsOn` installs `kv` but cannot make anyone configure it. |
| Sandbox versus live | One `BKASH_MERCHANT_MODE` env var picking `tokenized.sandbox.bka.sh` or `tokenized.pay.bka.sh`. Anything that is not exactly `live` resolves to sandbox, so a typo cannot send a test payment to the live gateway. Same rule as `SSLCOMMERZ_MODE`. |
| Env var names | `BKASH_MERCHANT_APP_KEY`, `BKASH_MERCHANT_APP_SECRET`, `BKASH_MERCHANT_USERNAME`, `BKASH_MERCHANT_PASSWORD`, `BKASH_MERCHANT_MODE`. The `MERCHANT` segment keeps them distinct from `billing-bkash-personal`'s `BKASH_PERSONAL_NUMBER` when both modules are on disk. Every tutorial uses the bare `BKASH_*` names, so the skill states the mapping. |
| Relationship to #156 | Hard prerequisite on its Phase 1. This plan re-specifies none of it and adds one thing to core that #156 does not supply, which is why it is two phases. |
| Where the positions are recorded | One ADR, written by domainkit, covering both new claims: a provider may add a **capability** dependency to `packages/billing` but never a vendor one, and a provider may own a scheduled job reaching `env` through a core port. Plus `CONTEXT.md` entries for **provider env port** and **provider-owned job**. |
| Where the provider is documented | A skill folder under `modules/billing-bkash-merchant/skills/`, plus a row in `modules/billing/skills/saasaloy-billing/SKILL.md`'s provider table. Same deliberate divergence from `create-provider`'s "no skill folder" rule that #156 makes. |

## Approach

### What it reuses

- **#156 Phase 1, entire and unchanged.** `BillingProvider.handleCallback(env, request, path)`, the unauthenticated `/billing/callback/:provider/*` route, `PlanConfig.price` as `Partial<Record<PlanInterval, PlanPrice>>`, `RenewalMode`, the `provider` column on `billing_subscriptions`, the renewal-due job, the `renewal_due` notification and `POST /billing/renew`.
- **`CallbackResult`'s `redirect` arm, which already carries an optional `event`.** The route enqueues before it answers 303, and answers 204 for `event` and for `ignored`. The bKash return path needs an event and a redirect on one request, and the contract already allows it. No core widening.
- `setBillingConfig` in `packages/billing/src/config.ts` as the exact shape for `setBillingProviderEnv`: a module-scope value, a setter called once from `apps/api/src/billing-store.ts`, and a reader the job calls.
- `packages/queue/src/index.ts`'s `jobs` and `schedules` `plugin-array` slots, which `billing` already appends four entries to. `packages/queue/package.json` already depends on `@repo/billing`, and `packages/billing`'s exports map already carries `"./providers/*"`, so the job and the schedule export from the provider file itself and the module stays at one runtime file.
- `billing-stripe`'s descriptor as the precedent for a provider patching `package-json-dependency` into `packages/billing/package.json`. It patches three vendor packages; this one patches a workspace capability, which is the ADR's point.
- `applyEvent` and the `(provider, providerEventId)` primary key, which make a redelivered webhook a no-op with no dedupe logic in the provider.
- `pastDueLockoutJob`, `notifyBilling` and the email render path, all untouched.
- `@repo/kv`'s `createKv(env)` and `buildKey`, so the token record follows the project's key policy and prefix and swaps store vendor with `KV_PROVIDER`.
- `resolveSubject` and `authorizeSubject` in `@billing/subject.ts`, so `teams` still bills an organization with no change here.
- The repo-only `provider.ts` re-export shim that `kv-memory` and `storage-memory` carry, so the provider file's tests run in place without shipping the shim.
- `billing-console` as the offline path. No bKash stub server.

### Phase 1: the provider env port in `billing` core

1. **`setBillingProviderEnv(env)` and `billingProviderEnv()`** in `packages/billing/src/config.ts`, or a sibling file if `config.ts`'s doc comment reads better left alone. Module scope, one setter, one reader, and a reader that throws a clear error when nothing registered an env. Typed as `BillingEnv`, which is opaque by construction, so the core learns nothing about any vendor key.
2. **One call site.** `apps/api/src/billing-store.ts` calls it at module load, beside its existing `setBillingConfig`, `setBillingStoreResolver`, `setBillingStoreRunner` and `setBillingEnqueuer` calls. That file is shipped by `modules/billing`, so this is a change to the `billing` module, not to a provider.
3. **Tests.** The setter replaces, the reader throws before registration, and the reader returns the registered env after.
4. **One ADR and two `CONTEXT.md` entries,** written by domainkit, as the decisions table describes.

### Phase 2: `modules/billing-bkash-merchant`

1. **The descriptor.** `type: saasaloy:feature`, `dependsOn: ["billing", "kv"]`, `scaffolds: []`. Patches: one `plugin-array` appending `bkashMerchantBilling()` to `providers` in `packages/billing/src/index.ts`; one `package-json-dependency` adding `@repo/kv` at `workspace:*` to `packages/billing/package.json`; one `plugin-array` appending `bkashTokenJob()` to `jobs` in `packages/queue/src/index.ts`; one `plugin-array` appending `bkashTokenSchedule()` to `schedules` in the same file. No npm dependency — the integration is `fetch` and `URLSearchParams`. `envVars` declares the five `BKASH_MERCHANT_*` keys, each naming where to get it and what breaks without it. `agent.skills` names the module's skill folder.
2. **The one runtime file, `files/bkash-merchant.ts`.** Exports `bkashMerchantBilling(): BillingProvider` with `name: "bkash-merchant"` and `renewal: "manual"`, plus `bkashTokenJob()` and `bkashTokenSchedule()`.
   - **The factory asserts first.** `KV_PROVIDER` and the four credentials, throwing `invalid_request` naming the first missing key, before returning the provider object.
   - **The token record.** `{ idToken, refreshToken, expiresAt, refreshedAt }` under a `buildKey({ namespace: "billing", parts: ["bkash-merchant", "token"] })`. Request code reads it and never calls bKash.
   - **`bkashTokenJob`** reads `billingProviderEnv()`, opens a `kv` store, returns immediately when `expiresAt` is more than 20 minutes out, otherwise calls `POST /tokenized/checkout/token/refresh` and writes the new pair back. It calls `POST /tokenized/checkout/token/grant` only when there is no record or the refresh is refused. `bkashTokenSchedule` returns cron `*/15 * * * *`.
   - **The cold-start grant.** When a request finds no record or an expired one, write a marker key with a short TTL, then grant once and store the result. A marker already present, or a refused grant, fails the call with `provider_error`, `retryable: true`.
   - `createCheckout` on a plan carrying `trialDays` mints a `trialing` event and returns `successUrl` without touching bKash. Otherwise it reads the plan's `price` for the interval, refuses a non-BDT currency, converts minor units to the decimal string bKash wants, POSTs `payment/create` with `mode: "0011"`, `intent: "sale"`, `payerReference`, `merchantInvoiceNumber` and the module's own `callbackURL`, and returns `bkashURL` with no event.
   - `changePlan` is a fresh checkout at the new plan's price, with `periodEnd` extended by the days left on the current row's period.
   - `cancel` and `restore` mint an event from `SubjectInput.current`, as `billing-console` does. bKash has no subscription to tell.
   - `createPortal` returns `input.returnUrl`. There is no vendor portal.
   - `listInvoices` returns `[]`.
   - `setQuantity` validates and returns. Seats are a later issue everywhere.
   - `handleCallback` branches on the path. `return` with `status=success` calls `execute`, then returns a `redirect` carrying the minted event. `status=failure` and `status=cancel` return a bare `redirect`. `webhook` reads the identifier off the body, re-reads `payment/status` and returns `{ kind: "event" }`. A `SubscriptionConfirmation` fetches `SubscribeURL` when its host is a bKash domain and returns `ignored`. Anything else returns `ignored`.
3. **Settling a payment.** `execute` is the first attempt. On `2062` ("payment already completed"), on a network timeout, or on any answer the file does not recognise, fall through to `POST /tokenized/checkout/payment/status` with the same `paymentID` and settle from that. Treat `transactionStatus: "Completed"` as the only success. Compare `amount` and `currency` against what the payment was created for, in minor units, with no rounding towards agreement. Throw rather than settle when bKash cannot be reached.
4. **The event a completed payment produces.** `providerEventId` is the `trxID`. `providerSubscriptionId` and `providerCustomerId` are derived from the subject, so each period's payment converges on the row the first one created. `plan` and `billingInterval` are parsed off the echoed `merchantInvoiceNumber`, and the subject off the echoed `payerReference`. `periodStart` is now and `periodEnd` is now plus the interval. `metadata` keeps `paymentID`, `trxID`, `customerMsisdn`, `paymentExecuteTime` and the raw `statusCode`.
5. **Error mapping.** `2023` insufficient balance, `2011`/`2014`/`2015` PIN failures and `2010`/`2018`/`2059` OTP failures map to `card_declined`, never retryable. `2069` cancelled returns `ignored`. `2001` invalid app key and a missing credential map to `invalid_request` naming the key. `503` maintenance, an unreachable host and a token-rate-limit block map to `provider_error` with `retryable: true`. An amount or currency mismatch maps to `provider_error`, never retryable. Every case keeps bKash's own `statusCode` in `providerCode`.
6. **Tests.** Against a stubbed `fetch` and a stubbed KV store. Construction: each missing credential, and a missing `KV_PROVIDER`. The token job: no record grants, a record expiring in 10 minutes refreshes, a record expiring in 40 minutes does nothing, a refused refresh falls back to grant, and the schedule's cron string. The cold-start path: a first request grants once, a second request with the marker set fails `retryable`. Then create success and refusal, a trial checkout that calls no gateway, an executed payment, each declined code, the `2062` fall-through to `payment/status`, both mismatches, an unreachable host, the non-BDT refusal, a `changePlan` that extends the period, a webhook that re-reads `payment/status`, a webhook naming an unknown payment, a `SubscriptionConfirmation` with a foreign host, and the `merchantInvoiceNumber` round trip including the character strip and the 255 cap.
7. **The module skill,** `modules/billing-bkash-merchant/skills/saasaloy-billing-bkash-merchant/SKILL.md`: sandbox signup and credentials, the sandbox wallet numbers with PIN `12121` and OTP `123456`, the callback URL to configure, the webhook listener URL to hand bKash support and the fact that it cannot be tested in sandbox, the five env vars and the bare `BKASH_*` names tutorials use, the `kv` requirement and why `cacheAside` is not used, the two-per-hour limit and the rule that staging and production must not share an app key, what a block looks like and how long it lasts, the manual-recovery path for a payment bKash took but `execute` never settled, the manual renewal model, the no-proration rule, and BDT-only. The billing skill's provider table gains one row pointing here.
8. **Install proof.** `pnpm play:reset`, then `saasaloy add billing-bkash-merchant` in `.dev/playground`, then the same command again with no change, then `saasaloy remove billing-bkash-merchant` leaving every patched file byte-identical — all four patches, including the two into `packages/queue/src/index.ts`. Then `pnpm lint`.

## Open questions

None. Every branch raised in the grill is settled above.

Two facts stay unresolved in bKash's own documentation and are handled by designing around them rather than by guessing: which token endpoint the two-per-hour limit governs, and how long a refresh token lives. The scheduled-job design is correct under every reading, and the skill states the uncertainty so an operator who meets a block knows what they are looking at.

## Non-goals

- **Agreement mode**, mode `0000` and mode `0001`. An agreement still requires a customer redirect, OTP and PIN for every payment, so it does not enable recurring billing.
- Merchant-initiated and subscription charging. bKash offers it under an account-level arrangement that is not in the public docs and has no sandbox.
- Webhook signature verification. The canonical string and algorithm are not published, and the design trusts the notification for nothing.
- Refunds and `payment/refund`. `BillingProvider` exposes no refund method, and adding one is a contract change with no consumer.
- Proration in the credit-and-balance sense. The period extension in `changePlan` is the whole of it.
- A reconciliation job and a created-but-unsettled payments table. Its own follow-up issue.
- Seats. `setQuantity` validates and does nothing, as it does for every provider.
- A local bKash stub server. `billing-console` is the offline path.
- Any change to `packages/billing` beyond Phase 1's port, and any change to `apps/admin`.
- Amending `.agents/skills/create-provider/SKILL.md`, on the same terms #156 sets.
