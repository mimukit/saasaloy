import { members as membersTable } from "../../schema/teams";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One member for each base role in `acme`, and the plain seed user owning `globex`.

const CREATED = new Date("2026-01-01T00:00:00.000Z");

function member(organization: string, user: string, role: string) {
  return {
    createdAt: CREATED,
    organizationId: seedId("organizations", organization),
    role,
    userId: seedId("users", user),
  };
}

export const members = defineSlice(membersTable, {
  rows: {
    "acme-owner": member("acme", "superadmin", "owner"),
    "acme-admin": member("acme", "admin", "admin"),
    "acme-member": member("acme", "member", "member"),
    "globex-owner": member("globex", "member", "owner"),
  },
});
