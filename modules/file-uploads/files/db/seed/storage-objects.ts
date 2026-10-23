import { storageObjects as storageObjectsTable } from "../../schema/file-uploads";
import { defineSlice } from "../slice";

// Empty on purpose. A row here records bytes in a bucket, and a seeded row would point at
// an object nothing uploaded, so every download and public URL it offered would 404. The
// slice records that choice, and the completeness test sees it.

export const storageObjects = defineSlice(storageObjectsTable, { rows: {} });
