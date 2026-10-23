import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the file-uploads feature reads. `apps/api/src/env.ts` folds this preset in, so a malformed
// key is named at the gate rather than thrown from inside a route on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * Keep this line in exactly this shape: `export const fileUploadsPreset = definePreset({ extends: [...] })`
 * with a real array literal. A provider module appends its own preset with a
 * `plugin-array` patch, and it fails silently otherwise.
 */
export const fileUploadsPreset = definePreset({
  module: "@repo/file-uploads",
  extends: [],
  server: {
    STORAGE_PUBLIC_URL: z
      .string()
      .optional()
      .describe(
        "Origin a public object is served from. Unset refuses a public upload by name."
      ),
    STORAGE_IMAGE_TRANSFORMS: z
      .string()
      .optional()
      .describe(
        "true when Cloudflare image transformations are enabled on the zone serving STORAGE_PUBLIC_URL. Off when unset."
      ),
    STORAGE_PURGE_AFTER_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(30)
      .describe(
        "Days a soft-deleted row is kept before the sweep drops it. 30 when unset."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function fileUploadsEnv() {
  return fileUploadsPreset;
}
