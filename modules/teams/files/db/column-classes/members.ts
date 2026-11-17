import { defineColumnClasses } from "../column-class";
import { members as membersTable } from "../schema/teams";

// How the production read-only role reads `members`. See `../column-class.ts`.

export const members = defineColumnClasses(membersTable, {
  createdAt: "plain",
  id: "plain",
  organizationId: "plain",
  role: "plain",
  userId: "plain",
});
