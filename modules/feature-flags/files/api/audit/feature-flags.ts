import type { AuditActionMap } from "../lib/audit-actions";

// The feature-flags module's audit actions, one per write route under `/admin/flags`. The
// descriptor's `plugin-array` patch appends `featureFlagsAuditActions()` into
// `AUDIT_ACTIONS` in `../lib/audit-actions.ts`, so `saasaloy remove feature-flags` takes
// these with it.
//
// The target is the flag, with the flag key as its id, so a filter by target finds the
// global value and every tenant override of one flag. A tenant action's label names the
// tenant too.
export function featureFlagsAuditActions() {
  return {
    "flag.tenant.clear": {
      area: "flags",
      areaLabel: "Flags",
      label: "Cleared a flag for a tenant",
      route: "DELETE /admin/flags/:key/tenants/:tenantId",
      target: "flag",
    },
    "flag.tenant.set": {
      area: "flags",
      label: "Set a flag for a tenant",
      route: "PUT /admin/flags/:key/tenants/:tenantId",
      target: "flag",
    },
    "flag.value.set": {
      area: "flags",
      label: "Set a flag",
      route: "PUT /admin/flags/:key",
      target: "flag",
    },
  } as const satisfies AuditActionMap;
}
