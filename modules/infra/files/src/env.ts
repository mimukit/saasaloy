import { createEnv } from "@repo/env";
import { z } from "@repo/env/zod";

// The deploy credentials, validated once before Pulumi builds a single resource.
//
// This is the one workspace that reads `process.env` on purpose: it is node tooling, not
// runtime capability code. `env-exec infra/.env -- pulumi up` loads `infra/.env` into the
// process, and `infraEnv(process.env)` is what turns that into typed, checked values. The
// boundary is stated in ADR 0041: nothing under a `packages/*/src` a Worker imports reads
// `process.env`, and node tooling reads it freely.

export const infraEnv = createEnv({
  extends: [],
  server: {
    CLOUDFLARE_API_TOKEN: z
      .string()
      .min(1)
      .describe(
        "Cloudflare API token with Workers Scripts and D1 edit, used by the Pulumi provider and wrangler."
      ),
    CLOUDFLARE_DEFAULT_ACCOUNT_ID: z
      .string()
      .min(1)
      .describe("Cloudflare account id resources are provisioned into."),
    PULUMI_CONFIG_PASSPHRASE: z
      .string()
      .min(1)
      .describe(
        "Passphrase for Pulumi's local state encryption. A fixed dev value is fine — no secret enters state."
      ),
  },
  isServer: true,
});
