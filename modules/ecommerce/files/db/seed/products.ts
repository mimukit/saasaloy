import { products as productsTable } from "../../schema/ecommerce";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One product for each state the admin Products list shows differently: an active product
// with three sizes (one sold out), an active product with one variant and low stock, and a
// draft whose only variant has no price yet, so it cannot go active.

function description(text: string) {
  return {
    description: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
    descriptionHtml: `<p>${text}</p>`,
  };
}

export const products = defineSlice(productsTable, {
  rows: {
    "cotton-tee": {
      ...description("A soft cotton tee in three sizes."),
      categoryId: seedId("product_categories", "apparel"),
      slug: "cotton-tee",
      status: "active",
      title: "Cotton tee",
    },
    "ceramic-mug": {
      ...description("A 350 ml ceramic mug."),
      categoryId: seedId("product_categories", "home"),
      slug: "ceramic-mug",
      status: "active",
      title: "Ceramic mug",
    },
    "linen-shirt": {
      ...description("A linen shirt, not priced yet."),
      categoryId: seedId("product_categories", "apparel"),
      slug: "linen-shirt",
      status: "draft",
      title: "Linen shirt",
    },
  },
});
