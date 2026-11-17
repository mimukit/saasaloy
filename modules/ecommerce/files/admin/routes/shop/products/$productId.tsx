import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { ProductEditor } from "@admin/components/shop/product-editor";
import { ShopRequestError, productQuery } from "@admin/lib/shop-api";

// One stored product, at `/shop/products/<id>`. The loader reads it; the editor keeps its
// own copy of the fields from then on, while the images, the options and the grid follow
// the query, which every write updates.
export const Route = createFileRoute("/shop/products/$productId")({
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(
        productQuery(params.productId)
      );
    } catch (error) {
      if (error instanceof ShopRequestError && error.status === 404) {
        throw notFound();
      }
      throw error;
    }
  },
  component: StoredProduct,
  errorComponent: StoredProductError,
});

function StoredProduct() {
  const { productId } = Route.useParams();
  const { data } = useQuery(productQuery(productId));
  if (!data) {
    return null;
  }
  // Keyed by id, so opening another product starts a fresh form.
  return <ProductEditor key={data.id} product={data} />;
}

function StoredProductError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Product" />
      <ErrorState
        code="500"
        title="The product did not load"
        description="Check that the api is running and that you are signed in to the admin app."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
