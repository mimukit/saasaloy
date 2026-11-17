import {
  addCartItem,
  createGuestCart,
  getCart,
  getCartView,
  getOrCreateUserCart,
  mergeGuestCart,
  setCartItemQuantity,
} from "@repo/db/repositories/ecommerce/cart";
import { createOrder } from "@repo/db/repositories/ecommerce/orders";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import {
  BUYER,
  makeVariant,
  makeZone,
  orderInput,
  STORE_CURRENCY,
} from "./fixtures";

// Carts (plan 0106, grill Q5): a guest cart lapses, a line cannot exceed the available
// stock, and a guest cart merged at sign in adds its quantities, capped at available.

const database = testDatabase();
const guest = { currency: STORE_CURRENCY, lifetimeDays: 30 };

describe("a guest cart", () => {
  it("lapses after its lifetime", async () => {
    const { db } = database;
    const old = new Date(Date.now() - 31 * 86_400_000);
    const cart = await createGuestCart(db, { ...guest, now: old });

    await expect(getCart(db, cart.id, old)).resolves.not.toBeNull();
    await expect(getCart(db, cart.id)).resolves.toBeNull();
  });

  it("prices its lines from the catalog and totals them", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5, price: 45_050 });
    const cart = await createGuestCart(db, guest);

    await addCartItem(db, cart.id, variantId, 2);

    await expect(getCartView(db, cart.id)).resolves.toMatchObject({
      currency: "BDT",
      itemCount: 2,
      lines: [{ available: 5, forSale: true, quantity: 2, unitPrice: 45_050 }],
      subtotal: 90_100,
    });
  });

  it("refuses a quantity above the available stock", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 2 });
    const cart = await createGuestCart(db, guest);
    await addCartItem(db, cart.id, variantId, 2);

    await expect(addCartItem(db, cart.id, variantId, 1)).rejects.toMatchObject({
      code: "out_of_stock",
    });
  });

  it("removes a line set to zero", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 2 });
    const cart = await createGuestCart(db, guest);
    await addCartItem(db, cart.id, variantId, 1);

    await setCartItemQuantity(db, cart.id, variantId, 0);

    await expect(getCartView(db, cart.id)).resolves.toMatchObject({
      lines: [],
    });
  });
});

describe(mergeGuestCart, () => {
  it("adds the guest quantities to the user's cart", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 10 });
    const mine = await getOrCreateUserCart(db, BUYER, STORE_CURRENCY);
    await addCartItem(db, mine.id, variantId, 1);
    const cart = await createGuestCart(db, guest);
    await addCartItem(db, cart.id, variantId, 2);

    const merged = await mergeGuestCart(db, {
      currency: STORE_CURRENCY,
      guestCartId: cart.id,
      userId: BUYER,
    });

    expect(merged.id).toBe(mine.id);
    await expect(getCartView(db, mine.id)).resolves.toMatchObject({
      lines: [{ quantity: 3, variantId }],
    });
    await expect(getCart(db, cart.id)).resolves.toBeNull();
  });

  it("caps the sum at the available stock", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 4 });
    const zoneId = await makeZone(db);
    const mine = await getOrCreateUserCart(db, BUYER, STORE_CURRENCY);
    await addCartItem(db, mine.id, variantId, 2);
    const cart = await createGuestCart(db, guest);
    await addCartItem(db, cart.id, variantId, 2);
    // Another order holds one unit after both lines went in, so 3 are left.
    await createOrder(db, orderInput(zoneId, [{ quantity: 1, variantId }]));

    await mergeGuestCart(db, {
      currency: STORE_CURRENCY,
      guestCartId: cart.id,
      userId: BUYER,
    });

    await expect(getCartView(db, mine.id)).resolves.toMatchObject({
      lines: [{ quantity: 3, variantId }],
    });
  });
});
