import { defineSection } from "@repo/config/define";

// `ai`'s config section, installed by `saasaloy add ai`. The provider choice, the gateway
// URL and its key are not here: they can differ between two deployments of one project,
// so they are env values. `AI_MODEL` and `<FEATURE>_MODEL` override a model id per deploy.

/** The `ai` section. Override it in `packages/config/src/project.ts`. */
export function aiConfig() {
  return defineSection("ai", {
    /**
     * The model a feature uses when nothing more specific names one, as the gateway's
     * `vendor/model` id. `openai/gpt-6-luna` is a low-cost model that Cloudflare AI Gateway,
     * OpenRouter and Vercel AI Gateway all listed under this same id on 2026-11-28.
     */
    defaultModel: "openai/gpt-6-luna",
    /**
     * A model id per feature, such as `{ copilot: "anthropic/claude-sonnet-5.5" }`. The
     * feature's `<FEATURE>_MODEL` env key wins over its entry here. Empty by default.
     */
    models: {} as Readonly<Record<string, string>>,
  });
}
