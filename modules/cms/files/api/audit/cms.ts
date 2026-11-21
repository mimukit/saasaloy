import type { AuditActionMap } from "../lib/audit-actions";

export function cmsAuditActions() {
  return {
    "cms.rerender": {
      area: "cms",
      areaLabel: "CMS",
      label: "Rerendered live revisions",
      route: "POST /admin/cms/rerender",
      target: "cms",
    },
    "cms.entry.create": {
      area: "cms",
      label: "Created a draft",
      route: "POST /admin/cms/:collection/entries",
      target: "cms-entry",
    },
    "cms.entry.save": {
      area: "cms",
      label: "Saved a draft",
      route: "PUT /admin/cms/:collection/entries/:id",
      target: "cms-entry",
    },
    "cms.entry.delete": {
      area: "cms",
      label: "Deleted an entry",
      route: "DELETE /admin/cms/:collection/entries/:id",
      target: "cms-entry",
    },
    "cms.entry.publish": {
      area: "cms",
      label: "Published an entry",
      route: "POST /admin/cms/:collection/entries/:id/publish",
      target: "cms-entry",
    },
    "cms.entry.unpublish": {
      area: "cms",
      label: "Unpublished an entry",
      route: "POST /admin/cms/:collection/entries/:id/unpublish",
      target: "cms-entry",
    },
    "cms.entry.archive": {
      area: "cms",
      label: "Archived an entry",
      route: "POST /admin/cms/:collection/entries/:id/archive",
      target: "cms-entry",
    },
    "cms.revision.restore": {
      area: "cms",
      label: "Restored a revision",
      route:
        "POST /admin/cms/:collection/entries/:id/revisions/:revisionId/restore",
      target: "cms-entry",
    },
  } as const satisfies AuditActionMap;
}
