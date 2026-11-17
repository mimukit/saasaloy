import { defineColumnClasses } from "../column-class";
import { productImages as productImagesTable } from "../schema/ecommerce";

// How the production read-only role reads `product_images`. See `../column-class.ts`.

export const productImages = defineColumnClasses(productImagesTable, {
  id: "plain",
  productId: "plain",
  variantId: "plain",
  storageObjectId: "plain",
  alt: "plain",
  position: "plain",
  createdAt: "plain",
});
