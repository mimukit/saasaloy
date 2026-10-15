import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the email capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * Keep this line in exactly this shape: `export const emailPreset = definePreset({ extends: [...] })`
 * with a real array literal. A provider module appends its own preset with a
 * `plugin-array` patch, and it fails silently otherwise.
 */
export const emailPreset = definePreset({
  module: "@repo/email",
  extends: [],
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
      .describe(
        "Default sender address, on a domain the selected provider may send from. Overridable per message."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function emailEnv() {
  return emailPreset;
}
