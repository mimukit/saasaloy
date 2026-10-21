import { organizationRoles as organizationRolesTable } from "../../schema/teams";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One custom role in `acme`, beside the three base roles that live in code. `permission`
// is the JSON Better Auth's dynamic access control stores: a resource mapped to its actions.

export const organizationRoles = defineSlice(organizationRolesTable, {
  rows: {
    "acme-viewer": {
      organizationId: seedId("organizations", "acme"),
      permission: JSON.stringify({ project: ["read"] }),
      role: "viewer",
    },
  },
});
