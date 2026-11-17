import { defineColumnClasses } from "../column-class";
import { auditEvents as auditEventsTable } from "../schema/audit";

// How the production read-only role reads `audit_events`. See `../column-class.ts`.

export const auditEvents = defineColumnClasses(auditEventsTable, {
  id: "plain",
  actorUserId: "plain",
  actorRole: "plain",
  action: "plain",
  targetType: "plain",
  targetId: "plain",
  // The reference an admin reads, which can be a person's email.
  targetLabel: "pii",
  // The changed fields before the write, which can hold a name, an email or a note.
  before: "pii",
  // The changed fields after the write, as `before`.
  after: "pii",
  createdAt: "plain",
});
