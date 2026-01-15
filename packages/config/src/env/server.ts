import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  runtimeEnv: typeof process !== "undefined" ? process.env : {},
  skipValidation:
    typeof process === "undefined" || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
