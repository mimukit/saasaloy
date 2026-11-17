import { defineColumnClasses } from "../column-class";
import { orderItems as orderItemsTable } from "../schema/ecommerce";

// How the production read-only role reads `order_items`. See `../column-class.ts`.

export const orderItems = defineColumnClasses(orderItemsTable, {
  id: "plain",
  orderId: "plain",
  productId: "plain",
  variantId: "plain",
  productTitle: "plain",
  variantTitle: "plain",
  sku: "plain",
  unitPrice: "plain",
  quantity: "plain",
  lineTotal: "plain",
});
