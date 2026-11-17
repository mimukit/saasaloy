import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { cartTotals, EcommerceError, mergedQuantity } from "@repo/ecommerce";
import type { CartTotals } from "@repo/ecommerce";
import {
  cartItems,
  carts,
  products,
  productVariants,
  variantPrices,
} from "../../schema/ecommerce";
import { newId } from "./shared";
import type { Executor } from "./shared";
import { stockLevels } from "./stock";

// Carts. A guest cart lives on a cookie that names its id, and lapses after
// `config.ecommerce.guestCartDays`; a signed-in buyer has one cart with no expiry. At sign
// in, `mergeGuestCart` folds the guest cart into the user's: quantities add, capped at the
// available stock (grill Q5).
//
// A cart holds no stock. Only checkout reserves, so a line may later exceed what is
// available; the cart view reports it and checkout refuses it.

export type CartRow = typeof carts.$inferSelect;

/** One cart line as the cart page shows it. */
export interface CartLine {
  variantId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  variantTitle: string;
  sku: string | null;
  quantity: number;
  /** The catalog price in the cart's currency. Null when the variant has none. */
  unitPrice: number | null;
  available: number;
  /** False when the product or variant is no longer active or has no price. */
  forSale: boolean;
}

export interface CartView extends CartTotals {
  id: string;
  userId: string | null;
  lines: CartLine[];
}

/** A cart by id, or null when it does not exist or a guest cart has lapsed. */
export async function getCart(
  db: Executor,
  cartId: string,
  now = new Date()
): Promise<CartRow | null> {
  const [row] = await db
    .select()
    .from(carts)
    .where(
      and(
        eq(carts.id, cartId),
        or(isNull(carts.expiresAt), gt(carts.expiresAt, now))
      )
    );
  return row ?? null;
}

/** Start a guest cart that lapses after `lifetimeDays`. */
export async function createGuestCart(
  db: Executor,
  input: { currency: string; lifetimeDays: number; now?: Date }
): Promise<CartRow> {
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(carts)
    .values({
      currency: input.currency,
      expiresAt: new Date(now.getTime() + input.lifetimeDays * 86_400_000),
      id: newId(),
      userId: null,
    })
    .returning();
  return row as CartRow;
}

/** The user's cart, created on first use. */
export async function getOrCreateUserCart(
  db: Executor,
  userId: string,
  currency: string
): Promise<CartRow> {
  await db
    .insert(carts)
    .values({ currency, id: newId(), userId })
    // `carts_user_id_uidx` is partial, so the conflict target repeats its predicate.
    .onConflictDoNothing({
      target: carts.userId,
      where: sql`${carts.userId} is not null`,
    });
  const [row] = await db.select().from(carts).where(eq(carts.userId, userId));
  if (!row) {
    throw new EcommerceError("not_found", `No cart for user ${userId}.`);
  }
  return row;
}

/** The cart's lines with prices, stock and totals. Lines no longer for sale count for nothing. */
export async function getCartView(
  db: Executor,
  cartId: string,
  now = new Date()
): Promise<CartView> {
  const cart = await getCart(db, cartId, now);
  if (!cart) {
    throw new EcommerceError("not_found", `No cart ${cartId}.`);
  }
  const rows = await db
    .select({
      productActive: products.status,
      productId: products.id,
      productSlug: products.slug,
      productTitle: products.title,
      quantity: cartItems.quantity,
      sku: productVariants.sku,
      unitPrice: variantPrices.amount,
      variantActive: productVariants.active,
      variantId: cartItems.variantId,
      variantTitle: productVariants.title,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      variantPrices,
      and(
        eq(variantPrices.variantId, cartItems.variantId),
        eq(variantPrices.currency, cart.currency)
      )
    )
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.createdAt), asc(cartItems.id));
  const levels = await stockLevels(
    db,
    rows.map((row) => row.variantId),
    now
  );
  const lines: CartLine[] = rows.map((row) => ({
    available: levels.get(row.variantId)?.available ?? 0,
    forSale:
      row.productActive === "active" &&
      row.variantActive &&
      row.unitPrice !== null,
    productId: row.productId,
    productSlug: row.productSlug,
    productTitle: row.productTitle,
    quantity: row.quantity,
    sku: row.sku,
    unitPrice: row.unitPrice,
    variantId: row.variantId,
    variantTitle: row.variantTitle,
  }));
  const totals = cartTotals(
    lines
      .filter((line) => line.forSale)
      .map((line) => ({
        currency: cart.currency,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? 0,
      })),
    cart.currency
  );
  return { ...totals, id: cart.id, lines, userId: cart.userId };
}

