import { ADMIN_APP_ROLES } from "@repo/auth/server";
import { auditEvents } from "@repo/db/schema/audit";
import { users } from "@repo/db/schema/auth";
import { stockMovements } from "@repo/db/schema/ecommerce";
import { testDatabase } from "@repo/db/testing";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { makeVariant, makeZone } from "../lib/ecommerce/fixtures";
import {
  ADDRESS,
  adminSession,
  answer,
  call,
  clientByEmail,
  shopPayments,
  VERIFIED_PHONE,
} from "./ecommerce-fixtures";

// The shop's staff routes (plan 0106, Phase 4): the gate, the "New order" page (Q33 to
// Q35), the catalog editor's writes, and the figures staff read.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();
shopPayments();

/** A staff request with a fresh admin session. */
async function staff(path: string, body?: unknown, method?: string) {
  return call(database, `/admin/shop${path}`, {
    admin: true,
    body,
    cookie: await adminSession(database),
    method,
  });
}

/** A staff request's status and body. */
async function staffAnswer(path: string, body?: unknown, method?: string) {
  return answer(await staff(path, body, method));
}

async function userOf(where: ReturnType<typeof eq>) {
  const [row] = await database.db.select().from(users).where(where);
  return row;
}

interface Created {
  customer: { existing: boolean; id: string };
  order: { id: string; userId: string };
}

/** A manual COD order of one unit for `phone`. */
async function manualOrder(
  phone: string,
  extra: Record<string, unknown> = {}
): Promise<Created> {
  const { variantId } = await makeVariant(database.db, {
    onHand: 4,
    price: 10_000,
  });
  const zoneId = await makeZone(database.db, 0);
  const { body, status } = await staffAnswer("/orders", {
    address: ADDRESS,
    lines: [{ quantity: 1, variantId }],
    name: "Karim Mia",
    paymentMethod: "cod",
    phone,
    zoneId,
    ...extra,
  });
  expect(status).toBe(201);
  return body as Created;
}

describe("the staff gate", () => {
  it("answers 401 with no admin session, also to a signed-in client", async () => {
    const client = await clientByEmail(database, "member@example.test");

    const anonymous = await call(database, "/admin/shop/orders", {
      admin: true,
    });
    const asClient = await call(database, "/admin/shop/orders", {
      admin: true,
      cookie: client,
    });

    expect([anonymous.status, asClient.status]).toStrictEqual([401, 401]);
  });

  it("answers 403 on reads and writes to an admin session whose account lost its role", async () => {
    const cookie = await adminSession(database);
    await database.db
      .update(users)
      .set({ role: "user" })
      .where(eq(users.email, "admin@example.test"));

    const read = await call(database, "/admin/shop/orders", {
      admin: true,
      cookie,
    });
    const write = await call(database, "/admin/shop/zones", {
      admin: true,
      body: { name: "Anywhere", rate: 100 },
      cookie,
    });

    expect([read.status, write.status]).toStrictEqual([403, 403]);
  });
});

