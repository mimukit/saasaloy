import { serverEnv } from "@repo/config/env/server";
import { db, schema } from "@repo/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
    },
  }),
  secret: serverEnv.BETTER_AUTH_SECRET,
  baseURL: serverEnv.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: serverEnv.GOOGLE_CLIENT_ID || "",
      clientSecret: serverEnv.GOOGLE_CLIENT_SECRET || "",
    },
    github: {
      clientId: serverEnv.GITHUB_CLIENT_ID || "",
      clientSecret: serverEnv.GITHUB_CLIENT_SECRET || "",
    },
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
