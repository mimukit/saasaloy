import {
  customerStats,
  listCustomers,
} from "@repo/db/repositories/ecommerce/customers";
import {
  createOrder,
  transitionOrder,
} from "@repo/db/repositories/ecommerce/orders";
import {
  codReport,
  ordersByStatus,
  salesByDay,
  topProducts,
} from "@repo/db/repositories/ecommerce/reports";
import {
  createZone,
  deleteZone,
  listZones,
  updateZone,
} from "@repo/db/repositories/ecommerce/zones";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import { BUYER, makeVariant, makeZone, orderInput } from "./fixtures";

// The staff figures (plan 0106, "Customers" and "Reports"): computed from `orders` at
// read time. A sale is an order neither cancelled nor returned; the COD rates count the
// COD orders that reached `delivered` or `returned`.

const database = testDatabase();
const staff = { type: "system" } as const;

function today() {
  const from = new Date(Date.now() - 3_600_000);
  return { from, to: new Date(Date.now() + 3_600_000) };
}

/** A COD order of one unit at `price`, moved through `path`. */
async function codOrder(
  price: number,
  path: ("confirmed" | "shipped" | "delivered" | "returned" | "cancelled")[]
) {
  const { variantId } = await makeVariant(database.db, { onHand: 5, price });
  const zoneId = await makeZone(database.db, 0);
  const order = await createOrder(
    database.db,
    orderInput(zoneId, [{ quantity: 1, variantId }])
  );
  for (const to of path) {
    await transitionOrder(database.db, { actor: staff, orderId: order.id, to });
  }
  return order;
}

describe("customers", () => {
  it("counts orders, spending without cancelled or returned ones, and COD refusals", async () => {
    await codOrder(10_000, ["confirmed", "shipped", "delivered"]);
    await codOrder(20_000, ["confirmed", "shipped", "returned"]);
    await codOrder(40_000, ["cancelled"]);

    const stats = await customerStats(database.db, BUYER);

    expect(stats).toMatchObject({
      codRefusals: 1,
      orderCount: 3,
      totalSpent: 10_000,
    });
    const page = await listCustomers(database.db, {
      pageSize: 10,
      query: "member@",
    });
    expect(page.customers).toMatchObject([{ id: BUYER, orderCount: 3 }]);
  });

  it("leaves a user with no order off the list", async () => {
    const page = await listCustomers(database.db, { pageSize: 50 });
    expect(page.customers.some((row) => row.id === BUYER)).toBeFalsy();
  });
});

describe("reports", () => {
  it("reads sales, top products, statuses and the COD rates for a range", async () => {
    await codOrder(10_000, ["confirmed", "shipped", "delivered"]);
    await codOrder(20_000, ["confirmed", "shipped", "returned"]);
    await codOrder(30_000, []);

    const range = today();
    const [sales, top, statuses, cod] = await Promise.all([
      salesByDay(database.db, { ...range, timeZone: "UTC" }),
      topProducts(database.db, range),
      ordersByStatus(database.db, range),
      codReport(database.db, range),
    ]);

    expect(sales.reduce((sum, day) => sum + day.total, 0)).toBe(40_000);
    expect(
      top.map((row) => row.revenue).toSorted((a, b) => b - a)
    ).toStrictEqual([30_000, 10_000]);
    expect(statuses).toMatchObject({ delivered: 1, placed: 1, returned: 1 });
    expect(cod).toMatchObject({
      collected: { amount: 0, count: 0 },
      delivered: { amount: 10_000, count: 1 },
      refusalRate: 0.5,
      returned: { amount: 20_000, count: 1 },
    });
  });
});

describe("zones", () => {
  it("adds, edits and deletes a zone, and lists only active ones for checkout", async () => {
    const zone = await createZone(database.db, {
      active: false,
      currency: "BDT",
      name: "Hill tracts",
      position: 9,
      rate: 15_000,
    });
    const active = await listZones(database.db, { activeOnly: true });
    expect(active.some((row) => row.id === zone.id)).toBeFalsy();

    await updateZone(database.db, zone.id, { active: true });
    const after = await listZones(database.db, { activeOnly: true });
    expect(after.some((row) => row.id === zone.id)).toBeTruthy();

    await deleteZone(database.db, zone.id);
    await expect(deleteZone(database.db, zone.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
