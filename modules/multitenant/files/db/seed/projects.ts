import { projects as projectsTable } from "../../schema/projects";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// Tenant-scoped example rows: two projects in `acme` and one in `globex`, so a list read
// through `forTenant` shows a difference between the two organizations.

export const projects = defineSlice(projectsTable, {
  rows: {
    "acme-website": {
      name: "Website",
      organizationId: seedId("organizations", "acme"),
    },
    "acme-mobile": {
      name: "Mobile app",
      organizationId: seedId("organizations", "acme"),
    },
    "globex-portal": {
      name: "Customer portal",
      organizationId: seedId("organizations", "globex"),
    },
  },
});
