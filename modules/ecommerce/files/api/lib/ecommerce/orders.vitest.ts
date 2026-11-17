import { setVariantPrice } from "@repo/db/repositories/ecommerce/catalog";
import {
  cancelExpiredOrders,
  createOrder,
  getOrder,
  transitionOrder,
} from "@repo/db/repositories/ecommerce/orders";
import { availableFor } from "@repo/db/repositories/ecommerce/stock";
import { ORDER_STATUSES } from "@repo/ecommerce";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import { makeVariant, makeZone, orderInput } from "./fixtures";

// Orders (plan 0106, "Orders" and grill Q2): an order copies its catalog lines and totals,
// takes its number from the sequence, records every move as an event, and refuses any
// move outside the status machine.

const database = testDatabase();
const system = { type: "system" } as const;

describe(createOrder, () => {
  it("copies the catalog lines and totals the order with the zone rate", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5, price: 65_000 });
    const zoneId = await makeZone(db, 6000);

    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 2, variantId }])
    );

    expect(order).toMatchObject({
      currency: "BDT",
      shipping: 6000,
      status: "placed",
      subtotal: 130_000,
      total: 136_000,
      zoneName: "Inside Dhaka",
    });
    expect(order.number).toBeGreaterThanOrEqual(1001);
    expect(order.items).toMatchObject([
      {
        lineTotal: 130_000,
        productTitle: "Test product",
        quantity: 2,
        unitPrice: 65_000,
        variantId,
      },
    ]);
    expect(order.events).toMatchObject([
      { actorType: "system", fromStatus: null, toStatus: "placed" },
    ]);
  });

  it("keeps the copied price when the catalog price changes later", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5, price: 65_000 });
    const zoneId = await makeZone(db);
    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );

    await setVariantPrice(db, variantId, { amount: 1, currency: "BDT" });

    await expect(getOrder(db, order.id)).resolves.toMatchObject({
      items: [{ unitPrice: 65_000 }],
    });
  });

  it("gives each order a new number", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);

    const first = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );
    const second = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );

    expect(second.number).toBeGreaterThan(first.number);
  });

  it("names the staff member on a manual order's first event", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);

    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }], {
        actor: { type: "staff", userId: orderInput(zoneId, []).userId },
      })
    );

    expect(order.events[0]).toMatchObject({ actorType: "staff" });
  });
});

describe(transitionOrder, () => {
  it("records each move as an event", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );

    await transitionOrder(db, {
      actor: system,
      orderId: order.id,
      to: "confirmed",
    });
    const shipped = await transitionOrder(db, {
      actor: system,
      note: "Courier 42",
      orderId: order.id,
      to: "shipped",
    });

    expect(shipped.status).toBe("shipped");
    expect(
      shipped.events.map((event) => [event.fromStatus, event.toStatus])
    ).toStrictEqual([
      [null, "placed"],
      ["placed", "confirmed"],
      ["confirmed", "shipped"],
    ]);
  });

  it("refuses every move the status machine refuses, and writes no event", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );

    for (const to of ORDER_STATUSES.filter(
      (status) => !["confirmed", "cancelled"].includes(status)
    )) {
      await expect(
        transitionOrder(db, { actor: system, orderId: order.id, to })
      ).rejects.toMatchObject({ code: "invalid_transition" });
    }
    const read = await getOrder(db, order.id);
    expect(read?.events).toHaveLength(1);
  });
});

describe(cancelExpiredOrders, () => {
  it("cancels a placed order whose timed hold lapsed, with a system event", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 2, variantId }], {
        hold: "timed",
        now: new Date(Date.now() - 25 * 3_600_000),
        paymentMethod: "bkash",
      })
    );

    await expect(
      cancelExpiredOrders(db, { orderIds: [order.id] })
    ).resolves.toStrictEqual([order.id]);

    const read = await getOrder(db, order.id);
    expect(read?.status).toBe("cancelled");
    expect(read?.events.at(-1)).toMatchObject({
      actorType: "system",
      fromStatus: "placed",
      toStatus: "cancelled",
    });
    await expect(availableFor(db, variantId)).resolves.toBe(5);
  });

  it("leaves a COD order and a live timed hold alone", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const cod = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );
    const fresh = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }], { hold: "timed" })
    );

    await expect(
      cancelExpiredOrders(db, { orderIds: [cod.id, fresh.id] })
    ).resolves.toStrictEqual([]);
  });
});

describe("a product not for sale", () => {
  it("cannot be ordered", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);

    await expect(
      createOrder(
        db,
        orderInput(zoneId, [{ quantity: 1, variantId }], { currency: "USD" })
      )
    ).rejects.toMatchObject({ code: "not_for_sale" });
  });
});
