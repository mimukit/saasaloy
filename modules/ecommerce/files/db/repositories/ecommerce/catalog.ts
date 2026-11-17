import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  assertProductActivatable,
  assertVariantActivatable,
  EcommerceError,
} from "@repo/ecommerce";
import type { ProductStatus } from "@repo/ecommerce";
import {
  inventoryLevels,
  productCategories,
  productImages,
  productOptions,
  productOptionValues,
  products,
  productVariants,
  stockReservations,
  variantPrices,
} from "../../schema/ecommerce";
import { newId } from "./shared";
import type { Executor } from "./shared";
import { stockLevels } from "./stock";
import type { StockLevel } from "./stock";

// The catalog: products, their options and generated variants, prices and images.
//
// Two rules hold here, whoever calls (grill Q4). A variant becomes active only with a price
// in the store currency, and a product becomes active only with one or more active
// variants. An active product keeps at least one active variant: the last one cannot be
// switched off, and its store price cannot be removed while it is active.
//
// The repository never renders. A product's description arrives with its HTML already
// rendered by the api, as the CMS does at publish.

export type ProductRow = typeof products.$inferSelect;
export type VariantRow = typeof productVariants.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;
export type CategoryRow = typeof productCategories.$inferSelect;

/** One variant with its prices and stock, as the editor grid and the product page read it. */
export interface CatalogVariant extends VariantRow {
  prices: { currency: string; amount: number }[];
  stock: StockLevel;
}

/** One option with its values, in position order. */
export interface CatalogOption {
  id: string;
  name: string;
  values: { id: string; value: string }[];
}

/** A product with everything the editor and the product page show. */
export interface CatalogProduct extends ProductRow {
  options: CatalogOption[];
  variants: CatalogVariant[];
  images: ProductImageRow[];
}

/** One row of a product list. */
export interface ProductSummary extends ProductRow {
  variantCount: number;
  /** The lowest and highest active variant price in the asked currency, or null. */
  minPrice: number | null;
  maxPrice: number | null;
  /** The sum of available stock over the active variants. */
  available: number;
}

export interface ProductPage {
  products: ProductSummary[];
  page: number;
  pageCount: number;
  total: number;
}

function isUniqueViolation(error: unknown): boolean {
  const text = String((error as { cause?: unknown }).cause ?? error);
  return text.includes("duplicate key") || text.includes("unique constraint");
}

async function mustFindProduct(
  db: Executor,
  productId: string
): Promise<ProductRow> {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId));
  if (!row) {
    throw new EcommerceError("not_found", `No product ${productId}.`);
  }
  return row;
}

async function mustFindVariant(
  db: Executor,
  variantId: string
): Promise<VariantRow> {
  const [row] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  if (!row) {
    throw new EcommerceError("not_found", `No variant ${variantId}.`);
  }
  return row;
}

// Categories ----------------------------------------------------------------------------

export async function listCategories(db: Executor): Promise<CategoryRow[]> {
  return db
    .select()
    .from(productCategories)
    .orderBy(asc(productCategories.position), asc(productCategories.name));
}

export async function createCategory(
  db: Executor,
  input: { name: string; slug: string; position?: number }
): Promise<CategoryRow> {
  try {
    const [row] = await db
      .insert(productCategories)
      .values({ ...input, id: newId() })
      .returning();
    return row as CategoryRow;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new EcommerceError("conflict", `Slug ${input.slug} is taken.`);
    }
    throw error;
  }
}

// Products ------------------------------------------------------------------------------

/** Create a draft product with one default variant, inactive and unpriced. */
export async function createProduct(
  db: Executor,
  input: {
    title: string;
    slug: string;
    description?: unknown;
    descriptionHtml?: string | null;
    categoryId?: string | null;
  }
): Promise<ProductRow> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          categoryId: input.categoryId ?? null,
          description: input.description ?? null,
          descriptionHtml: input.descriptionHtml ?? null,
          id: newId(),
          slug: input.slug,
          status: "draft",
          title: input.title,
        })
        .returning();
      const product = row as ProductRow;
      await tx
        .insert(productVariants)
        .values({ id: newId(), productId: product.id, title: "" });
      return product;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new EcommerceError("conflict", `Slug ${input.slug} is taken.`);
    }
    throw error;
  }
}

