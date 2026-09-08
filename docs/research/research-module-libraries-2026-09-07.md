# Research: libraries for the planned Saasaloy modules

Research date is 2026-09-07. The repository reference is commit `d19f63e`. Module names and milestone numbers follow `docs/plans/plan-phase-3-modules-2026-07-22.md`.

## Recommendation

Prefer a Cloudflare native binding where one exists, and add a library only where the binding leaves a gap. Five libraries earn a place: `unstorage`, `aws4fetch`, `partyserver`, the Vercel AI SDK with `workers-ai-provider`, and `stripe`. The rest of the planned modules need no vendor package. Already in use and unchanged: `better-auth` (auth), `drizzle-orm` (database and migrations), `hono` and `zod` (api).

## Options by module

| Module (plan milestone) | Pick | Why | Version (2026-09-07) |
|---|---|---|---|
| `kv` (3.6) | `unstorage` | One API over KV, Cache API, R2, memory. Driver takes the binding object from `env`. | 1.17.5 |
| `storage` (3.3) | R2 binding for reads and writes, plus `aws4fetch` for presigned URLs | The R2 binding cannot presign. Cloudflare's own R2 docs use `aws4fetch` with `signQuery: true` for presigned GET and PUT. Zero dependencies. | 1.0.20 |
| `ratelimit` (3.11) | Rate limiting binding, no library | Native `env.LIMITER.limit({ key })` returns `{ success }`. Window is 10 or 60 seconds. Needs wrangler 4.36 or later. | native |
| `ratelimit`, fallback | `hono-rate-limiter` | Use it only if the fixed windows are too coarse. It has an optional `unstorage` peer, so it can share the `kv` mount. | 0.5.4 |
| `queue` (3.1), `cron` (3.5) | Cloudflare Queues and Cron Triggers, no library | Both are wrangler config plus a handler export. | native |
| Long jobs (new) | Cloudflare Workflows, no library | Durable multi-step runs with retries and state. On Free and Paid plans. Covers dunning retries and exports better than a bare queue. | native |
| `realtime` (3.8) | `partyserver` and `partysocket` | Cloudflare-org package. A `Server` class over Durable Objects with room routing, hibernation, broadcast, and alarms. One dependency. | 0.5.10 |
| `ai` (3.9) | `ai` (Vercel AI SDK) and `workers-ai-provider` | The provider takes `env.AI` as a binding. The same `streamText` call then swaps to OpenAI or Anthropic through optional peers. This matches the ADR 0001 amendment shape for stateless services. | ai 7.0.93, provider 4.0.0 |
| `observability` (3.10) | Workers Logs and tracing, no library, then `@sentry/cloudflare` as a provider | Workers export OpenTelemetry traces and logs natively. Sentry is the official Cloudflare SDK when error grouping is wanted. | 10.73.0 |
| `observability`, alternative | `@microlabs/otel-cf-workers` | Only if custom spans are needed. Still a release candidate and pulls seven OpenTelemetry packages. Skip it. | 1.0.0-rc.52 |
| `billing` (phase 2) | `stripe` and `@better-auth/stripe` | The Stripe SDK has a `worker` export condition with a fetch client and no dependencies. Better Auth's plugin owns the customer and subscription tables. | 22.6.1 |
| API docs (new, on `api`) | `@hono/zod-openapi` and `@scalar/hono-api-reference` | Peer deps match the stack: Hono 4 and Zod 4. Route schemas can reuse `@repo/validators`. Scalar serves the reference page as middleware. | 1.6.3, 0.12.1 |
| Outbound webhooks (backlog) | `standardwebhooks` | Signs and verifies with the Standard Webhooks spec that Svix and others follow. Two small deps. | 1.1.1 |
| `feature-flags` (backlog) | None. Build on `kv` | OpenFeature's server SDK targets Node 20 and adds a vendor-neutral layer with no provider in use here. A KV-backed flag repo helper is smaller. | skip |

## Where the fit is weak

- **`workers-ai-provider` moved repos.** The `cloudflare/workers-ai-provider` repo is archived since 2025-03-18 and the code lives under the `cloudflare-ai` org. The npm package still publishes. Confirm the new repo before pinning.
- **`ai` moves fast.** Version 7 shipped this year and the provider pins `ai ^7`. Expect majors in the `deps:update` majors group often.
- **`partyserver` is pre-1.0.** Cloudflare-org maintenance reduces the risk, but the API can still change.
- **Hono rate limiting has two community options.** `hono-rate-limiter` and `@elithrar/workers-hono-rate-limit`. The native binding makes both optional.

## Evidence (primary sources)

All npm registry pages fetched 2026-09-07.

- aws4fetch 1.0.20, zero deps: https://registry.npmjs.org/aws4fetch/latest
- R2 presigned URLs with aws4fetch `signQuery`: https://developers.cloudflare.com/r2/examples/aws/aws4fetch/
- Rate limiting binding API and 10 or 60 second window: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- hono-rate-limiter 0.5.4, peers hono ^4.10.8 and optional unstorage: https://registry.npmjs.org/hono-rate-limiter/latest
- Workflows on Free and Paid plans: https://developers.cloudflare.com/workflows/
- partyserver 0.5.10 under cloudflare/partykit: https://registry.npmjs.org/partyserver/latest and https://github.com/cloudflare/partykit/tree/main/packages/partyserver
- workers-ai-provider 4.0.0, peer ai ^7: https://registry.npmjs.org/workers-ai-provider/latest and https://github.com/cloudflare/workers-ai-provider (archived notice)
- ai 7.0.93: https://registry.npmjs.org/ai/latest
- Workers observability, OpenTelemetry export: https://developers.cloudflare.com/workers/observability/
- @sentry/cloudflare 10.73.0: https://registry.npmjs.org/@sentry/cloudflare/latest
- @microlabs/otel-cf-workers 1.0.0-rc.52: https://registry.npmjs.org/@microlabs/otel-cf-workers/latest
- stripe 22.6.1 with `worker` export: https://registry.npmjs.org/stripe/latest
- @hono/zod-openapi 1.6.3, peers zod ^4 and hono >=4.10: https://registry.npmjs.org/@hono/zod-openapi/latest
- @scalar/hono-api-reference 0.12.1: https://registry.npmjs.org/@scalar/hono-api-reference/latest
- standardwebhooks 1.1.1: https://registry.npmjs.org/standardwebhooks/latest
- @openfeature/server-sdk 1.23.0, Node 20 target: https://registry.npmjs.org/@openfeature/server-sdk/latest
- Staleness note: the Cloudflare tracing page returned 404 during this pass. The OpenTelemetry export claim rests on the observability index page only.

## Open questions

- **Presign vs Worker proxy for uploads.** A presigned PUT skips the Worker but exposes the S3 endpoint and needs an R2 API token as a secret. A Worker proxy keeps the binding only. Decide at the `storage` plan.
- **AI Gateway.** Whether the `ai` module routes through AI Gateway for logs and caching is unverified here. Check the relocated provider repo.
- **Workflows vs Queues split.** The phase-3 plan predates Workflows GA. Decide whether `queue` stays a capability or Workflows takes the job-runner role.
