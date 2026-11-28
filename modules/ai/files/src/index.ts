import { defineAi } from "./define";
import type { AiEnv } from "./provider";
import { aiProviders } from "./providers.generated";

export { defineAi, featureModelKey } from "./define";
export type { AiClient, AiConfig, AiRegistry } from "./define";
export { dayLine, untrusted } from "./prompt";
export { AiError } from "./provider";
export type {
  AiEnv,
  AiErrorCode,
  AiErrorOptions,
  AiProvider,
} from "./provider";
export type { AiUsageFields } from "./usage";

// Every `ai-<provider>` module adds a row to the `ai.providers` table, and the CLI writes
// `./providers.generated.ts` from those rows on every run. A provider of your own goes
// after the spread, never in the generated file: the CLI overwrites it, and
// `saasaloy update` refuses when it was edited.
export const ai = defineAi({ providers: [...aiProviders] });

/**
 * Get the models for this request's environment. It takes the whole `env`, because which
 * key the active provider reads is what a calling route must not know.
 *
 * ```ts
 * const models = createAi(c.env);
 * const model = models.model("copilot");
 * ```
 *
 * Throws when `AI_PROVIDER` is unset or names a provider that is not installed.
 */
export function createAi(env: AiEnv) {
  return ai.create(env);
}
