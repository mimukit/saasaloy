import { defineColumnClasses } from "../column-class";
import { projects as projectsTable } from "../schema/projects";

// How the production read-only role reads `projects`. See `../column-class.ts`.

export const projects = defineColumnClasses(projectsTable, {
  createdAt: "plain",
  id: "plain",
  name: "plain",
  organizationId: "plain",
});
