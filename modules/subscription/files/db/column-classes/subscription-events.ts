import { defineColumnClasses } from "../column-class";
import { subscriptionEvents as subscriptionEventsTable } from "../schema/subscription";

// How the production read-only role reads `subscription_events`. See `../column-class.ts`.

export const subscriptionEvents = defineColumnClasses(subscriptionEventsTable, {
  provider: "plain",
  providerEventId: "plain",
  processedAt: "plain",
  receivedAt: "plain",
  type: "plain",
});
