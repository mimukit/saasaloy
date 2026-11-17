import type { Db } from "@repo/db/client";
import type {
  CatalogProduct,
  ProductSummary,
} from "@repo/db/repositories/ecommerce/catalog";
import { productImages } from "@repo/db/schema/ecommerce";
import { storageObjects } from "@repo/db/schema/file-uploads";
import { asc, eq, inArray } from "drizzle-orm";
import { publicImageUrl } from "../file-uploads";
import type { FileUploadsEnv } from "../file-uploads";

// The catalog as the storefront reads it: store-currency prices, available stock, and
// image URLs built by `file-uploads`. A draft product, an inactive variant and a price in
// another currency never leave here.

/** One image with its public URL. Null URL when the project serves no public bucket. */
export interface ImageView {
  id: string;
  url: string | null;
  alt: string;
  variantId: string | null;
}

/** Every image of `productIds`, keyed by product, in position order. */
export async function imagesOf(
  db: Db,
  env: FileUploadsEnv,
  productIds: readonly string[]
): Promise<Map<string, ImageView[]>> {
  const byProduct = new Map<string, ImageView[]>();
  if (productIds.length === 0) {
    return byProduct;
  }
  const rows = await db
    .select({
      alt: productImages.alt,
      id: productImages.id,
      key: storageObjects.key,
      productId: productImages.productId,
      variantId: productImages.variantId,
    })
    .from(productImages)
    .innerJoin(
      storageObjects,
      eq(storageObjects.id, productImages.storageObjectId)
    )
    .where(inArray(productImages.productId, [...productIds]))
    .orderBy(asc(productImages.position), asc(productImages.id));
  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push({
      alt: row.alt,
      id: row.id,
      url: publicImageUrl(env, row.key) ?? null,
      variantId: row.variantId,
    });
    byProduct.set(row.productId, list);
  }
  return byProduct;
}

/** A catalog grid card. */
export function productCard(
  product: ProductSummary,
  images: readonly ImageView[]
) {
  return {
    available: product.available,
    id: product.id,
    image: images[0] ?? null,
    maxPrice: product.maxPrice,
    minPrice: product.minPrice,
    slug: product.slug,
    title: product.title,
  };
}

/** A product page: active variants with their store price and available stock. */
export function productPage(
  product: CatalogProduct,
  images: readonly ImageView[],
  currency: string
) {
  return {
    categoryId: product.categoryId,
    currency,
    descriptionHtml: product.descriptionHtml,
    id: product.id,
    images,
    options: product.options,
    slug: product.slug,
    title: product.title,
    variants: product.variants
      .filter((variant) => variant.active)
      .map((variant) => ({
        available: variant.stock.available,
        id: variant.id,
        optionValueIds: variant.optionValueIds,
        price:
          variant.prices.find((price) => price.currency === currency)?.amount ??
          null,
        sku: variant.sku,
        title: variant.title,
      })),
  };
}
