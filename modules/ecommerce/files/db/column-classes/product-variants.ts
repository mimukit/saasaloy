import { defineColumnClasses } from "../column-class";
import { productVariants as productVariantsTable } from "../schema/ecommerce";

// How the production read-only role reads `product_variants`. See `../column-class.ts`.

export const productVariants = defineColumnClasses(productVariantsTable, {
  id: "plain",
  productId: "plain",
  title: "plain",
  sku: "plain",
  optionValueIds: "plain",
  active: "plain",
  position: "plain",
  createdAt: "plain",
  updatedAt: "plain",
});
