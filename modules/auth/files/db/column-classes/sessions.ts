import { defineColumnClasses } from "../column-class";
import { sessions as sessionsTable } from "../schema/auth";

// How the production read-only role reads `sessions`. See `../column-class.ts`.

export const sessions = defineColumnClasses(sessionsTable, {
  createdAt: "plain",
  expiresAt: "plain",
  id: "plain",
  // An IP address.
  ipAddress: "pii",
  // The session cookie value: holding it is being signed in.
  token: "secret",
  updatedAt: "plain",
  userAgent: "plain",
  userId: "plain",
  impersonatedBy: "plain",
  activeOrganizationId: "plain",
  audience: "plain",
});
