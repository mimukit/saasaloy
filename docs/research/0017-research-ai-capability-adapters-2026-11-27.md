# Research: an `ai` capability for Saasaloy, and which AI libraries it should support

Fetched 2026-11-27, with the gateway section fetched 2026-11-28. Plan: `docs/plans/0128-plan-ai-capability-2026-11-28.md`.

## Recommendation

Type the core's models as AI SDK's `LanguageModelV4` with a type import only, and ship AI SDK as the only runtime in v1. Model vendors and gateways are providers that `AI_PROVIDER` selects at runtime. An AI framework is a driver that a project picks at `add` time. Choose a TanStack AI driver instead if a project wants TanStack AI as its main runtime, because TanStack's adapters do not take a `LanguageModelV4`.

A core that hides AI SDK, TanStack AI, Mastra and eve behind one runtime interface keeps only what all four share. It loses tool approval, structured output, agents and durable runs, and it breaks on each of their major releases.

## Neutral seams

| Seam | Standard | Who supports it |
|---|---|---|
| Model | `LanguageModelV4` in `@ai-sdk/provider` 4.0.39 | AI SDK, Mastra, eve, Cloudflare `agents`, the OpenAI Agents bridge (beta) |
| Tool input | Standard JSON Schema (`@standard-schema/spec` 1.1.0) | AI SDK, Mastra, TanStack AI |
| UI stream | AI SDK UI message stream v1; AG-UI for TanStack | AI SDK, Mastra, the LangChain adapter, Cloudflare; TanStack uses AG-UI |
| External tools | MCP 2026-07-28 | AI SDK, Mastra, TanStack, LangChain |
| Telemetry | OTel `gen_ai.*`, status Development | AI SDK, Mastra |

## Options compared

| Library | Version (date) | Model layer | Runs on Workers | Verdict |
|---|---|---|---|---|
| Vercel AI SDK | `ai` 7.0.183 (2026-11-26), Apache-2.0 | Owns the V4 spec | Yes (Cloudflare docs) | Ship now as the default driver |
| Mastra | 1.86.0 (2026-11-25), 1.0 since 2026-01-20 | Takes AI SDK models | Yes (`@mastra/deployer-cloudflare`) | Next, as an add-on on the same V4 models |
| Cloudflare Agents | `agents` 0.34.1 (2026-11-25), pre-1.0 | AI SDK v6 and v7 | Workers only | Durable Object agents later |
| TanStack AI | 1.8.0 (2026-11-20), 1.0 since 2026-10-22 | Its own adapters | Yes (`ai-cloudflare` adapter) | On demand, as a conflicting driver |
| eve (Vercel) | 1.5.0 (2026-11-25), 1.0 since 2026-11-15 | AI SDK ^7 peer | Not verified | Not an adapter; a standalone agent app on Nitro |
| LangChain / LangGraph | 1.6.8 / 1.7.5 | Its own | Claimed | Skip |
| OpenAI Agents SDK | 0.22.0 | Its own, AI SDK bridge in beta | Partial | Skip |
| VoltAgent | 2.11.1 | AI SDK ^6 only | Not verified | Skip |
| Genkit | 1.44.0 | Its own | Not verified | Skip |
| Claude Agent SDK | 0.3.332 | Its own, native binaries | No | Skip for chat |

## Gateways through `@ai-sdk/openai-compatible`

| Gateway | Base URL | Auth | Model id | Tools and stream usage |
|---|---|---|---|---|
| Cloudflare AI Gateway | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`; the `/compat` URL is deprecated | Bearer Cloudflare API token with Workers AI Read; optional `cf-aig-gateway-id` header | `author/model` | Streaming documented; tools and stream usage not documented |
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer key; optional `HTTP-Referer`, `X-OpenRouter-Title` | `org/model` | All documented; usage arrives in the final chunk |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/v1` | Bearer gateway key or Vercel OIDC token | `provider/model` | Streaming and tools documented; stream usage not documented |
| LiteLLM proxy | `https://<host>/v1` | Bearer virtual key | `model_name` from its config | All documented |

## Evidence (primary sources)

- AI SDK 7.0.0 shipped 2026-06-25, needs Node 22+ and is ESM only → https://vercel.com/blog/ai-sdk-7, https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0
- The V4 spec is public for third parties, and `specificationVersion` must be `'v4'` → https://ai-sdk.dev/providers/community-providers/custom-providers
- The UI message stream v1 is documented for custom backends → https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- Cloudflare `createAI` returns `ProviderV4` and needs `ai@^7` → https://developers.cloudflare.com/agents/models/ai-sdk/
- Mastra takes AI SDK provider modules → https://mastra.ai/models
- TanStack AI 1.0 shipped 2026-10-23, and its stream chunks are AG-UI events → https://tanstack.com/blog/tanstack-ai-1-0, https://tanstack.com/ai/latest/docs/chat/stream-events
- TanStack's only AI SDK bridge is `@tanstack/ai-vercel-compat` 0.1.0, a stream bridge → https://registry.npmjs.org/@tanstack/ai-vercel-compat
- eve is filesystem-first and builds a Nitro server → npm `eve` 1.5.0, https://eve.dev/docs/guides/deployment/self-hosting
- MCP spec 2026-07-28 → https://modelcontextprotocol.io/specification/versioning
- OTel GenAI semconv v0.1.0 (2026-11-21) → https://github.com/open-telemetry/semantic-conventions-genai
- Cloudflare REST endpoint → https://developers.cloudflare.com/ai-gateway/usage/rest-api/ (2026-11-25); the deprecated compat URL → https://developers.cloudflare.com/ai-gateway/usage/chat-completion/ (2026-11-04); unified billing → https://developers.cloudflare.com/ai-gateway/features/unified-billing/ (2026-11-18)
- OpenRouter → https://openrouter.ai/docs/api-reference/overview
- Vercel AI Gateway → https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions (2026-10-07)
- LiteLLM → https://docs.litellm.ai/docs/proxy/user_keys

## Spikes (2026-11-28)

- Errors: a provider maps AI SDK errors to a neutral error with no imports, through the `Symbol.for("vercel.ai.error.AI_*")` markers. A provider that rethrows inside the model stops the AI SDK retries (1 model call instead of 3).
- Workers: `ai` 7.0.183 `streamText` and `toUIMessageStreamResponse` run under workerd 1.20260930.2 with `compatibility_date` 2026-07-21 and no `nodejs_compat` flag.
