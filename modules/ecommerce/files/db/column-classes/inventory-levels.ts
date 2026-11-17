import { defineColumnClasses } from "../column-class";
import { inventoryLevels as inventoryLevelsTable } from "../schema/ecommerce";

// How the production read-only role reads `inventory_levels`. See `../column-class.ts`.

export const inventoryLevels = defineColumnClasses(inventoryLevelsTable, {
  variantId: "plain",
  onHand: "plain",
  updatedAt: "plain",
});