/** Edit a product's title, slug, description or category. */
export async function updateProduct(
  db: Executor,
  productId: string,
  patch: Partial<{
    title: string;
    slug: string;
    description: unknown;
    descriptionHtml: string | null;
    categoryId: string | null;
  }>
): Promise<ProductRow> {
  try {
    const [row] = await db
      .update(products)
      .set(patch)
      .where(eq(products.id, productId))
      .returning();
    if (!row) {
      throw new EcommerceError("not_found", `No product ${productId}.`);
    }
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new EcommerceError("conflict", `Slug ${patch.slug} is taken.`);
    }
    throw error;
  }
}

/** Publish or unpublish. Active needs one or more active variants. */
export async function setProductStatus(
  db: Executor,
  productId: string,
  status: ProductStatus
): Promise<ProductRow> {
  return db.transaction(async (tx) => {
    await mustFindProduct(tx, productId);
    if (status === "active") {
      const variants = await tx
        .select({ active: productVariants.active })
        .from(productVariants)
        .where(eq(productVariants.productId, productId));
      assertProductActivatable(variants);
    }
    const [row] = await tx
      .update(products)
      .set({ status })
      .where(eq(products.id, productId))
      .returning();
    return row as ProductRow;
  });
}

/** Delete a product. Its variants, prices, stock and images go with it; order lines keep their copies. */
export async function deleteProduct(
  db: Executor,
  productId: string
): Promise<void> {
  const holds = await db
    .select({ id: stockReservations.id })
    .from(stockReservations)
    .innerJoin(
      productVariants,
      eq(productVariants.id, stockReservations.variantId)
    )
    .where(eq(productVariants.productId, productId))
    .limit(1);
  if (holds.length > 0) {
    throw new EcommerceError(
      "conflict",
      "An open order holds this product's stock. Ship or cancel it first."
    );
  }
  await db.delete(products).where(eq(products.id, productId));
}

// Options and variants ------------------------------------------------------------------

/** Every combination of the options' values, one value per option, in option order. */
export function combinations<T>(lists: readonly (readonly T[])[]): T[][] {
  let result: T[][] = [[]];
  for (const list of lists) {
    result = result.flatMap((prefix) => list.map((item) => [...prefix, item]));
  }
  return result;
}

function comboKey(ids: readonly string[]): string {
  return ids.toSorted().join("|");
}

/**
 * Replace a product's options, then regenerate the variant grid: one variant per
 * combination of values. An option or value whose name stays keeps its id, so the
 * variants built on it keep their SKU, prices and stock. A new combination gets a new,
 * inactive, unpriced variant. A combination that is gone loses its variant, unless an open
 * order holds its stock: then the variant is switched off and kept.
 *
 * No options at all leaves one default variant with an empty title.
 */
