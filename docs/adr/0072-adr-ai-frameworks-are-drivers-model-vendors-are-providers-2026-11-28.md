# 0072: AI frameworks are drivers, model vendors are providers, and the core contract is `LanguageModelV4`

Saasaloy had no AI capability. A project that added an AI feature copied PrimeShopr's `@repo/ai` code, picked its own vendor wiring and drifted on error handling and usage logging. An AI capability has two layers that change for different reasons. The model vendor or gateway changes with a key and a URL. The framework (AI SDK, TanStack AI, Mastra) owns the streaming, the tool loop and the client hook, so a change of framework rewrites the route code. Research [0017](../research/0017-research-ai-capability-adapters-2026-11-27.md) and the grill of plan [0128](../plans/0128-plan-ai-capability-2026-11-28.md) on 2026-11-28 settled the split.

**The core contract is `LanguageModelV4` from `@ai-sdk/provider`, imported with `import type` only.** `createAi(env).model(feature)` returns a `LanguageModelV4`. AI SDK 7, Mastra, Vercel `eve` and Cloudflare `agents` all take that type, so one set of providers serves each of them. `@ai-sdk/provider` is an exact-pinned dependency of `packages/ai`, and `scripts/ai-spec-imports.test.ts` fails on a value import of it, or on any import of `ai` outside the driver. AGENTS.md's vendor-blind rule allows a type-only import of a shared spec package.

**A model vendor or gateway is a provider (ADR 0033, ADR 0037).** `AI_PROVIDER` selects one at runtime and holds one value, because each gateway does its own fallback. v1 ships `ai-gateway`, one file on `@ai-sdk/openai-compatible` for Cloudflare AI Gateway, OpenRouter and Vercel AI Gateway, and `ai-mock`, a scripted model with no imports. A provider owns a pure `normalizeError(err): AiError` and never wraps the model, because a rethrow inside `doGenerate` stopped the AI SDK retries in spike 1.

**An AI framework is a driver (ADR 0026).** The framework owns the runtime files: the server helpers in `packages/ai/src/sdk/` and the chat island in `apps/app`. A change of framework replaces those files, so it is chosen at `add` time, not by an env var. The core names its one driver in `requiresOneOf: ["ai-sdk"]`, as `database` does. A later `ai-tanstack` declares `conflictsWith: ["ai-sdk"]`. A later Mastra module adds on top of `ai-sdk`, because it takes the same V4 models.

**The chat UI splits on the same line (ADR 0030).** The core ships the presentational chat block `@ui/blocks/ai-chat.tsx` with neutral props and no framework import. The driver ships the chat island that maps the framework's messages to the block's props.

## Status

accepted. It applies ADRs 0026, 0033 and 0037 to one capability: the provider shape of `kv` plus the driver split of `database`.

## Considered Options

- **A Saasaloy-owned model interface with adapters to V4 and TanStack.** Rejected. It invents a third spec, duplicates what V4 already covers, and needs work on every AI SDK release.
- **One runtime interface over every framework.** Rejected. It keeps only what all frameworks share, so it loses tool approval, structured output and agents.
- **The AI SDK in the core.** Rejected. It breaks the zero-dependency core rule, and a TanStack project would carry an unused framework.
- **Each framework as a provider selected by an env var.** Rejected. A framework replaces route and island code, which an env var cannot swap.
- **A direct vendor provider per vendor (`ai-openai`, `ai-anthropic`).** Deferred. The gateways reach those vendors in v1, and a direct provider adds one file later.

## Consequences

- A project changes its gateway or its model with an env change and no code change: `AI_PROVIDER`, `AI_MODEL` or a feature's `<FEATURE>_MODEL`.
- Vercel controls `LanguageModelV4`. A V5 spec needs a coordinated bump of the core and every provider.
- `saasaloy add ai` also adds `ai-sdk` and its `app` dependency, because the core requires one driver.
- TanStack AI does not take a V4 model, so a later `ai-tanstack` driver needs its own adapter from the providers' models, or its own provider contract. Its plan decides.
- Every error reaches a caller as `AiError` with one code set, and every turn logs one usage line, whichever provider serves it.