describe("POST /admin/shop/orders (New order)", () => {
  it("creates a client user with an unverified phone for a new number, at catalog prices", async () => {
    const { variantId } = await makeVariant(database.db, {
      onHand: 4,
      price: 50_000,
    });
    const zoneId = await makeZone(database.db, 6000);
    const admin = await userOf(eq(users.email, "admin@example.test"));

    const res = await staffAnswer("/orders", {
      address: ADDRESS,
      lines: [{ price: 1, quantity: 2, unitPrice: 1, variantId }],
      name: "Karim Mia",
      paymentMethod: "cod",
      phone: "01912345678",
      total: 1,
      zoneId,
    });

    expect(res).toMatchObject({
      body: {
        customer: { existing: false },
        order: {
          events: [
            { actorType: "staff", actorUserId: admin?.id, toStatus: "placed" },
          ],
          items: [{ quantity: 2, unitPrice: 50_000 }],
          status: "placed",
          subtotal: 100_000,
          total: 106_000,
        },
      },
      status: 201,
    });
    const created = res.body as Created;
    await expect(
      userOf(eq(users.id, created.customer.id))
    ).resolves.toMatchObject({
      name: "Karim Mia",
      phoneNumber: "+8801912345678",
      phoneNumberVerified: false,
      role: "user",
    });
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "ecommerce.order.create"),
          eq(auditEvents.targetId, created.order.id)
        )
      );
    expect(audits).toHaveLength(1);
  });

  it("links the order to the user who owns a known phone", async () => {
    const owner = await userOf(eq(users.phoneNumber, VERIFIED_PHONE));

    const lookup = await staffAnswer(
      `/customers/lookup?phone=${encodeURIComponent(VERIFIED_PHONE)}`
    );
    const created = await manualOrder(VERIFIED_PHONE);

    expect(lookup).toMatchObject({ body: { customer: { id: owner?.id } } });
    expect(created).toMatchObject({
      customer: { existing: true },
      order: { userId: owner?.id },
    });
  });

  it("confirms the payment and the order at once when the payment is already received", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 4 });
    const zoneId = await makeZone(database.db);

    const res = await staffAnswer("/orders", {
      address: ADDRESS,
      lines: [{ quantity: 1, variantId }],
      name: "Karim Mia",
      paymentMethod: "bkash",
      paymentReceived: { transactionId: "8N7A6D5E4F" },
      phone: "01912345679",
      zoneId,
    });

    expect(res).toMatchObject({
      body: {
        order: {
          payments: [{ method: "bkash", status: "successful" }],
          status: "confirmed",
        },
      },
      status: 201,
    });
  });

  it("writes the payment confirm audit row when the payment is already received", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 4 });
    const zoneId = await makeZone(database.db);
    const admin = await userOf(eq(users.email, "admin@example.test"));

    const res = await staffAnswer("/orders", {
      address: ADDRESS,
      lines: [{ quantity: 1, variantId }],
      name: "Karim Mia",
      paymentMethod: "bkash",
      paymentReceived: { transactionId: "8N7A6D5E4G" },
      phone: "01912345674",
      zoneId,
    });

    const { order } = res.body as {
      order: { id: string; payments: { id: string }[] };
    };
    const [paymentId] = order.payments.map((payment) => payment.id);
    const rows = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "payment.review.confirm"),
          eq(auditEvents.targetId, paymentId ?? "")
        )
      );
    expect(rows).toMatchObject([
      {
        actorUserId: admin?.id,
        targetLabel: `order · ${order.id}`,
        targetType: "payment",
      },
    ]);
  });

  it("answers 409 for a line above the available stock and writes no order or user", async () => {
    const { variantId } = await makeVariant(database.db, { onHand: 1 });
    const zoneId = await makeZone(database.db);

    const res = await staffAnswer("/orders", {
      address: ADDRESS,
      lines: [{ quantity: 2, variantId }],
      name: "Karim Mia",
      paymentMethod: "cod",
      phone: "01912345670",
      zoneId,
    });

    expect(res).toMatchObject({
      body: { error: { code: "out_of_stock" } },
      status: 409,
    });
    await expect(
      userOf(eq(users.phoneNumber, "+8801912345670"))
    ).resolves.toBeUndefined();
  });
});

describe("a shop role outside admin and superadmin", () => {
  const EXTRA = "support";

  afterEach(() => {
    const roles = ADMIN_APP_ROLES as string[];
    const at = roles.indexOf(EXTRA);
    if (at !== -1) {
      roles.splice(at, 1);
    }
  });

  /** A staff session whose role is an extra `ADMIN_APP_ROLES` role, such as `support`. */
  async function supportSession(): Promise<string> {
    (ADMIN_APP_ROLES as string[]).push(EXTRA);
    const cookie = await adminSession(database);
    await database.db
      .update(users)
      .set({ role: EXTRA })
      .where(eq(users.email, "admin@example.test"));
    return cookie;
  }

  async function asSupport(
    cookie: string,
    phone: string,
    extra: Record<string, unknown>
  ) {
    const { variantId } = await makeVariant(database.db, { onHand: 4 });
    const zoneId = await makeZone(database.db);
    return call(database, "/admin/shop/orders", {
      admin: true,
      body: {
        address: ADDRESS,
        lines: [{ quantity: 1, variantId }],
        name: "Karim Mia",
        phone,
        zoneId,
        ...extra,
      },
      cookie,
    });
  }

  it("takes a manual order, but not one with the payment already received", async () => {
    const cookie = await supportSession();

    const plain = await asSupport(cookie, "01912345675", {
      paymentMethod: "cod",
    });
    const received = await asSupport(cookie, "01912345676", {
      paymentMethod: "bkash",
      paymentReceived: { transactionId: "8N7A6D5E4H" },
    });

    expect([plain.status, received.status]).toStrictEqual([201, 403]);
    await expect(
      userOf(eq(users.phoneNumber, "+8801912345676"))
    ).resolves.toBeUndefined();
  });
});

