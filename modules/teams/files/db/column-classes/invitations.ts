import { defineColumnClasses } from "../column-class";
import { invitations as invitationsTable } from "../schema/teams";

// How the production read-only role reads `invitations`. See `../column-class.ts`.

export const invitations = defineColumnClasses(invitationsTable, {
  createdAt: "plain",
  // The invitee's email.
  email: "pii",
  expiresAt: "plain",
  id: "plain",
  inviterId: "plain",
  organizationId: "plain",
  role: "plain",
  status: "plain",
});