export async function setProductOptions(
  db: Executor,
  productId: string,
  options: readonly { name: string; values: readonly string[] }[]
): Promise<CatalogProduct> {
  await db.transaction(async (tx) => {
    const product = await mustFindProduct(tx, productId);
    const existing = await tx
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, productId));
    const byName = new Map(existing.map((option) => [option.name, option]));

    const kept: { id: string; values: { id: string; value: string }[] }[] = [];
    for (const [position, option] of options.entries()) {
      const optionId = byName.get(option.name)?.id ?? newId();
      await tx
        .insert(productOptions)
        .values({ id: optionId, name: option.name, position, productId })
        .onConflictDoUpdate({ set: { position }, target: productOptions.id });
      const currentValues = await tx
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionId, optionId));
      const byValue = new Map(currentValues.map((row) => [row.value, row]));
      const values: { id: string; value: string }[] = [];
      for (const [valuePosition, value] of option.values.entries()) {
        const valueId = byValue.get(value)?.id ?? newId();
        await tx
          .insert(productOptionValues)
          .values({ id: valueId, optionId, position: valuePosition, value })
          .onConflictDoUpdate({
            set: { position: valuePosition },
            target: productOptionValues.id,
          });
        values.push({ id: valueId, value });
      }
      const keepIds = values.map((value) => value.id);
      await tx
        .delete(productOptionValues)
        .where(
          and(
            eq(productOptionValues.optionId, optionId),
            notInArray(productOptionValues.id, keepIds)
          )
        );
      kept.push({ id: optionId, values });
    }
    const keepOptionIds = kept.map((option) => option.id);
    await tx
      .delete(productOptions)
      .where(
        keepOptionIds.length > 0
          ? and(
              eq(productOptions.productId, productId),
              notInArray(productOptions.id, keepOptionIds)
            )
          : eq(productOptions.productId, productId)
      );

    const wanted = combinations(kept.map((option) => option.values));
    const variants = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    const byCombo = new Map(
      variants.map((variant) => [comboKey(variant.optionValueIds), variant])
    );
    const keepVariantIds: string[] = [];
    for (const [position, combo] of wanted.entries()) {
      const ids = combo.map((value) => value.id);
      const title = combo.map((value) => value.value).join(" / ");
      const found = byCombo.get(comboKey(ids));
      if (found) {
        await tx
          .update(productVariants)
          .set({ optionValueIds: ids, position, title })
          .where(eq(productVariants.id, found.id));
        keepVariantIds.push(found.id);
      } else {
        const id = newId();
        await tx.insert(productVariants).values({
          id,
          optionValueIds: ids,
          position,
          productId,
          title,
        });
        keepVariantIds.push(id);
      }
    }

    const gone = variants.filter(
      (variant) => !keepVariantIds.includes(variant.id)
    );
    if (gone.length > 0) {
      const holds = await tx
        .select({ variantId: stockReservations.variantId })
        .from(stockReservations)
        .where(
          inArray(
            stockReservations.variantId,
            gone.map((variant) => variant.id)
          )
        );
      const held = new Set(holds.map((row) => row.variantId));
      const drop = gone.filter((variant) => !held.has(variant.id));
      const switchOff = gone.filter((variant) => held.has(variant.id));
      if (drop.length > 0) {
        await tx.delete(productVariants).where(
          inArray(
            productVariants.id,
            drop.map((variant) => variant.id)
          )
        );
      }
      if (switchOff.length > 0) {
        await tx
          .update(productVariants)
          .set({ active: false })
          .where(
            inArray(
              productVariants.id,
              switchOff.map((variant) => variant.id)
            )
          );
      }
    }

    if (product.status === "active") {
      const left = await tx
        .select({ active: productVariants.active })
        .from(productVariants)
        .where(eq(productVariants.productId, productId));
      if (!left.some((variant) => variant.active)) {
        await tx
          .update(products)
          .set({ status: "draft" })
          .where(eq(products.id, productId));
      }
    }
  });
  return mustGetProduct(db, productId);
}

/**
 * Edit a variant's SKU or active flag. Activating needs a price in `storeCurrency`;
 * switching off the last active variant of an active product is refused.
 */
export async function updateVariant(
  db: Executor,
  variantId: string,
  patch: { sku?: string | null; active?: boolean },
  options: { storeCurrency: string }
): Promise<VariantRow> {
  return db.transaction(async (tx) => {
    const variant = await mustFindVariant(tx, variantId);
    if (patch.active === true && !variant.active) {
      const prices = await tx
        .select({
          amount: variantPrices.amount,
          currency: variantPrices.currency,
        })
        .from(variantPrices)
        .where(eq(variantPrices.variantId, variantId));
      assertVariantActivatable(prices, options.storeCurrency);
    }
    if (patch.active === false && variant.active) {
      await assertKeepsAnActiveVariant(tx, variant);
    }
    try {
      const [row] = await tx
        .update(productVariants)
        .set(patch)
        .where(eq(productVariants.id, variantId))
        .returning();
      return row as VariantRow;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EcommerceError("conflict", `SKU ${patch.sku} is taken.`);
      }
      throw error;
    }
  });
}

