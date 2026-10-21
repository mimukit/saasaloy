import { organizations as organizationsTable } from "../../schema/teams";
import { defineSlice } from "../slice";

// Two organizations, so the switcher has somewhere to switch to. `acme` holds every member
// role and every invitation state; `globex` belongs to the plain seed user.

const CREATED = new Date("2026-01-01T00:00:00.000Z");

export const organizations = defineSlice(organizationsTable, {
  rows: {
    acme: { createdAt: CREATED, name: "Acme Inc", slug: "acme" },
    globex: { createdAt: CREATED, name: "Globex", slug: "globex" },
  },
});
