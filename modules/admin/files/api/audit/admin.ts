import type { AuditActionMap } from "../lib/audit-actions";

// The admin module's own audit actions: the members routes in `../routes/admin-members.ts`,
// one action per change to the admin group. Better Auth makes each change, so each route
// writes its row through `adminAuthWrite`. A member's password never reaches a row; only
// the fact that it was set does.
//
// This file is the model for every module's action file: one function, named after the
// module, that returns its actions. The descriptor's `plugin-array` patch appends the call
// into `AUDIT_ACTIONS` in `../lib/audit-actions.ts`. `as const` keeps each key a literal,
// so `audit({ action })` in a route only accepts an action some module registers.
export function adminAuditActions() {
  return {
    "member.add": {
      area: "members",
      areaLabel: "Members",
      label: "Added a member",
      route: "POST /admin/members",
      target: "member",
    },
    "member.password.set": {
      area: "members",
      label: "Reset a password",
      route: "POST /admin/members/:id/password",
      target: "member",
    },
    "member.profile.update": {
      area: "members",
      label: "Changed a name",
      route: "PATCH /admin/members/:id",
      target: "member",
    },
    "member.remove": {
      area: "members",
      label: "Removed a member",
      route: "DELETE /admin/members/:id",
      target: "member",
    },
    "member.restore": {
      area: "members",
      label: "Restored a member",
      route: "POST /admin/members/:id/restore",
      target: "member",
    },
  } as const satisfies AuditActionMap;
}
