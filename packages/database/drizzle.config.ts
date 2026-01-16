import { serverEnv } from "@repo/config/env/server";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/providers/drizzle/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: serverEnv.DATABASE_URL,
  },
});
