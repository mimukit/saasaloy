import { variantPrices as variantPricesTable } from "../../schema/ecommerce";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// A BDT price for every active variant, in poisha: the tee at 650 taka, the mug at 450.50.
// The linen shirt's variant has no row, which is why it stays inactive.

function price(variant: string, amount: number) {
  return {
    amount,
    currency: "BDT",
    variantId: seedId("product_variants", variant),
  };
}

export const variantPrices = defineSlice(variantPricesTable, {
  rows: {
    "cotton-tee-s": price("cotton-tee-s", 65_000),
    "cotton-tee-m": price("cotton-tee-m", 65_000),
    "cotton-tee-l": price("cotton-tee-l", 65_000),
    "ceramic-mug": price("ceramic-mug", 45_050),
  },
});
