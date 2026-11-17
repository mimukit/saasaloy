import { inventoryLevels as inventoryLevelsTable } from "../../schema/ecommerce";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// On-hand stock for each state the Products list tones differently: plenty, low (at or
// below `lowStockThreshold`, 5 by default) and sold out.

function level(variant: string, onHand: number) {
  return { onHand, variantId: seedId("product_variants", variant) };
}

export const inventoryLevels = defineSlice(inventoryLevelsTable, {
  rows: {
    "cotton-tee-s": level("cotton-tee-s", 12),
    "cotton-tee-m": level("cotton-tee-m", 3),
    "cotton-tee-l": level("cotton-tee-l", 0),
    "ceramic-mug": level("ceramic-mug", 2),
    "linen-shirt": level("linen-shirt", 8),
  },
});
