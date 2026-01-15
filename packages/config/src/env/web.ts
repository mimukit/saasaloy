import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const webEnv = createEnv({
  clientPrefix: "PUBLIC_",
  client: {
    PUBLIC_API_URL: z.string().url(),
  },
  runtimeEnv: (
    import.meta as unknown as { env: Record<string, string | undefined> }
  ).env,
  emptyStringAsUndefined: true,
});
