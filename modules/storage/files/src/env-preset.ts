import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the storage capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * Keep this line in exactly this shape: `export const storagePreset = definePreset({ extends: [...] })`
 * with a real array literal. A provider module appends its own preset with a
 * `plugin-array` patch, and it fails silently otherwise.
 */
export const storagePreset = definePreset({
  module: "@repo/storage",
  extends: [],
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
    STORAGE_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(104_857_600)
      .describe("Per-file upload cap in bytes. 100 MiB when unset."),
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
