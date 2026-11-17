import { defineColumnClasses } from "../column-class";
import { shippingZones as shippingZonesTable } from "../schema/ecommerce";

// How the production read-only role reads `shipping_zones`. See `../column-class.ts`.

export const shippingZones = defineColumnClasses(shippingZonesTable, {
  id: "plain",
  name: "plain",
  rate: "plain",
  currency: "plain",
  active: "plain",
  position: "plain",
  createdAt: "plain",
  updatedAt: "plain",
});
