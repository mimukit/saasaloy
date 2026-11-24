import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";
import { emailEnvPresets } from "./env-preset.generated";

// The environment keys the email capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * The capability's preset, then every provider preset. A provider module adds its own to
 * `./env-preset.generated.ts`, which the CLI writes on every run.
 */
export const emailPreset = definePreset({
  module: "@repo/email",
  extends: [...emailEnvPresets],
  server: {
    EMAIL_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed provider sends: cloudflare, plunk or console. Always required — there is no default."
      ),
    EMAIL_FROM: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Default sender address, on a domain the selected provider may send from. Overridable per message. Required for every provider except console."
      ),
  },
  // The console provider logs instead of sending and brings its own sender, so a project
  // that develops on it needs no address. Every other provider sends real mail and needs one.
  requiredWhen: { EMAIL_FROM: { key: "EMAIL_PROVIDER", isNot: "console" } },
});

/** The preset a service's `env.ts` folds in. */
export function emailEnv() {
  return emailPreset;
}
