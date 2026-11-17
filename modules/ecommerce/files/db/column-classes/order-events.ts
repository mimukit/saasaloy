import { defineColumnClasses } from "../column-class";
import { orderEvents as orderEventsTable } from "../schema/ecommerce";

// How the production read-only role reads `order_events`. See `../column-class.ts`.

export const orderEvents = defineColumnClasses(orderEventsTable, {
  id: "plain",
  orderId: "plain",
  fromStatus: "plain",
  toStatus: "plain",
  actorType: "plain",
  actorUserId: "plain",
  // Free text a staff member wrote, which can name the buyer.
  note: "pii",
  createdAt: "plain",
});
