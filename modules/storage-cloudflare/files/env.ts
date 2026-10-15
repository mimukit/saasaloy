import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the R2 provider reads. All four are optional together: leave them
// unset and reads and writes still work through the R2 binding, with every transfer going
// through the proxy route. Set all four to hand a browser a presigned URL instead.

export const r2EnvPreset = definePreset({
  module: "storage-cloudflare",
  server: {
    R2_ACCOUNT_ID: z
      .string()
      .optional()
      .describe(
        "Cloudflare account id, from the dashboard URL or `wrangler whoami`."
      ),
    R2_ACCESS_KEY_ID: z
      .string()
      .optional()
      .describe(
        "Access key id of an R2 API token with Object Read & Write. The Worker binding cannot sign a URL."
      ),
    R2_SECRET_ACCESS_KEY: z
      .string()
      .optional()
      .describe(
        "Secret access key shown once when the R2 API token is created."
      ),
    R2_BUCKET_NAME: z
      .string()
      .optional()
      .describe(
        "Name of the bucket the S3-compatible URL addresses. It must be the bucket the BUCKET binding points at."
      ),
  },
});

export function r2Env() {
  return r2EnvPreset;
}