/** Throw `not_for_sale` unless the variant and its product are active and priced. */
async function assertForSale(
  db: Executor,
  variantId: string,
  currency: string
): Promise<void> {
  const [row] = await db
    .select({
      active: productVariants.active,
      price: variantPrices.amount,
      status: products.status,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      variantPrices,
      and(
        eq(variantPrices.variantId, productVariants.id),
        eq(variantPrices.currency, currency)
      )
    )
    .where(eq(productVariants.id, variantId));
  if (!row) {
    throw new EcommerceError("not_found", `No variant ${variantId}.`);
  }
  if (!row.active || row.status !== "active" || row.price === null) {
    throw new EcommerceError(
      "not_for_sale",
      `Variant ${variantId} is not for sale.`
    );
  }
}

async function currentQuantity(
  db: Executor,
  cartId: string,
  variantId: string
): Promise<number> {
  const [row] = await db
    .select({ quantity: cartItems.quantity })
    .from(cartItems)
    .where(
      and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId))
    );
  return row?.quantity ?? 0;
}

/**
 * Set a line's quantity. Zero removes it. A quantity above the available stock throws
 * `out_of_stock` and changes nothing.
 */
export async function setCartItemQuantity(
  db: Executor,
  cartId: string,
  variantId: string,
  quantity: number,
  now = new Date()
): Promise<void> {
  const cart = await getCart(db, cartId, now);
  if (!cart) {
    throw new EcommerceError("not_found", `No cart ${cartId}.`);
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new EcommerceError("invalid_quantity", `${quantity} is not whole.`);
  }
  if (quantity === 0) {
    await db
      .delete(cartItems)
      .where(
        and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId))
      );
    return;
  }
  await assertForSale(db, variantId, cart.currency);
  const levels = await stockLevels(db, [variantId], now);
  const available = levels.get(variantId)?.available;
  if (quantity > (available ?? 0)) {
    throw new EcommerceError(
      "out_of_stock",
      `${quantity} asked, ${available ?? 0} available.`
    );
  }
  await db
    .insert(cartItems)
    .values({ cartId, id: newId(), quantity, variantId })
    .onConflictDoUpdate({
      set: { quantity },
      target: [cartItems.cartId, cartItems.variantId],
    });
}

/** Add `quantity` to a line, creating it when new. */
export async function addCartItem(
  db: Executor,
  cartId: string,
  variantId: string,
  quantity: number,
  now = new Date()
): Promise<void> {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new EcommerceError(
      "invalid_quantity",
      `${quantity} is not 1 or more.`
    );
  }
  const current = await currentQuantity(db, cartId, variantId);
  await setCartItemQuantity(db, cartId, variantId, current + quantity, now);
}

/** Empty a cart, as checkout does once the order exists. */
export async function clearCart(db: Executor, cartId: string): Promise<void> {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

/**
 * Fold a guest cart into the user's cart at sign in (grill Q5). Each guest line adds to
 * the user's line for the same variant, and the sum is capped at the available stock; a
 * line capped to zero, or no longer for sale, is dropped. The guest cart is deleted.
 * Returns the user's cart.
 */
export async function mergeGuestCart(
  db: Executor,
  input: { guestCartId: string; userId: string; currency: string; now?: Date }
): Promise<CartRow> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const target = await getOrCreateUserCart(tx, input.userId, input.currency);
    const guest = await getCart(tx, input.guestCartId, now);
    if (!guest || guest.userId !== null || guest.id === target.id) {
      return target;
    }
    const guestLines = await tx
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, guest.id));
    const levels = await stockLevels(
      tx,
      guestLines.map((line) => line.variantId),
      now
    );
    for (const line of guestLines) {
      const mine = await currentQuantity(tx, target.id, line.variantId);
      const quantity = mergedQuantity(
        mine,
        line.quantity,
        levels.get(line.variantId)?.available ?? 0
      );
      if (quantity > 0) {
        await tx
          .insert(cartItems)
          .values({
            cartId: target.id,
            id: newId(),
            quantity,
            variantId: line.variantId,
          })
          .onConflictDoUpdate({
            set: { quantity },
            target: [cartItems.cartId, cartItems.variantId],
          });
      }
    }
    await tx.delete(carts).where(eq(carts.id, guest.id));
    return target;
  });
}