async function assertKeepsAnActiveVariant(
  db: Executor,
  variant: VariantRow
): Promise<void> {
  const product = await mustFindProduct(db, variant.productId);
  if (product.status !== "active") {
    return;
  }
  const [others] = await db
    .select({ n: count() })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, variant.productId),
        eq(productVariants.active, true),
        sql`${productVariants.id} <> ${variant.id}`
      )
    );
  if ((others?.n ?? 0) === 0) {
    throw new EcommerceError(
      "no_active_variant",
      "An active product keeps at least one active variant. Unpublish it first."
    );
  }
}

/** Set a variant's price in one currency, in minor units. */
export async function setVariantPrice(
  db: Executor,
  variantId: string,
  price: { currency: string; amount: number }
): Promise<void> {
  if (!Number.isSafeInteger(price.amount) || price.amount < 0) {
    throw new EcommerceError("invalid_amount", `${price.amount} is not whole.`);
  }
  await mustFindVariant(db, variantId);
  await db
    .insert(variantPrices)
    .values({ ...price, variantId })
    .onConflictDoUpdate({
      set: { amount: price.amount },
      target: [variantPrices.variantId, variantPrices.currency],
    });
}

/**
 * Remove a variant's price in one currency. An active variant keeps its store-currency
 * price: switch the variant off first.
 */
export async function removeVariantPrice(
  db: Executor,
  variantId: string,
  currency: string,
  options: { storeCurrency: string }
): Promise<void> {
  const variant = await mustFindVariant(db, variantId);
  if (variant.active && currency === options.storeCurrency) {
    throw new EcommerceError(
      "no_store_price",
      "An active variant keeps its store-currency price. Switch it off first."
    );
  }
  await db
    .delete(variantPrices)
    .where(
      and(
        eq(variantPrices.variantId, variantId),
        eq(variantPrices.currency, currency)
      )
    );
}

// Images --------------------------------------------------------------------------------

export async function addProductImage(
  db: Executor,
  input: {
    productId: string;
    storageObjectId: string;
    variantId?: string | null;
    alt?: string;
    position?: number;
  }
): Promise<ProductImageRow> {
  const [row] = await db
    .insert(productImages)
    .values({ ...input, id: newId() })
    .returning();
  return row as ProductImageRow;
}

export async function removeProductImage(
  db: Executor,
  imageId: string
): Promise<void> {
  await db.delete(productImages).where(eq(productImages.id, imageId));
}

// Reads ---------------------------------------------------------------------------------

/** A product with its options, variants (prices and stock) and images, or null. */
export async function getProduct(
  db: Executor,
  productId: string,
  now = new Date()
): Promise<CatalogProduct | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId));
  return product ? assemble(db, product, now) : null;
}

async function mustGetProduct(
  db: Executor,
  productId: string
): Promise<CatalogProduct> {
  const product = await getProduct(db, productId);
  if (!product) {
    throw new EcommerceError("not_found", `No product ${productId}.`);
  }
  return product;
}

/**
 * An active product by slug, with its active variants only, for the storefront. Null
 * when no active product has the slug.
 */
export async function getActiveProductBySlug(
  db: Executor,
  slug: string,
  now = new Date()
): Promise<CatalogProduct | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.status, "active")));
  if (!product) {
    return null;
  }
  const full = await assemble(db, product, now);
  return { ...full, variants: full.variants.filter((v) => v.active) };
}

