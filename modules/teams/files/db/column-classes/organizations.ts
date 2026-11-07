import { defineColumnClasses } from "../column-class";
import { organizations as organizationsTable } from "../schema/teams";

// How the production read-only role reads `organizations`. See `../column-class.ts`.

export const organizations = defineColumnClasses(organizationsTable, {
  createdAt: "plain",
  id: "plain",
  logo: "plain",
  metadata: "plain",
  name: "plain",
  slug: "plain",
});
