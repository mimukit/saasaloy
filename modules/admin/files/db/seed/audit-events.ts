import { config } from "@repo/config";
import { auditEvents as auditEventsTable } from "../../schema/audit";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// Example audit rows, by the two seeded admins, so the Activity page has something to list
// on a fresh database. They name the admin module's own target, a member, so the slice
// holds with no other module installed: the superadmin adds the admin, then the admin
// fixes their own name. Each row holds only the fields that changed, under dot paths, as
// `adminWrite` writes them.
//
// The actions are examples, not entries of `apps/api/src/lib/audit-actions.ts`: a row
// whose action no module names any more is what an Activity page shows after a module is
// removed, and it has to read well too.

export const auditEvents = defineSlice(auditEventsTable, {
  rows: {
    "member-add": {
      action: "member.add",
      actorRole: config.auth.superadminRole,
      actorUserId: seedId("users", "superadmin"),
      after: {
        email: "admin@example.test",
        name: "Alan Admin",
        role: config.auth.adminRole,
      },
      before: null,
      createdAt: new Date("2026-01-01T09:00:00.000Z"),
      targetId: seedId("users", "admin"),
      targetLabel: "admin@example.test",
      targetType: "member",
    },
    "member-profile-update": {
      action: "member.profile.update",
      actorRole: config.auth.adminRole,
      actorUserId: seedId("users", "admin"),
      after: { name: "Alan Admin" },
      before: { name: "Alan" },
      createdAt: new Date("2026-01-01T09:30:00.000Z"),
      targetId: seedId("users", "admin"),
      targetLabel: "admin@example.test",
      targetType: "member",
    },
  },
});
