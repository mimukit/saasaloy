import { invitations as invitationsTable } from "../../schema/teams";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One invitation to `acme` for each state the members page shows: pending, expired,
// accepted, rejected and canceled. The dates are fixed, so a rerun writes the same rows.

const LATER = new Date("2099-01-01T00:00:00.000Z");
const EARLIER = new Date("2020-01-01T00:00:00.000Z");

function invitation(email: string, status: string, expiresAt = LATER) {
  return {
    email,
    expiresAt,
    inviterId: seedId("users", "superadmin"),
    organizationId: seedId("organizations", "acme"),
    role: "member",
    status,
  };
}

export const invitations = defineSlice(invitationsTable, {
  rows: {
    accepted: invitation("accepted@example.test", "accepted"),
    canceled: invitation("canceled@example.test", "canceled"),
    expired: invitation("expired@example.test", "pending", EARLIER),
    pending: invitation("pending@example.test", "pending"),
    rejected: invitation("rejected@example.test", "rejected"),
  },
});
