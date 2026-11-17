import { productImages as productImagesTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. An image row points at a `file-uploads` object, and a seed has no
// uploaded file to point at. Staff add images from the product editor.

export const productImages = defineSlice(productImagesTable, { rows: {} });
