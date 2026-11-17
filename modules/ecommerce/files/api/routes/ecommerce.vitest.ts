import { createProduct } from "@repo/db/repositories/ecommerce/catalog";
import { adjustStock } from "@repo/db/repositories/ecommerce/stock";
import { createOrder, getOrder } from "@repo/db/repositories/ecommerce/orders";
import { users } from "@repo/db/schema/auth";
import { orders } from "@repo/db/schema/ecommerce";
import { payments } from "@repo/db/schema/payment";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  BUYER,
  makeVariant,
  makeZone,
  orderInput,
} from "../lib/ecommerce/fixtures";
import {
  ADDRESS,
  answer,
  call,
  clientByEmail,
  clientByPhone,
  shopPayments,
} from "./ecommerce-fixtures";

// The shop's public routes (plan 0106, Phase 4): the checkout gates, the stock check, the
// price the browser cannot set, the cart merge at sign-in, and an expired unpaid order
// read back cancelled.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();
shopPayments();

const MEMBER = "member@example.test";

/** Add to the cart and expect it to take the line. */
async function addToCart(cookie: string, body: Record<string, unknown>) {
  const res = await call(database, "/shop/cart/items", { body, cookie });
  expect(res.status).toBe(200);
}

function checkout(cookie: string | undefined, body: Record<string, unknown>) {
  return call(database, "/shop/checkout", { body, cookie });
}

async function countOf(table: typeof orders | typeof payments) {
  const rows = await database.db.select({ id: table.id }).from(table);
  return rows.length;
}

async function memberOrders(): Promise<number> {
  const rows = await database.db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.userId, BUYER));
  return rows.length;
}

describe("POST /shop/checkout", () => {
  it("answers 401 with no session and writes no order", async () => {
    const zoneId = await makeZone(database.db);
    const before = await countOf(orders);

    const res = await checkout(undefined, {
      address: ADDRESS,
      paymentMethod: "cod",
      zoneId,
    });

    expect(res.status).toBe(401);
    await expect(countOf(orders)).resolves.toBe(before);
  });

  it("answers 403 to a session with neither a verified phone nor a verified email", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 5 });
    const zoneId = await makeZone(database.db);
    const cookie = await clientByEmail(database, MEMBER);
    await addToCart(cookie, { quantity: 1, variantId });
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.email, MEMBER));

    const res = await checkout(cookie, {
      address: ADDRESS,
      paymentMethod: "cod",
      zoneId,
    });

    await expect(answer(res)).resolves.toMatchObject({
      body: { error: { code: "phone_unverified" } },
      status: 403,
    });
    await expect(memberOrders()).resolves.toBe(0);
  });

  it("places a COD order for a verified email and ignores every price the browser sends", async () => {
    const { variantId } = await makeVariant(database.db, {
      onHand: 5,
      price: 65_000,
    });
    const zoneId = await makeZone(database.db, 6000);
    const cookie = await clientByEmail(database, MEMBER);
    await addToCart(cookie, { price: 1, quantity: 2, unitPrice: 1, variantId });

    const res = await checkout(cookie, {
      address: ADDRESS,
      amount: 1,
      paymentMethod: "cod",
      shipping: 0,
      subtotal: 1,
      total: 1,
      zoneId,
    });

    await expect(answer(res)).resolves.toMatchObject({
      body: {
        next: { kind: "instructions" },
        order: {
          shipping: 6000,
          status: "placed",
          subtotal: 130_000,
          total: 136_000,
        },
        payment: { amount: 136_000, method: "cod", status: "pending" },
      },
      status: 201,
    });
    const cart = await call(database, "/shop/cart", { cookie });
    await expect(answer(cart)).resolves.toMatchObject({ body: { lines: [] } });
  });

  it("answers 409 for a quantity above the available stock and writes no order", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 2 });
    const zoneId = await makeZone(database.db);
    const cookie = await clientByEmail(database, MEMBER);
    await addToCart(cookie, { quantity: 2, variantId });
    // Stock drops after the cart was filled: the cart holds none, checkout re-checks.
    await adjustStock(database.db, variantId, { onHand: 1 });
    const paymentsBefore = await countOf(payments);

    const res = await checkout(cookie, {
      address: ADDRESS,
      paymentMethod: "cod",
      zoneId,
    });

    await expect(answer(res)).resolves.toMatchObject({
      body: { error: { code: "out_of_stock" } },
      status: 409,
    });
    await expect(memberOrders()).resolves.toBe(0);
    await expect(countOf(payments)).resolves.toBe(paymentsBefore);
  });

  it("checks a verified phone out with the phone as the order's contact", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 3 });
    const zoneId = await makeZone(database.db);
    const cookie = await clientByPhone(database);
    await addToCart(cookie, { quantity: 1, variantId });

    const res = await checkout(cookie, {
      address: { ...ADDRESS, phone: "+8801812345678" },
      paymentMethod: "cod",
      zoneId,
    });

    await expect(answer(res)).resolves.toMatchObject({
      body: { order: { contactPhone: "+12025550101" } },
      status: 201,
    });
  });
});

