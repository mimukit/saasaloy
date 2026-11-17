import { defineColumnClasses } from "../column-class";
import { orders as ordersTable } from "../schema/ecommerce";

// How the production read-only role reads `orders`. See `../column-class.ts`.

export const orders = defineColumnClasses(ordersTable, {
  id: "plain",
  number: "plain",
  userId: "plain",
  status: "plain",
  // The buyer's name.
  contactName: "pii",
  // The buyer's phone number.
  contactPhone: "pii",
  // The delivery address, with the recipient's name and phone.
  shippingAddress: "pii",
  zoneId: "plain",
  zoneName: "plain",
  paymentMethod: "plain",
  currency: "plain",
  subtotal: "plain",
  shipping: "plain",
  total: "plain",
  // Free text the buyer wrote at checkout.
  note: "pii",
  createdAt: "plain",
  updatedAt: "plain",
});
