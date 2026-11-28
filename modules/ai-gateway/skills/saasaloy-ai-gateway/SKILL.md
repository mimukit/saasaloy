---
name: saasaloy-ai-gateway
description: Runbook for the ai-gateway provider — models from any OpenAI-compatible gateway through @ai-sdk/openai-compatible, set up for Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway with `vendor/model` ids. Use when setting AI_PROVIDER=gateway, filling AI_GATEWAY_URL, AI_GATEWAY_API_KEY or AI_GATEWAY_HEADERS, switching gateways, picking a model id, or reading an AiError from a gateway.
---

# ai-gateway: models from an OpenAI-compatible gateway

`saasaloy add ai-gateway` puts `packages/ai/src/providers/gateway.ts` and `packages/ai/src/env/gateway.ts` into the project, adds `gateway()` to the `ai.providers` table and `gatewayEnv()` to the `ai.envPresets` table, and adds `@ai-sdk/openai-compatible` and `zod` to `packages/ai/package.json`. Set `AI_PROVIDER=gateway` and `createAi(env).model(feature)` returns a chat model on the gateway that `AI_GATEWAY_URL` names.

Read `modules/ai/skills/saasaloy-ai/` first. This file covers only what differs.

One provider file serves every gateway, because each one speaks the OpenAI chat completions API. A change of gateway is an env change and no code change. Features that only a vendor's own API has, and that the compatible API drops, are not available through this provider.

## Settings

| Key | Required | What it does |
| --- | --- | --- |
| `AI_GATEWAY_URL` | While `AI_PROVIDER=gateway` | The base URL, without `/chat/completions`. |
| `AI_GATEWAY_API_KEY` | While `AI_PROVIDER=gateway` | The key, sent as `Authorization: Bearer <key>`. |
| `AI_GATEWAY_HEADERS` | No | Extra headers as a JSON object of strings. Blank sends none. |

Under any other provider, the URL and the key may stay blank. The env check refuses `AI_GATEWAY_HEADERS` when it is not a JSON object of strings, so `[1]` and `{"a":1}` fail. Put the keys in `packages/env/.env` and run `pnpm env:setup`. In production, store the key with `wrangler secret put AI_GATEWAY_API_KEY`.

The model id is the gateway's own `vendor/model` form, such as `openai/gpt-6-luna`. Set it per feature with `<FEATURE>_MODEL`, for all features with `AI_MODEL`, or in `config.ai`, as the `saasaloy-ai` skill describes.

## Cloudflare AI Gateway

1. In the Cloudflare dashboard, create an AI Gateway, such as `main`.
2. Create an API token with the Workers AI Read permission.
3. Copy the account ID from the dashboard.

```sh
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
AI_GATEWAY_API_KEY=<cloudflare-api-token>
AI_GATEWAY_HEADERS={"cf-aig-gateway-id":"main"}
AI_MODEL=openai/gpt-6-luna
```

The `cf-aig-gateway-id` header sends the call through the named gateway, so its logs, caching and rate limits apply. Do not use the older `https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY>/compat` URL: Cloudflare marks it deprecated.

Cloudflare's docs for this API cover streaming, but they do not cover tool calls or usage in a streamed reply. The provider asks for streamed usage (`stream_options.include_usage`). If a tool call fails or the usage line shows no tokens on Cloudflare, that is this limit. Test both on your account before a feature depends on them.

## OpenRouter

1. Create a key at https://openrouter.ai/settings/keys and add credit to the account.

```sh
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://openrouter.ai/api/v1
AI_GATEWAY_API_KEY=sk-or-v1-<key>
AI_GATEWAY_HEADERS={"HTTP-Referer":"https://example.com","X-OpenRouter-Title":"My app"}
AI_MODEL=openai/gpt-6-luna
```

The two headers are optional. They name your app in OpenRouter's rankings. OpenRouter documents streaming, tool calls and usage in the final streamed chunk. An empty balance answers 402, which maps to `quota`.

## Vercel AI Gateway

1. Create an AI Gateway API key in the Vercel dashboard.

```sh
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://ai-gateway.vercel.sh/v1
AI_GATEWAY_API_KEY=<vercel-ai-gateway-key>
AI_GATEWAY_HEADERS=
AI_MODEL=openai/gpt-6-luna
```

Vercel needs no extra header. A header from Vercel's AI Gateway docs goes in `AI_GATEWAY_HEADERS`, such as `{"<header-name>":"<value>"}`. Vercel documents streaming and tool calls on this API, but not usage in a streamed reply.

## Errors

`normalizeError` reads the AI SDK's `APICallError`, `StreamProviderError` and `RetryError` (through `lastError`), and a raw error body sent in the middle of a stream. It maps the vendor code first and the HTTP status second:

| Vendor code or status | `code` | `retryable` |
| --- | --- | --- |
| `insufficient_quota`, `insufficient_credits`, or 402 | `quota` | false |
| `rate_limit_exceeded`, or 429 | `rate_limited` | true |
| `context_length_exceeded` | `context_length` | false |
| `invalid_api_key`, or 401 or 403 | `auth` | false |
| `content_filter` | `content_filtered` | false |
| `model_not_found`, or 404 | `not_found` | false |
| 408, 504 | `timeout` | true |
| 409, other 5xx, or no answer | `unavailable` | true |
| other 4xx | `invalid_request` | false |

OpenAI answers an empty account with 429 and `insufficient_quota`. That is `quota` and not retryable, because a retry cannot add credit. `providerCode` keeps the vendor's own code, or the status when the body has none. The AI SDK retries a retryable failure twice before the driver sees it.

## Removal

`saasaloy remove ai-gateway` deletes the two files, drops the `gateway()` and `gatewayEnv()` rows, and takes `@ai-sdk/openai-compatible` and `zod` out of `packages/ai/package.json`. Run `pnpm install` afterwards. Switch `AI_PROVIDER` to another installed provider first, or `createAi(env)` throws `AI_PROVIDER is "gateway", which is not registered.` Then revoke the key in the gateway's dashboard and delete the Workers secret with `wrangler secret delete AI_GATEWAY_API_KEY`. Delete the `AI_GATEWAY_*` lines from `packages/env/.env` by hand.

## Failure modes

- `AiError("not_configured")` with `AI_GATEWAY_URL is not set.` or `AI_GATEWAY_API_KEY is not set.` The key is blank while `AI_PROVIDER=gateway`. Set it and run `pnpm env:setup`.
- `AiError("not_configured")` with `AI_GATEWAY_HEADERS must be a JSON object of strings`. Fix the JSON. A number must be a string: `{"x-count":"1"}`.
- `AiError("auth")`. The key is wrong, revoked, or lacks a permission. On Cloudflare, check that the token has Workers AI Read and that the account ID in the URL is the token's account.
- `AiError("not_found")`. The model id is not in the gateway's list, or the URL has an extra path. Check the id in the gateway's model list.

## Next

Run `saasaloy-env` to set the gateway keys and write each service's `.env`.
