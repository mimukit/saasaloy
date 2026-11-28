---
name: saasaloy-ai
description: Runbook for the ai capability — packages/ai hands a feature a LanguageModelV4 from the provider AI_PROVIDER selects (ai-gateway, ai-mock), with one model id lookup, one AiError shape, and the untrusted, dayLine and usage helpers. Use when adding an AI feature, choosing or switching AI_PROVIDER, setting a model id per feature, handling an AiError, or writing a custom ai provider.
---

# ai — models from the selected provider, in `packages/ai`

`packages/ai` (`@repo/ai`) is the capability core. It holds the provider registry, the model id lookup, one normalized error type and three helpers that import nothing. It types every model as `LanguageModelV4` from `@ai-sdk/provider`, through a type import only, so the core loads no vendor package at runtime. Each model vendor or gateway is a provider module that adds one file to `src/providers/` and one row to the `ai.providers` table.

Callers import `@repo/ai`, call `createAi(env)`, and never learn which provider is active. The AI framework that calls the model, such as the AI SDK's `streamText`, comes from a driver module and not from this core.

## What it installs

| File | Lands at |
| --- | --- |
| `files/src/index.ts` | `packages/ai/src/index.ts`: `createAi(env)` and the exports |
| `files/src/define.ts` | `packages/ai/src/define.ts`: `defineAi`, provider selection, `model(feature)` |
| `files/src/provider.ts` | `packages/ai/src/provider.ts`: `AiEnv`, `AiProvider`, `AiError` |
| `files/src/prompt.ts` | `packages/ai/src/prompt.ts`: `dayLine` and `untrusted` |
| `files/src/usage.ts` | `packages/ai/src/usage.ts`: the `AiUsageFields` type |
| `files/src/env-preset.ts` | `packages/ai/src/env-preset.ts`: the `AI_PROVIDER` and `AI_MODEL` gate |
| `files/config/ai.ts` | `packages/config/src/sections/ai.ts`: the `ai` config section |

The CLI also writes `packages/ai/src/providers.generated.ts` and `packages/ai/src/env-preset.generated.ts`, adds `aiEnv()` to the `api.envPresets` table, adds `aiConfig()` to the `config.sections` table, and adds `@repo/ai` to `apps/api/package.json`.

## Providers

| Module | `AI_PROVIDER` | Use it for | Runbook |
| --- | --- | --- | --- |
| `ai-gateway` | `gateway` | Cloudflare AI Gateway, OpenRouter or Vercel AI Gateway | `saasaloy-ai-gateway` |
| `ai-mock` | `mock` | Local development and tests, with a scripted echo model | `saasaloy-ai-mock` |

## Driver

The core calls no model itself. A driver module holds every line that imports an AI framework. Install exactly one.

| Module | Framework | Exports | Runbook |
| --- | --- | --- | --- |
| `ai-sdk` | Vercel AI SDK 7 | `@repo/ai/sdk`: `generate`, `streamChat`, `toolCallsOf`, `turnUsage` | `saasaloy-ai-sdk` |

`packages/ai/package.json` declares the `./sdk` export, and the driver fills it.

## Get a model for a feature

```ts
// apps/api/src/routes/copilot.ts
import { createAi } from "@repo/ai";

const ai = createAi(c.env);
const model = ai.model("copilot");
```

`model(feature)` reads the model id in this order, and the first one set wins:

1. The feature's own env key, `<FEATURE>_MODEL`. `copilot` reads `COPILOT_MODEL`, and `supportChat` or `support-chat` reads `SUPPORT_CHAT_MODEL`.
2. `config.ai.models[feature]` in `packages/config/src/project.ts`.
3. The core's `AI_MODEL` env key.
4. `config.ai.defaultModel`, which ships as `openai/gpt-6-luna`.

A blank env value counts as unset. When no step gives an id, `model()` throws `AiError` with `code: "not_configured"`. `ai.modelId(feature)` returns the id without building the model, for a log line.

A feature module that wants its own model declares its `<FEATURE>_MODEL` key in its own `envVars` and env preset. The `ai` core declares only `AI_PROVIDER` and `AI_MODEL`.

## Handle a failure

Every failure reaches the caller as `AiError`, with `code`, `retryable`, `status` and the vendor's own `providerCode`:

