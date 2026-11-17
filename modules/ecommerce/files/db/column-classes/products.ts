import { defineColumnClasses } from "../column-class";
import { products as productsTable } from "../schema/ecommerce";

// How the production read-only role reads `products`. See `../column-class.ts`.

export const products = defineColumnClasses(productsTable, {
  id: "plain",
  title: "plain",
  slug: "plain",
  status: "plain",
  description: "plain",
  descriptionHtml: "plain",
  categoryId: "plain",
  createdAt: "plain",
  updatedAt: "plain",
});
