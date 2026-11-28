import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";
import { aiEnvPresets } from "./env-preset.generated";

// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

// Kept apart from `aiPreset` so a provider preset can tighten a key: `createEnv` walks
// `extends` in order and the last declaration of a key wins, so this stays the first entry.
const aiCorePreset = definePreset({
  module: "@repo/ai",
  server: {
    AI_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed provider serves models: gateway or mock. Always required, with no default."
      ),
    AI_MODEL: z
      .string()
      .optional()
      .describe(
        "The model id for every feature with no id of its own. Blank uses config.ai.defaultModel."
      ),
  },
});

/** The capability's preset, then every provider preset from `./env-preset.generated.ts`. */
export const aiPreset = definePreset({
  module: "@repo/ai",
  extends: [aiCorePreset, ...aiEnvPresets],
});

/** The preset a service's `env.ts` folds in. */
export function aiEnv() {
  return aiPreset;
}
