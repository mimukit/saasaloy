import { onHandFor } from "@repo/db/repositories/ecommerce/catalog";
import {
  getOrder,
  orderReservations,
} from "@repo/db/repositories/ecommerce/orders";
import { orders } from "@repo/db/schema/ecommerce";
import { smsMessages } from "@repo/db/schema/sms-messages";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";
import { makeVariant, makeZone } from "../lib/ecommerce/fixtures";
import {
  ADDRESS,
  adminSession,
  answer,
  call,
  clientByPhone,
  ORIGIN,
  shopEnv,
  shopPayments,
} from "./ecommerce-fixtures";

// The payment listener (plan 0106, grill Q2, Q11, Q12), driven through the real routes:
// the shop's checkout and "Pay again", the console provider's checkout form, and the staff
// payment review. Each payment change moves the order or its hold the way the plan says.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();
shopPayments();

interface Placed {
  orderId: string;
  total: number;
  number: number;
  paymentId: string;
  variantId: string;
  cookie: string;
}

/** The order's status, its last event and whether each hold is timed. */
async function orderState(orderId: string) {
  const order = await getOrder(database.db, orderId);
  const holds = await orderReservations(database.db, orderId);
  return {
    holds: holds.map((hold) =>
      hold.expiresAt === null
        ? "untimed"
        : hold.expiresAt.getTime() > Date.now()
          ? "timed"
          : "lapsed"
    ),
    last: order?.events.at(-1),
    status: order?.status,
  };
}

/** A verified-phone buyer checks one unit out with `method`. */
async function placeWith(method: string, onHand = 3): Promise<Placed> {
  const { variantId } = await makeVariant(database.db, { onHand });
  const zoneId = await makeZone(database.db);
  const cookie = await clientByPhone(database);
  const added = await call(database, "/shop/cart/items", {
    body: { quantity: 1, variantId },
    cookie,
  });
  expect(added.status).toBe(200);
  const res = await call(database, "/shop/checkout", {
    body: { address: ADDRESS, paymentMethod: method, zoneId },
    cookie,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    order: { number: number; total: number };
    payment: { id: string };
  };
  const [row] = await database.db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.number, body.order.number));
  return {
    cookie,
    number: body.order.number,
    orderId: row?.id ?? "",
    paymentId: body.payment.id,
    total: body.order.total,
    variantId,
  };
}

/** The console provider's checkout form, as the buyer's browser posts it. */
function consoleComplete(paymentId: string, action: "pay" | "cancel") {
  const form = new FormData();
  form.set("paymentId", paymentId);
  form.set("action", action);
  return app.request(
    "/payment/callback/console/complete",
    { body: form, headers: ORIGIN, method: "POST" },
    shopEnv(database)
  );
}

async function review(
  paymentId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return call(database, `/admin/payment/payments/${paymentId}/review`, {
    admin: true,
    body,
    cookie: await adminSession(database),
  });
}

async function staffStatus(orderId: string, status: string) {
  const res = await call(database, `/admin/shop/orders/${orderId}/status`, {
    admin: true,
    body: { status },
    cookie: await adminSession(database),
  });
  expect(res.status).toBe(200);
}

describe("a successful online payment", () => {
  it("confirms the order, drops the hold's expiry and texts the buyer", async () => {
    const placed = await placeWith("card");
    await expect(orderState(placed.orderId)).resolves.toMatchObject({
      holds: ["timed"],
    });

    const res = await consoleComplete(placed.paymentId, "pay");

    expect(res.status).toBe(200);
    await expect(orderState(placed.orderId)).resolves.toMatchObject({
      holds: ["untimed"],
      last: { actorType: "system", toStatus: "confirmed" },
      status: "confirmed",
    });
    const texts = await database.db
      .select()
      .from(smsMessages)
      .where(eq(smsMessages.template, "order-confirmed"));
    expect(texts.map((text) => text.toPhone)).toContain("+12025550101");
  });
});

/** The buyer submits a bKash transaction id for the order's payment. */
async function submitBkash(placed: Placed): Promise<void> {
  const res = await call(
    database,
    `/shop/orders/${placed.number}/payments/${placed.paymentId}/submit`,
    {
      body: {
        amount: placed.total,
        senderAccount: "01812345678",
        transactionId: "8N7A6D5E4F",
      },
      cookie: placed.cookie,
    }
  );
  await expect(answer(res)).resolves.toMatchObject({ status: 200 });
}

describe("a submitted payment", () => {
  it("takes the expiry off the order's hold", async () => {
    const placed = await placeWith("bkash");

    await submitBkash(placed);

    await expect(orderState(placed.orderId)).resolves.toMatchObject({
      holds: ["untimed"],
      status: "placed",
    });
  });
});

