import { defineColumnClasses } from "../column-class";
import { organizationRoles as organizationRolesTable } from "../schema/teams";

// How the production read-only role reads `organization_roles`. See `../column-class.ts`.

export const organizationRoles = defineColumnClasses(organizationRolesTable, {
  createdAt: "plain",
  id: "plain",
  organizationId: "plain",
  permission: "plain",
  role: "plain",
  updatedAt: "plain",
});
