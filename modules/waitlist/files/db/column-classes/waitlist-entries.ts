import { defineColumnClasses } from "../column-class";
import { waitlistEntries as waitlistEntriesTable } from "../schema/waitlist";

// How the production read-only role reads `waitlist_entries`. See `../column-class.ts`.

export const waitlistEntries = defineColumnClasses(waitlistEntriesTable, {
  createdAt: "plain",
  // The email a visitor left.
  email: "pii",
  id: "plain",
});
