import { defineColumnClasses } from "../column-class";
import { storageObjects as storageObjectsTable } from "../schema/file-uploads";

// How the production read-only role reads `storage_objects`. See `../column-class.ts`.

export const storageObjects = defineColumnClasses(storageObjectsTable, {
  completedAt: "plain",
  contentType: "plain",
  createdAt: "plain",
  deletedAt: "plain",
  id: "plain",
  // Ends in the file name the uploader chose.
  key: "pii",
  metadata: "plain",
  ownerId: "plain",
  provider: "plain",
  size: "plain",
  status: "plain",
  tenantId: "plain",
  visibility: "plain",
});
