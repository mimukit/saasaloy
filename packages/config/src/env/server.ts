import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://postgres:postgres@localhost:5432/saasaloy"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    BETTER_AUTH_SECRET: z.string().min(1).default("secret"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
  },
  runtimeEnv: typeof process !== "undefined" ? process.env : {},
  skipValidation:
    typeof process === "undefined" || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
