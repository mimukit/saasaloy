import { createFileRoute } from "@tanstack/react-router";

import { ProductEditor } from "@admin/components/shop/product-editor";

// A new product, at `/shop/products/new`. "Create product" stores it and moves the address
// to `/shop/products/<id>`, where the images, the options and the variant grid open.
export const Route = createFileRoute("/shop/products/new")({
  component: NewProduct,
});

function NewProduct() {
  return <ProductEditor product={undefined} />;
}