describe("the cart", () => {
  it("answers 409 when an add goes past the available stock", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 1 });
    const cookie = await clientByEmail(database, MEMBER);

    const res = await call(database, "/shop/cart/items", {
      body: { quantity: 2, variantId },
      cookie,
    });

    await expect(answer(res)).resolves.toMatchObject({
      body: { error: { code: "out_of_stock" } },
      status: 409,
    });
  });

  it("merges a guest cart at sign-in, quantities added and capped at available stock", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 3 });
    const member = await clientByEmail(database, MEMBER);
    await addToCart(member, { quantity: 2, variantId });
    const guest = await call(database, "/shop/cart/items", {
      body: { quantity: 2, variantId },
    });
    const cartCookie =
      guest.headers
        .getSetCookie()
        .find((line) => line.startsWith("shop_cart="))
        ?.split(";")[0] ?? "";

    const merged = await call(database, "/shop/cart", {
      cookie: `${member}; ${cartCookie}`,
    });

    await expect(answer(merged)).resolves.toMatchObject({
      body: { lines: [{ quantity: 3, variantId }] },
      status: 200,
    });
    expect(
      merged.headers
        .getSetCookie()
        .some((line) => line.startsWith("shop_cart=;"))
    ).toBeTruthy();
  });
});

describe("GET /shop/orders/:number", () => {
  it("returns an unpaid order past its hold as cancelled, with a system event", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 3 });
    const zoneId = await makeZone(database.db);
    const order = await createOrder(
      database.db,
      orderInput(zoneId, [{ quantity: 1, variantId }], {
        hold: "timed",
        holdHours: 1,
        now: new Date(Date.now() - 2 * 3_600_000),
        paymentMethod: "bkash",
      })
    );
    const cookie = await clientByEmail(database, MEMBER);

    const res = await call(database, `/shop/orders/${order.number}`, {
      cookie,
    });

    await expect(answer(res)).resolves.toMatchObject({
      body: { status: "cancelled" },
      status: 200,
    });
    const stored = await getOrder(database.db, order.id);
    expect(stored?.events.at(-1)).toMatchObject({
      actorType: "system",
      fromStatus: "placed",
      toStatus: "cancelled",
    });
  });

  it("answers 404 for another buyer's order", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 3 });
    const zoneId = await makeZone(database.db);
    const order = await createOrder(
      database.db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );
    const cookie = await clientByPhone(database);

    const res = await call(database, `/shop/orders/${order.number}`, {
      cookie,
    });

    expect(res.status).toBe(404);
  });
});

describe("the public catalog", () => {
  it("lists active products only, with their store prices", async () => {
    const { productId } = await makeVariant(database.db, {
      onHand: 2,
      price: 42_000,
    });
    const draft = await createProduct(database.db, {
      slug: "draft-product",
      title: "Not yet",
    });

    const res = await call(database, "/shop/products");

    const { body, status } = await answer(res);
    expect(status).toBe(200);
    const listed = (body as { products: { id: string }[] }).products;
    expect(listed.find((product) => product.id === productId)).toMatchObject({
      minPrice: 42_000,
    });
    expect(listed.map((product) => product.id)).not.toContain(draft.id);
  });
});
