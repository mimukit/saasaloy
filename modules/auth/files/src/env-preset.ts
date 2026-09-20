import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys Better Auth reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * Keep this line in exactly this shape: `export const authPreset = definePreset({ extends: [...] })`
 * with a real array literal. A provider module appends its own preset with a
 * `plugin-array` patch, and it fails silently otherwise.
 */
export const authPreset = definePreset({
  module: "@repo/auth",
  extends: [],
  server: {
    BETTER_AUTH_SECRET: z
      .string()
      .optional()
      .describe(
        "Workers secret used to sign sessions. Required unless BETTER_AUTH_URL names a loopback host."
      ),
    BETTER_AUTH_URL: z
      .string()
      .optional()
      .describe(
        "The api's own origin, e.g. https://api.x.com or http://localhost:4000 locally."
      ),
    COOKIE_DOMAIN: z
      .string()
      .optional()
      .describe(
        "Explicit cookie domain for cross-subdomain sessions. Derived from BETTER_AUTH_URL when unset."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function authEnv() {
  return authPreset;
}
