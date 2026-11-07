import { defineColumnClasses } from "../column-class";
import { billingEvents as billingEventsTable } from "../schema/billing";

// How the production read-only role reads `billing_events`. See `../column-class.ts`.

export const billingEvents = defineColumnClasses(billingEventsTable, {
  provider: "plain",
  providerEventId: "plain",
  processedAt: "plain",
  receivedAt: "plain",
  type: "plain",
});
