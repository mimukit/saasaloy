import { defineColumnClasses } from "../column-class";
import { verifications as verificationsTable } from "../schema/auth";

// How the production read-only role reads `verifications`. See `../column-class.ts`.

export const verifications = defineColumnClasses(verificationsTable, {
  createdAt: "plain",
  expiresAt: "plain",
  id: "plain",
  // Holds the token itself for a password reset (`reset-password:<token>`), and an email for an OTP flow.
  identifier: "secret",
  updatedAt: "plain",
  // The one-time code, or the payload a token unlocks.
  value: "secret",
});
