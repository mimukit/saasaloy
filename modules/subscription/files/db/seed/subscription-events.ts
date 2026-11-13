import { subscriptionEvents as subscriptionEventsTable } from "../../schema/subscription";
import { defineSlice } from "../slice";

// Two webhook events: one whose side effects finished, and one still in flight. The
// composite primary key (`provider`, `providerEventId`) is the conflict key, so these rows
// name no id.

export const subscriptionEvents = defineSlice(subscriptionEventsTable, {
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
