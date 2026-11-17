import { productOptions as productOptionsTable } from "../../schema/ecommerce";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// The cotton tee's one option. The mug and the shirt have a single variant and no option.

export const productOptions = defineSlice(productOptionsTable, {
  rows: {
    "cotton-tee-size": {
      name: "Size",
      position: 0,
      productId: seedId("products", "cotton-tee"),
    },
  },
});
