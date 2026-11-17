import { getDb } from "@repo/db/client";
import type { Db } from "@repo/db/client";
import {
  deleteProduct,
  onHandFor,
} from "@repo/db/repositories/ecommerce/catalog";
import {
  createOrder,
  transitionOrder,
} from "@repo/db/repositories/ecommerce/orders";
import {
  adjustStock,
  availableFor,
  setOrderHold,
  stockLevels,
} from "@repo/db/repositories/ecommerce/stock";
import {
  orders,
  shippingZones,
  stockMovements,
  stockReservations,
} from "@repo/db/schema/ecommerce";
import { testDatabase } from "@repo/db/testing";
import { eq, inArray } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, inject, it } from "vitest";
import { makeVariant, makeZone, orderInput } from "./fixtures";

// The stock rules (plan 0106, "Stock"): available is on hand minus live holds, an expired
// hold stops counting, on hand changes only at `shipped`, and two checkouts for the last
// unit cannot both win.
//
// Most tests run in a rolled-back transaction. The race needs two connections that commit,
// so it opens its own clients on the test database and deletes what it wrote.

const database = testDatabase();
const staff = { type: "system" } as const;

/** Marks a rejection as handled until the test awaits it. */
function ignore(): void {
  // The test asserts on the same promise below.
}

describe("available stock", () => {
  it("is on hand minus the live holds", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);

    await createOrder(db, orderInput(zoneId, [{ quantity: 2, variantId }]));

    const levels = await stockLevels(db, [variantId]);
    expect(levels.get(variantId)).toMatchObject({
      available: 3,
      onHand: 5,
      reserved: 2,
    });
  });

  it("ignores an expired hold", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const placedAt = new Date(Date.now() - 48 * 3_600_000);

    await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 4, variantId }], {
        hold: "timed",
        holdHours: 24,
        now: placedAt,
      })
    );

    await expect(availableFor(db, variantId, placedAt)).resolves.toBe(1);
    await expect(availableFor(db, variantId)).resolves.toBe(5);
  });

  it("refuses an order above the available stock and writes nothing", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 1 });
    const zoneId = await makeZone(db);

    await expect(
      createOrder(db, orderInput(zoneId, [{ quantity: 2, variantId }]))
    ).rejects.toMatchObject({ code: "out_of_stock" });

    const written = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.variantId, variantId));
    expect(written).toStrictEqual([]);
  });

  it("renews a lapsed hold only while stock allows it", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 1 });
    const zoneId = await makeZone(db);
    const old = new Date(Date.now() - 48 * 3_600_000);
    const first = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }], {
        hold: "timed",
        now: old,
      })
    );
    await createOrder(db, orderInput(zoneId, [{ quantity: 1, variantId }]));

    await expect(
      setOrderHold(db, { holdHours: 24, kind: "untimed", orderId: first.id })
    ).rejects.toMatchObject({ code: "out_of_stock" });
  });
});

