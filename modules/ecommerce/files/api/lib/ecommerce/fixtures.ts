import {
  createProduct,
  setProductOptions,
  setProductStatus,
  setVariantPrice,
  updateVariant,
} from "@repo/db/repositories/ecommerce/catalog";
import type { Executor } from "@repo/db/repositories/ecommerce/shared";
import { adjustStock } from "@repo/db/repositories/ecommerce/stock";
import type { CreateOrderInput } from "@repo/db/repositories/ecommerce/orders";
import { shippingZones } from "@repo/db/schema/ecommerce";
import { seedId } from "@repo/db/seed/id";

// Rows the ecommerce repository tests build on. Each helper goes through the repositories,
// so a fixture obeys the same rules a staff member does: a variant is priced before it is
// switched on, and a product has an active variant before it is published.

export const STORE_CURRENCY = "BDT";
export const BUYER = seedId("users", "member");

let counter = 0;

function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** An active product with one active variant, priced and stocked. */
export async function makeVariant(
  db: Executor,
  options: { onHand?: number; price?: number } = {}
): Promise<{ productId: string; variantId: string }> {
  const product = await createProduct(db, {
    slug: unique("product"),
    title: "Test product",
  });
  const full = await setProductOptions(db, product.id, []);
  const variantId = full.variants[0]?.id ?? "";
  await setVariantPrice(db, variantId, {
    amount: options.price ?? 50_000,
    currency: STORE_CURRENCY,
  });
  await updateVariant(
    db,
    variantId,
    { active: true },
    { storeCurrency: STORE_CURRENCY }
  );
  await setProductStatus(db, product.id, "active");
  if ((options.onHand ?? 0) > 0) {
    await adjustStock(db, variantId, { onHand: options.onHand ?? 0 });
  }
  return { productId: product.id, variantId };
}

/** An active flat-rate zone in the store currency. */
export async function makeZone(db: Executor, rate = 6000): Promise<string> {
  const id = unique("zone");
  await db.insert(shippingZones).values({
    currency: STORE_CURRENCY,
    id,
    name: "Inside Dhaka",
    rate,
  });
  return id;
}

/** A COD order input for the seeded member, with every field but the lines filled. */
export function orderInput(
  zoneId: string,
  lines: CreateOrderInput["lines"],
  overrides: Partial<CreateOrderInput> = {}
): CreateOrderInput {
  return {
    actor: { type: "system" },
    contactName: "Rahim",
    contactPhone: "+8801712345678",
    currency: STORE_CURRENCY,
    hold: "untimed",
    holdHours: 24,
    lines,
    paymentMethod: "cod",
    shippingAddress: { city: "Dhaka", line1: "House 12, Road 7" },
    userId: BUYER,
    zoneId,
    ...overrides,
  };
}
