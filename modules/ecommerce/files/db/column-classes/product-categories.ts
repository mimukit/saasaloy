import { defineColumnClasses } from "../column-class";
import { productCategories as productCategoriesTable } from "../schema/ecommerce";

// How the production read-only role reads `product_categories`. See `../column-class.ts`.

export const productCategories = defineColumnClasses(productCategoriesTable, {
  id: "plain",
  name: "plain",
  slug: "plain",
  position: "plain",
  createdAt: "plain",
});
