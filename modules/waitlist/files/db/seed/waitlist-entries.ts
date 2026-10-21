import { waitlistEntries as waitlistEntriesTable } from "../../schema/waitlist";
import { defineSlice } from "../slice";

// Two signups. The database generates `id`, so the slice upserts on `email`, and no other
// slice can point at these rows by slug.

export const waitlistEntries = defineSlice(waitlistEntriesTable, {
  key: ["email"],
  rows: {
    first: { email: "first@example.test" },
    second: { email: "second@example.test" },
  },
});
