import { billingEvents as billingEventsTable } from "../../schema/billing";
import { defineSlice } from "../slice";

// Two webhook events: one whose side effects finished, and one still in flight. The
// composite primary key (`provider`, `providerEventId`) is the conflict key, so these rows
// name no id.

export const billingEvents = defineSlice(billingEventsTable, {
  rows: {
    "in-flight": {
      provider: "console",
      providerEventId: "seed_evt_in_flight",
      type: "payment.failed",
    },
    processed: {
      processedAt: new Date("2026-01-01T00:00:00.000Z"),
      provider: "console",
      providerEventId: "seed_evt_processed",
      type: "subscription.changed",
    },
  },
});
