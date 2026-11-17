import { productCategories as productCategoriesTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Two categories, so the catalog filter and the product editor's picker each have a choice.

export const productCategories = defineSlice(productCategoriesTable, {
  rows: {
    apparel: { name: "Apparel", position: 0, slug: "apparel" },
    home: { name: "Home", position: 1, slug: "home" },
  },
});