describe("the catalog editor", () => {
  async function newProduct(): Promise<string> {
    const { body, status } = await staffAnswer("/products", {
      description: {
        content: [
          {
            content: [{ text: "Soft cotton.", type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      slug: "tee-shirt",
      title: "Tee shirt",
    });
    expect({ body, status }).toMatchObject({
      body: { descriptionHtml: expect.stringContaining("Soft cotton.") },
      status: 201,
    });
    return (body as { id: string }).id;
  }

  it("generates one variant per combination of option values", async () => {
    const productId = await newProduct();

    const grid = await staffAnswer(
      `/products/${productId}/options`,
      {
        options: [
          { name: "Size", values: ["S", "M"] },
          { name: "Colour", values: ["Red", "Blue"] },
        ],
      },
      "PUT"
    );

    const titles = (
      grid.body as { variants: { title: string }[] }
    ).variants.map((variant) => variant.title);
    expect(titles).toStrictEqual([
      "S / Red",
      "S / Blue",
      "M / Red",
      "M / Blue",
    ]);
  });

  it("prices and stocks a variant, writes the stock movement, and publishes the product", async () => {
    const productId = await newProduct();
    const grid = await staffAnswer(
      `/products/${productId}/options`,
      { options: [{ name: "Size", values: ["S", "M"] }] },
      "PUT"
    );
    const [first] = (grid.body as { variants: { id: string }[] }).variants;
    const variantId = first?.id ?? "";
    const refused = await staff(`/products/${productId}/status`, {
      status: "active",
    });

    const priced = await staff(
      `/variants/${variantId}`,
      { active: true, price: 45_000, sku: "TEST-TEE-SHIRT-S" },
      "PUT"
    );
    const stocked = await staff(`/variants/${variantId}/stock`, {
      note: "First delivery",
      onHand: 12,
    });
    const published = await staff(`/products/${productId}/status`, {
      status: "active",
    });

    expect([
      refused.status,
      priced.status,
      stocked.status,
      published.status,
    ]).toStrictEqual([409, 200, 200, 200]);
    const movements = await database.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.variantId, variantId));
    expect(movements).toMatchObject([
      { delta: 12, note: "First delivery", reason: "adjustment" },
    ]);
    const page = await answer(await call(database, "/shop/products/tee-shirt"));
    expect(page).toMatchObject({
      body: { variants: [{ available: 12, price: 45_000 }] },
      status: 200,
    });
  });
});

describe("zones", () => {
  it("adds, edits and deletes a zone in the store currency", async () => {
    const created = await staffAnswer("/zones", {
      name: "Outside Dhaka",
      rate: 12_000,
    });
    const { id } = created.body as { id: string };

    const edited = await staffAnswer(`/zones/${id}`, { rate: 13_000 }, "PATCH");
    const deleted = await staffAnswer(`/zones/${id}`, undefined, "DELETE");

    expect(created).toMatchObject({ body: { currency: "BDT" }, status: 201 });
    expect(edited).toMatchObject({ body: { rate: 13_000 }, status: 200 });
    expect(deleted.status).toBe(200);
  });
});

describe("customers, reports and the nav count", () => {
  it("counts a placed COD order as awaiting a call", async () => {
    const before = await staffAnswer("/orders/awaiting-call-count");

    await manualOrder("01912345671");

    const after = await staffAnswer("/orders/awaiting-call-count");
    const count = (body: unknown) => (body as { count: number }).count;
    expect(count(after.body)).toBe(count(before.body) + 1);
  });

  it("lists the buyer with their figures and the order under the COD filter", async () => {
    const created = await manualOrder("01912345672");

    const customers = await staffAnswer("/customers?q=Karim");
    const listed = await staffAnswer("/orders?status=placed&cod=true");

    const rows = (customers.body as { customers: { id: string }[] }).customers;
    expect(rows.find((row) => row.id === created.customer.id)).toMatchObject({
      orderCount: 1,
      totalSpent: 10_000,
    });
    const ids = (listed.body as { orders: { id: string }[] }).orders.map(
      (order) => order.id
    );
    expect(ids).toContain(created.order.id);
  });

  it("reports today's sales, statuses and COD figures", async () => {
    await manualOrder("01912345673");

    const report = await staffAnswer("/reports?range=today");

    expect(report).toMatchObject({
      body: {
        cod: { collectionRate: expect.any(Number) },
        ordersByStatus: { placed: expect.any(Number) },
        salesByDay: [{ orders: expect.any(Number) }],
      },
      status: 200,
    });
    const [today] = (report.body as { salesByDay: { orders: number }[] })
      .salesByDay;
    expect(today?.orders).toBeGreaterThanOrEqual(1);
  });

  it("refuses a custom report range that ends before it starts", async () => {
    const report = await staffAnswer(
      "/reports?range=custom&from=2026-11-10&to=2026-11-01"
    );

    expect(report.status).toBe(400);
  });
});
