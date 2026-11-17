import {
  createProduct,
  getActiveProductBySlug,
  getProduct,
  listProducts,
  removeVariantPrice,
  setProductOptions,
  setProductStatus,
  setVariantPrice,
  updateVariant,
} from "@repo/db/repositories/ecommerce/catalog";
import type { Executor } from "@repo/db/repositories/ecommerce/shared";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import { makeVariant, STORE_CURRENCY } from "./fixtures";

// The catalog rules (plan 0106, grill Q4): a variant with no store-currency price cannot
// be activated, a product needs an active variant to go active, and the options generate
// the variant grid. Each test runs in a rolled-back transaction on the test database.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules` does not
// collect it. The descriptor renames it.

const database = testDatabase();
const store = { storeCurrency: STORE_CURRENCY };

/** The default variant `createProduct` makes. */
async function firstVariantId(
  db: Executor,
  productId: string
): Promise<string> {
  const product = await getProduct(db, productId);
  return product?.variants[0]?.id ?? "";
}

describe("variant activation", () => {
  it("refuses a variant with no store-currency price", async () => {
    const { db } = database;
    const product = await createProduct(db, { slug: "tee", title: "Tee" });
    const variantId = await firstVariantId(db, product.id);

    await expect(
      updateVariant(db, variantId, { active: true }, store)
    ).rejects.toMatchObject({ code: "no_store_price" });
  });

  it("refuses a variant priced only in another currency", async () => {
    const { db } = database;
    const product = await createProduct(db, { slug: "tee", title: "Tee" });
    const variantId = await firstVariantId(db, product.id);
    await setVariantPrice(db, variantId, { amount: 1000, currency: "USD" });

    await expect(
      updateVariant(db, variantId, { active: true }, store)
    ).rejects.toMatchObject({ code: "no_store_price" });
  });

  it("activates a variant once it has a store-currency price", async () => {
    const { db } = database;
    const product = await createProduct(db, { slug: "tee", title: "Tee" });
    const variantId = await firstVariantId(db, product.id);
    await setVariantPrice(db, variantId, { amount: 65_000, currency: "BDT" });

    const variant = await updateVariant(db, variantId, { active: true }, store);

    expect(variant.active).toBeTruthy();
  });

  it("keeps the store price of an active variant", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db);

    await expect(
      removeVariantPrice(db, variantId, STORE_CURRENCY, store)
    ).rejects.toMatchObject({ code: "no_store_price" });
  });
});

describe("product activation", () => {
  it("refuses to publish a product with no active variant", async () => {
    const { db } = database;
    const product = await createProduct(db, { slug: "tee", title: "Tee" });

    await expect(
      setProductStatus(db, product.id, "active")
    ).rejects.toMatchObject({ code: "no_active_variant" });
  });

  it("publishes a product with an active variant", async () => {
    const { db } = database;
    const { productId } = await makeVariant(db);

    await expect(getProduct(db, productId)).resolves.toMatchObject({
      status: "active",
    });
  });

  it("refuses to switch off the last active variant of an active product", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db);

    await expect(
      updateVariant(db, variantId, { active: false }, store)
    ).rejects.toMatchObject({ code: "no_active_variant" });
  });
});

describe("the variant grid", () => {
  it("makes one inactive variant per combination of values", async () => {
    const { db } = database;
    const product = await createProduct(db, { slug: "tee", title: "Tee" });

    const full = await setProductOptions(db, product.id, [
      { name: "Size", values: ["S", "M"] },
      { name: "Colour", values: ["Red", "Blue"] },
    ]);

    expect(full.variants.map((variant) => variant.title)).toStrictEqual([
      "S / Red",
      "S / Blue",
      "M / Red",
      "M / Blue",
    ]);
    expect(full.variants.some((variant) => variant.active)).toBeFalsy();
  });

  it("keeps a variant's price when its combination survives an options edit", async () => {
    const { db } = database;
    const product = await createProduct(db, { slug: "tee", title: "Tee" });
    const first = await setProductOptions(db, product.id, [
      { name: "Size", values: ["S", "M"] },
    ]);
    const small = first.variants.find((variant) => variant.title === "S");
    await setVariantPrice(db, small?.id ?? "", {
      amount: 100,
      currency: "BDT",
    });

    const second = await setProductOptions(db, product.id, [
      { name: "Size", values: ["S", "L"] },
    ]);

    expect(second.variants.map((variant) => variant.title)).toStrictEqual([
      "S",
      "L",
    ]);
    const kept = second.variants.find((variant) => variant.title === "S");
    expect(kept?.id).toBe(small?.id);
    expect(kept?.prices).toStrictEqual([{ amount: 100, currency: "BDT" }]);
  });
});

describe("storefront reads", () => {
  it("lists an active product with its price range and stock", async () => {
    const { db } = database;
    const { productId } = await makeVariant(db, { onHand: 4, price: 45_050 });

    const page = await listProducts(db, {
      currency: STORE_CURRENCY,
      pageSize: 100,
      status: "active",
    });

    const row = page.products.find((product) => product.id === productId);
    expect(row).toMatchObject({
      available: 4,
      maxPrice: 45_050,
      minPrice: 45_050,
    });
  });

  it("hides a draft product from the slug read", async () => {
    const { db } = database;
    await createProduct(db, { slug: "draft-tee", title: "Tee" });

    await expect(getActiveProductBySlug(db, "draft-tee")).resolves.toBeNull();
  });
});
