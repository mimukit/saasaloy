import { defineColumnClasses } from "../column-class";
import { stockMovements as stockMovementsTable } from "../schema/ecommerce";

// How the production read-only role reads `stock_movements`. See `../column-class.ts`.

export const stockMovements = defineColumnClasses(stockMovementsTable, {
  id: "plain",
  variantId: "plain",
  orderId: "plain",
  delta: "plain",
  reason: "plain",
  actorUserId: "plain",
  // Free text a staff member wrote.
  note: "pii",
  createdAt: "plain",
});