| `code` | Meaning |
| --- | --- |
| `auth` | The key is missing, wrong or revoked. |
| `rate_limited` | Too many requests. `retryable` is true. |
| `quota` | The account is out of credit. |
| `context_length` | The prompt and the reply do not fit the model. |
| `invalid_request` | The vendor refused the request shape. |
| `not_found` | The model id or the endpoint does not exist. |
| `timeout` | The call took too long. |
| `unavailable` | The vendor or the gateway is down. |
| `content_filtered` | A content filter blocked the prompt or the reply. |
| `not_configured` | No model id resolves for the feature. |
| `unknown` | Nothing above fits, or the provider's normalizer failed. |

`ai.normalizeError(error)` turns any thrown value into `AiError` through the selected provider. An `AiError` passes through unchanged. When the provider's `normalizeError` throws or returns something else, the core returns `unknown` with the original error in `cause`.

## Prompt helpers

- `untrusted(text)` wraps text a person typed as `{ untrusted: text }`, so the system prompt can name that key as data and never as instructions. `null` stays `null`.
- `dayLine(now, timeZone, label)` returns `Today is Tuesday, 2026-11-24 in Dhaka`. Put it last in the system prompt, because it changes once a day and a prompt cache keeps everything before it.
- `AiUsageFields` is the shape of the one usage log line per turn: `steps`, `tools`, `inputTokens`, `cachedInputTokens`, `uncachedInputTokens`, `outputTokens`, `reasoningTokens`, `totalTokens` and `cachePercent`. No message text goes in it.

## Settings

| Key | Required | What it does |
| --- | --- | --- |
| `AI_PROVIDER` | Always | The provider that serves models: `gateway` or `mock`. There is no default. |
| `AI_MODEL` | No | The model id for every feature with no id of its own. Blank uses `config.ai.defaultModel`. |

Put both in `packages/env/.env` and run `pnpm env:setup`. In production, set them with `wrangler secret put` or as Worker variables.

`config.ai.defaultModel` and `config.ai.models` are checked-in values. Change them in `packages/config/src/project.ts`. `models` is replaced whole, not merged key by key.

## Writing a provider

Follow `.agents/skills/create-provider/`. A provider is one file in `src/providers/` and one `ai.providers` row. It implements `name`, `languageModel(env, modelId)` and `normalizeError(error)`. `normalizeError` is pure: it reads the error and maps the vendor code onto an `AiError` code, keeps the raw code in `providerCode`, and sets `retryable` honestly.

A provider never wraps the model to catch its errors. A rethrow inside the model's call stops the AI SDK's own retries. The driver calls `ai.normalizeError` at the edge instead.

`@ai-sdk/provider` is a type import only. `scripts/ai-spec-imports.test.ts` in the Saasaloy repo fails on a value import of it in any `ai*` module.

## Removal

Remove the providers and the driver first, because each one depends on `ai`. `saasaloy remove ai` refuses while any of them is installed.

`saasaloy remove ai` deletes the `packages/ai` workspace and `packages/config/src/sections/ai.ts`, drops the `aiEnv()` row from `api.envPresets` and the `aiConfig()` row from `config.sections`, and takes `@repo/ai` out of `apps/api/package.json`. Run `pnpm install` afterwards. A file you edited by hand stays on disk, untracked. `remove` does not edit `packages/env/.env`, so delete the `AI_PROVIDER` and `AI_MODEL` lines by hand. Every route that imports `@repo/ai` stops compiling, and an `ai` override in `packages/config/src/project.ts` stops typechecking until you delete it.

## Failure modes

- `AI_PROVIDER is not set.` thrown by `createAi(env)`. The key is required even with one provider installed. Set it in `packages/env/.env` and run `pnpm env:setup`.
- `AI_PROVIDER is "<x>", which is not registered.` Fix the value, or run `saasaloy add ai-<x>`.
- `AiError("not_configured")` with `No model id for the "<feature>" feature.` Set `<FEATURE>_MODEL` or `AI_MODEL`, or set an id in `config.ai`.
- `AI feature name "<x>" must start with a letter` thrown by `model()`. A feature name becomes an env key, so use letters, digits, `-` and `_`.
- `AiError("unknown")` with `<provider>: the model call failed`. The provider did not recognize the error. Read `cause` for the original.

## Next

Run `saasaloy-env` to set `AI_PROVIDER` and write each service's `.env`.
