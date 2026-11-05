import { defineColumnClasses } from "../column-class";
import { paymentEvents as paymentEventsTable } from "../schema/payment";

// How the production read-only role reads `payment_events`. See `../column-class.ts`.

export const paymentEvents = defineColumnClasses(paymentEventsTable, {
  id: "plain",
  paymentId: "plain",
  fromStatus: "plain",
  toStatus: "plain",
  actorUserId: "plain",
  reason: "plain",
  // Free text staff wrote to the payer.
  note: "pii",
  createdAt: "plain",
});