describe("a failed online payment", () => {
  it("leaves the order placed with a timed hold, and Pay again starts a second payment", async () => {
    const placed = await placeWith("bkash");
    await submitBkash(placed);

    const rejected = await review(placed.paymentId, {
      action: "reject",
      reason: "not_found",
    });

    expect(rejected.status).toBe(200);
    await expect(orderState(placed.orderId)).resolves.toMatchObject({
      holds: ["timed"],
      status: "placed",
    });
    const page = await call(database, `/shop/orders/${placed.number}`, {
      cookie: placed.cookie,
    });
    await expect(answer(page)).resolves.toMatchObject({
      body: { canPayAgain: true },
    });
    const again = await call(database, `/shop/orders/${placed.number}/pay`, {
      body: {},
      cookie: placed.cookie,
    });
    await expect(answer(again)).resolves.toMatchObject({
      body: {
        order: { payments: [{ id: placed.paymentId, status: "failed" }, {}] },
        payment: { method: "bkash", status: "pending" },
      },
      status: 201,
    });
  });

  it("Pay again with another method starts a second payment and changes the order's method", async () => {
    const placed = await placeWith("card");
    await consoleComplete(placed.paymentId, "cancel");

    const again = await call(database, `/shop/orders/${placed.number}/pay`, {
      body: { paymentMethod: "cod" },
      cookie: placed.cookie,
    });

    const { body, status } = await answer(again);
    expect(status).toBe(201);
    expect(body).toMatchObject({
      order: { paymentMethod: "cod", payments: [{ id: placed.paymentId }, {}] },
      payment: { method: "cod" },
    });
    await expect(orderState(placed.orderId)).resolves.toMatchObject({
      holds: ["untimed"],
      status: "placed",
    });
  });

  it("refuses Pay again while the last payment is still open", async () => {
    const placed = await placeWith("bkash");

    const res = await call(database, `/shop/orders/${placed.number}/pay`, {
      body: {},
      cookie: placed.cookie,
    });

    expect(res.status).toBe(409);
  });
});

describe("staff status actions", () => {
  it("text the buyer when the order is confirmed and when it ships", async () => {
    const placed = await placeWith("cod");

    await staffStatus(placed.orderId, "confirmed");
    await staffStatus(placed.orderId, "shipped");

    const texts = await database.db
      .select({ template: smsMessages.template })
      .from(smsMessages)
      .where(eq(smsMessages.toPhone, "+12025550101"));
    expect(texts.map((text) => text.template)).toStrictEqual(
      expect.arrayContaining(["order-confirmed", "order-shipped"])
    );
  });
});

describe("a COD payment rejected at delivery", () => {
  it("moves the shipped order to returned", async () => {
    const placed = await placeWith("cod", 3);
    await staffStatus(placed.orderId, "confirmed");
    await staffStatus(placed.orderId, "shipped");

    const rejected = await review(placed.paymentId, {
      action: "reject",
      reason: "delivery_refused",
    });

    expect(rejected.status).toBe(200);
    await expect(orderState(placed.orderId)).resolves.toMatchObject({
      last: {
        actorType: "system",
        fromStatus: "shipped",
        toStatus: "returned",
      },
      status: "returned",
    });
  });

  it("puts the stock back once with the restock route", async () => {
    const placed = await placeWith("cod", 3);
    await staffStatus(placed.orderId, "confirmed");
    await staffStatus(placed.orderId, "shipped");
    await expect(onHandFor(database.db, placed.variantId)).resolves.toBe(2);
    await review(placed.paymentId, {
      action: "reject",
      reason: "delivery_failed",
    });

    const restock = () =>
      call(database, `/admin/shop/orders/${placed.orderId}/restock`, {
        admin: true,
        body: {},
        cookie: adminCookie,
      });
    const adminCookie = await adminSession(database);
    const first = await restock();
    const second = await restock();

    expect([first.status, second.status]).toStrictEqual([200, 409]);
    await expect(onHandFor(database.db, placed.variantId)).resolves.toBe(3);
  });

  it("leaves a delivered order alone when the COD cash is confirmed", async () => {
    const placed = await placeWith("cod");
    await staffStatus(placed.orderId, "confirmed");
    await staffStatus(placed.orderId, "shipped");
    await staffStatus(placed.orderId, "delivered");

    const confirmed = await review(placed.paymentId, { action: "confirm" });

    expect(confirmed.status).toBe(200);
    await expect(orderState(placed.orderId)).resolves.toMatchObject({
      status: "delivered",
    });
  });
});
