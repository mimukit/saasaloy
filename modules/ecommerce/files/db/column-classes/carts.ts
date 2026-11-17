import { defineColumnClasses } from "../column-class";
import { carts as cartsTable } from "../schema/ecommerce";

// How the production read-only role reads `carts`. See `../column-class.ts`.

export const carts = defineColumnClasses(cartsTable, {
  id: "plain",
  userId: "plain",
  currency: "plain",
  expiresAt: "plain",
  createdAt: "plain",
  updatedAt: "plain",
});
