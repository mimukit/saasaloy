import { defineColumnClasses } from "../column-class";
import { productOptions as productOptionsTable } from "../schema/ecommerce";

// How the production read-only role reads `product_options`. See `../column-class.ts`.

export const productOptions = defineColumnClasses(productOptionsTable, {
  id: "plain",
  productId: "plain",
  name: "plain",
  position: "plain",
});
