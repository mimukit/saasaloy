import { productOptionValues as productOptionValuesTable } from "../../schema/ecommerce";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// The cotton tee's sizes, one per variant in `product-variants.ts`.

const optionId = seedId("product_options", "cotton-tee-size");

export const productOptionValues = defineSlice(productOptionValuesTable, {
  rows: {
    "cotton-tee-s": { optionId, position: 0, value: "S" },
    "cotton-tee-m": { optionId, position: 1, value: "M" },
    "cotton-tee-l": { optionId, position: 2, value: "L" },
  },
});
