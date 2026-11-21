import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the logger capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * No module adds a preset to `extends`, so it is a plain array with no generated table
 * behind it. A preset of your own goes in it by hand.
 */
export const loggerPreset = definePreset({
  module: "@repo/logger",
  extends: [],
  server: {
    LOGGER_PROVIDER: z
      .string()
      .optional()
      .describe(
        "Which installed provider writes. Unset selects the first registered provider."
      ),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info")
      .describe("Minimum level to emit. info when unset."),
  },
});

/** The preset a service's `env.ts` folds in. */
export function loggerEnv() {
  return loggerPreset;
}