describe("on hand", () => {
  /** A placed COD order for 2 of a variant with 5 on hand. */
  async function placedOrder() {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 2, variantId }])
    );
    return { db, orderId: order.id, variantId };
  }

  it("changes only when the order ships", async () => {
    const { db, orderId, variantId } = await placedOrder();
    await expect(onHandFor(db, variantId)).resolves.toBe(5);

    await transitionOrder(db, { actor: staff, orderId, to: "confirmed" });
    await expect(onHandFor(db, variantId)).resolves.toBe(5);

    await transitionOrder(db, { actor: staff, orderId, to: "shipped" });
    await expect(onHandFor(db, variantId)).resolves.toBe(3);
    await expect(availableFor(db, variantId)).resolves.toBe(3);
  });

  it("turns the hold into a shipped movement, and delivery leaves on hand", async () => {
    const { db, orderId, variantId } = await placedOrder();
    await transitionOrder(db, { actor: staff, orderId, to: "confirmed" });
    await transitionOrder(db, { actor: staff, orderId, to: "shipped" });

    const holds = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    const moves = await db
      .select({ delta: stockMovements.delta, reason: stockMovements.reason })
      .from(stockMovements)
      .where(eq(stockMovements.orderId, orderId));
    await transitionOrder(db, { actor: staff, orderId, to: "delivered" });

    expect(holds).toStrictEqual([]);
    expect(moves).toStrictEqual([{ delta: -2, reason: "shipped" }]);
    await expect(onHandFor(db, variantId)).resolves.toBe(3);
  });

  it("stays put on cancel, and the hold is released", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const order = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 2, variantId }])
    );

    await transitionOrder(db, {
      actor: staff,
      orderId: order.id,
      to: "cancelled",
    });

    await expect(onHandFor(db, variantId)).resolves.toBe(5);
    await expect(availableFor(db, variantId)).resolves.toBe(5);
  });

  it("comes back on a return only when restock is asked", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 5 });
    const zoneId = await makeZone(db);
    const kept = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 1, variantId }])
    );
    const back = await createOrder(
      db,
      orderInput(zoneId, [{ quantity: 2, variantId }])
    );
    for (const id of [kept.id, back.id]) {
      await transitionOrder(db, { actor: staff, orderId: id, to: "confirmed" });
      await transitionOrder(db, { actor: staff, orderId: id, to: "shipped" });
    }
    await expect(onHandFor(db, variantId)).resolves.toBe(2);

    await transitionOrder(db, {
      actor: staff,
      orderId: kept.id,
      restock: false,
      to: "returned",
    });
    await transitionOrder(db, {
      actor: staff,
      orderId: back.id,
      restock: true,
      to: "returned",
    });

    await expect(onHandFor(db, variantId)).resolves.toBe(4);
  });

  it("takes a staff adjustment and refuses one below zero", async () => {
    const { db } = database;
    const { variantId } = await makeVariant(db, { onHand: 2 });

    await expect(adjustStock(db, variantId, { delta: 3 })).resolves.toBe(5);
    await expect(
      adjustStock(db, variantId, { delta: -6 })
    ).rejects.toMatchObject({ code: "out_of_stock" });
    await expect(onHandFor(db, variantId)).resolves.toBe(5);
  });
});

describe("two checkouts for the last unit", () => {
  function client(): Db {
    return getDb({ DATABASE_URL: inject("testDatabaseUrl") });
  }

  async function withCommittedVariant(
    body: (ids: { variantId: string; zoneId: string }) => Promise<void>
  ): Promise<void> {
    const setup = client();
    const { productId, variantId } = await makeVariant(setup, { onHand: 1 });
    const zoneId = await makeZone(setup);
    try {
      await body({ variantId, zoneId });
    } finally {
      const placed = await setup
        .select({ id: stockReservations.orderId })
        .from(stockReservations)
        .where(eq(stockReservations.variantId, variantId));
      const ids = placed.map((row) => row.id);
      if (ids.length > 0) {
        await setup.delete(orders).where(inArray(orders.id, ids));
      }
      await deleteProduct(setup, productId);
      await setup.delete(shippingZones).where(eq(shippingZones.id, zoneId));
      await setup.$client.end({ timeout: 5 });
    }
  }

  it("lets the second wait on the row lock, then refuses it", async () => {
    await withCommittedVariant(async ({ variantId, zoneId }) => {
      const a = client();
      const b = client();
      const input = orderInput(zoneId, [{ quantity: 1, variantId }]);
      let second: Promise<void> = Promise.resolve();
      let settledWhileLocked = true;

      // A places its order and keeps its transaction, and so its row lock, open while B
      // tries the same unit. B must still be waiting when A commits.
      await a.transaction(async (tx) => {
        await createOrder(tx, input);
        let settled = false;
        second = b
          .transaction(async (other) => {
            await createOrder(other, input);
          })
          .finally(() => {
            settled = true;
          });
        second.catch(ignore);
        await sleep(300);
        settledWhileLocked = settled;
      });

      expect(settledWhileLocked).toBeFalsy();
      await expect(second).rejects.toMatchObject({ code: "out_of_stock" });
      await a.$client.end({ timeout: 5 });
      await b.$client.end({ timeout: 5 });
    });
  });

  it("lets exactly one of two racing checkouts win", async () => {
    await withCommittedVariant(async ({ variantId, zoneId }) => {
      const a = client();
      const b = client();
      const input = orderInput(zoneId, [{ quantity: 1, variantId }]);

      const results = await Promise.allSettled([
        createOrder(a, input),
        createOrder(b, input),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected");
      expect(lost?.reason).toMatchObject({ code: "out_of_stock" });
      await expect(availableFor(a, variantId)).resolves.toBe(0);
      await a.$client.end({ timeout: 5 });
      await b.$client.end({ timeout: 5 });
    });
  });
});
