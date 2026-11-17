import { productVariants as productVariantsTable } from "../../schema/ecommerce";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// Three sizes of the tee, the mug's single variant, and the shirt's inactive variant. The
// shirt's has no price in `variant-prices.ts`, so it cannot be made active.

function size(value: string, position: number) {
  return {
    active: true,
    optionValueIds: [seedId("product_option_values", `cotton-tee-${value}`)],
    position,
    productId: seedId("products", "cotton-tee"),
    sku: `TEE-${value.toUpperCase()}`,
    title: value.toUpperCase(),
  };
}

export const productVariants = defineSlice(productVariantsTable, {
  rows: {
    "cotton-tee-s": size("s", 0),
    "cotton-tee-m": size("m", 1),
    "cotton-tee-l": size("l", 2),
    "ceramic-mug": {
      active: true,
      productId: seedId("products", "ceramic-mug"),
      sku: "MUG-350",
      title: "",
    },
    "linen-shirt": {
      active: false,
      productId: seedId("products", "linen-shirt"),
      sku: "SHIRT-LINEN",
      title: "",
    },
  },
});
