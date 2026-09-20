import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the queue capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * Keep this line in exactly this shape: `export const queuePreset = definePreset({ extends: [...] })`
 * with a real array literal. A provider module appends its own preset with a
 * `plugin-array` patch, and it fails silently otherwise.
 */
export const queuePreset = definePreset({
  module: "@repo/queue",
  extends: [],
  server: {
    QUEUE_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed provider runs background work: cloudflare or memory. Always required."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function queueEnv() {
  return queuePreset;
}
