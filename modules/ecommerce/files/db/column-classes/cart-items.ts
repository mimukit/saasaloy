import { defineColumnClasses } from "../column-class";
import { cartItems as cartItemsTable } from "../schema/ecommerce";

// How the production read-only role reads `cart_items`. See `../column-class.ts`.

export const cartItems = defineColumnClasses(cartItemsTable, {
  id: "plain",
  cartId: "plain",
  variantId: "plain",
  quantity: "plain",
  createdAt: "plain",
  updatedAt: "plain",
});