async function assemble(
  db: Executor,
  product: ProductRow,
  now: Date
): Promise<CatalogProduct> {
  const [options, variants, images] = await Promise.all([
    db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, product.id))
      .orderBy(asc(productOptions.position)),
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(asc(productVariants.position)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id))
      .orderBy(asc(productImages.position)),
  ]);
  const optionIds = options.map((option) => option.id);
  const variantIds = variants.map((variant) => variant.id);
  const [values, prices, levels] = await Promise.all([
    optionIds.length > 0
      ? db
          .select()
          .from(productOptionValues)
          .where(inArray(productOptionValues.optionId, optionIds))
          .orderBy(asc(productOptionValues.position))
      : [],
    variantIds.length > 0
      ? db
          .select()
          .from(variantPrices)
          .where(inArray(variantPrices.variantId, variantIds))
      : [],
    stockLevels(db, variantIds, now),
  ]);
  return {
    ...product,
    images,
    options: options.map((option) => ({
      id: option.id,
      name: option.name,
      values: values
        .filter((value) => value.optionId === option.id)
        .map((value) => ({ id: value.id, value: value.value })),
    })),
    variants: variants.map((variant) => ({
      ...variant,
      prices: prices
        .filter((price) => price.variantId === variant.id)
        .map((price) => ({ amount: price.amount, currency: price.currency })),
      stock: levels.get(variant.id) ?? {
        available: 0,
        onHand: 0,
        reserved: 0,
        variantId: variant.id,
      },
    })),
  };
}

/**
 * A page of products, newest first, with each one's price range in `currency` and its
 * available stock. `status: "active"` is the storefront's list.
 */
export async function listProducts(
  db: Executor,
  input: {
    currency: string;
    page?: number;
    pageSize: number;
    status?: ProductStatus | "all";
    categorySlug?: string;
    /** A part of the title or of a variant's SKU, matched in any case. */
    search?: string;
    now?: Date;
  }
): Promise<ProductPage> {
  const now = input.now ?? new Date();
  const page = Math.max(1, input.page ?? 1);
  const search = input.search?.trim() ?? "";
  // `%`, `_` and `\` in the typed text match themselves, not any character.
  const pattern = `%${search.replaceAll(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const filters = [
    search === ""
      ? undefined
      : sql`(${products.title} ilike ${pattern} or exists (select 1 from ${productVariants} where ${productVariants.productId} = ${products.id} and ${productVariants.sku} ilike ${pattern}))`,
    input.status && input.status !== "all"
      ? eq(products.status, input.status)
      : undefined,
    input.categorySlug
      ? sql`${products.categoryId} = (select ${productCategories.id} from ${productCategories} where ${productCategories.slug} = ${input.categorySlug})`
      : undefined,
  ].filter((filter) => filter !== undefined);
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [totalRow] = await db
    .select({ n: count() })
    .from(products)
    .where(where);
  const total = totalRow?.n ?? 0;
  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(desc(products.createdAt), asc(products.id))
    .limit(input.pageSize)
    .offset((page - 1) * input.pageSize);

  const ids = rows.map((row) => row.id);
  const variants =
    ids.length > 0
      ? await db
          .select({
            active: productVariants.active,
            amount: variantPrices.amount,
            id: productVariants.id,
            productId: productVariants.productId,
          })
          .from(productVariants)
          .leftJoin(
            variantPrices,
            and(
              eq(variantPrices.variantId, productVariants.id),
              eq(variantPrices.currency, input.currency)
            )
          )
          .where(inArray(productVariants.productId, ids))
      : [];
  const levels = await stockLevels(
    db,
    variants.map((variant) => variant.id),
    now
  );

  return {
    page,
    pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    products: rows.map((row) => {
      const own = variants.filter((variant) => variant.productId === row.id);
      const active = own.filter((variant) => variant.active);
      const amounts = active
        .map((variant) => variant.amount)
        .filter((amount): amount is number => amount !== null);
      return {
        ...row,
        available: active.reduce(
          (sum, variant) => sum + (levels.get(variant.id)?.available ?? 0),
          0
        ),
        maxPrice: amounts.length > 0 ? Math.max(...amounts) : null,
        minPrice: amounts.length > 0 ? Math.min(...amounts) : null,
        variantCount: own.length,
      };
    }),
    total,
  };
}

/** On hand per variant, for a caller that needs only the shelf count. */
export async function onHandFor(
  db: Executor,
  variantId: string
): Promise<number> {
  const [row] = await db
    .select({ onHand: inventoryLevels.onHand })
    .from(inventoryLevels)
    .where(eq(inventoryLevels.variantId, variantId));
  return row?.onHand ?? 0;
}
