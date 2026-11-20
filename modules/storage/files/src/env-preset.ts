import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";
import { storageEnvPresets } from "./env-preset.generated";

// The environment keys the storage capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * The capability's preset, then every provider preset. A provider module adds its own to
 * `./env-preset.generated.ts`, which the CLI writes on every run.
 */
export const storagePreset = definePreset({
  module: "@repo/storage",
  extends: [...storageEnvPresets],
  server: {
    STORAGE_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed provider stores objects: cloudflare or memory. Always required."
      ),
    STORAGE_URL_SECRET: z
      .string()
      .min(1)
      .describe(
        "HMAC key that signs the upload and download links the proxy route accepts. Make it with openssl rand -base64 32."
      ),
    STORAGE_PROXY_URL: z
      .string()
      .optional()
      .describe(
        "Absolute origin the proxy route answers on. A proxy link is root-relative when it is unset."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function storageEnv() {
  return storagePreset;
}
