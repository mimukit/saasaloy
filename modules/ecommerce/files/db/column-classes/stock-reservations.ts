import { defineColumnClasses } from "../column-class";
import { stockReservations as stockReservationsTable } from "../schema/ecommerce";

// How the production read-only role reads `stock_reservations`. See `../column-class.ts`.

export const stockReservations = defineColumnClasses(stockReservationsTable, {
  id: "plain",
  variantId: "plain",
  orderId: "plain",
  quantity: "plain",
  expiresAt: "plain",
  createdAt: "plain",
});
