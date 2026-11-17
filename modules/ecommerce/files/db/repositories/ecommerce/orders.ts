import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assertTransition,
  EcommerceError,
  holdExpiry,
  lineTotal,
  orderTotals,
} from "@repo/ecommerce";
import type { HoldKind, OrderActor, OrderStatus } from "@repo/ecommerce";
import {
  orderEvents,
  orderItems,
  orders,
  products,
  productVariants,
  shippingZones,
  stockMovements,
  stockReservations,
  variantPrices,
} from "../../schema/ecommerce";
import { payments } from "../../schema/payment";
import { newId } from "./shared";
import type { Executor, Tx } from "./shared";
import {
  assertAvailable,
  convertReservations,
  insertReservations,
  lockVariants,
  releaseReservations,
  restockOrder,
} from "./stock";
import type { StockLine } from "./stock";

// Orders: create one from catalog prices in one transaction, move it through the status
// machine in `@repo/ecommerce`, and read it back.
//
// `createOrder` is the checkout transaction (plan 0106, "Stock"): it locks the variant
// rows `FOR UPDATE`, checks available stock, inserts the order, its lines and its
// reservations, and writes the first `order_events` row. Prices come from
// `variant_prices` and the rate from `shipping_zones`; the caller passes variant ids and
// quantities only, so a price a browser sent has nowhere to go. The api calls
// `payment.create` afterwards, with the amount from the returned row.
//
// `transitionOrder` checks every move against `ORDER_TRANSITIONS` and applies the stock
// side of it: `shipped` converts the reservations into `stock_movements` rows (the only
// time an order changes on hand), `cancelled` deletes them, and `returned` restocks the
// lines when the caller asks.

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderEventRow = typeof orderEvents.$inferSelect;

/** An order with its lines and its history, oldest event first. */
export interface OrderDetail extends OrderRow {
  items: OrderItemRow[];
  events: OrderEventRow[];
}

export interface OrderPage {
  orders: OrderRow[];
  page: number;
  pageCount: number;
  total: number;
}

/** What checkout and the staff "New order" page pass in. No price: the catalog sets it. */
export interface CreateOrderInput {
  userId: string;
  contactName: string;
  contactPhone: string;
  shippingAddress: Record<string, unknown>;
  zoneId: string;
  paymentMethod: string;
  lines: readonly StockLine[];
  /** The store currency. Every price and the zone rate must be in it. */
  currency: string;
  /** `timed` for an unpaid online payment, `untimed` for COD (grill Q11). */
  hold: HoldKind;
  /** `config.ecommerce.unpaidHoldHours`. */
  holdHours: number;
  /** The buyer is `system`; a staff manual order names the staff member (Q33). */
  actor: OrderActor;
  note?: string | null;
  now?: Date;
}

function actorColumns(actor: OrderActor) {
  return actor.type === "staff"
    ? { actorType: "staff", actorUserId: actor.userId }
    : { actorType: "system", actorUserId: null };
}

/** Read every line's variant, product and price, and refuse any line not for sale. */
async function priceLines(
  tx: Tx,
  lines: readonly StockLine[],
  currency: string
) {
  const ids = [...new Set(lines.map((line) => line.variantId))];
  const rows = await tx
    .select({
      productId: products.id,
      productStatus: products.status,
      productTitle: products.title,
      sku: productVariants.sku,
      unitPrice: variantPrices.amount,
      variantActive: productVariants.active,
      variantId: productVariants.id,
      variantTitle: productVariants.title,
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
    .where(inArray(productVariants.id, ids));
  const byId = new Map(rows.map((row) => [row.variantId, row]));
  return lines.map((line) => {
    const row = byId.get(line.variantId);
    if (!row) {
      throw new EcommerceError("not_found", `No variant ${line.variantId}.`);
    }
    if (
      row.productStatus !== "active" ||
      !row.variantActive ||
      row.unitPrice === null
    ) {
      throw new EcommerceError(
        "not_for_sale",
        `Variant ${line.variantId} is not for sale.`
      );
    }
    return { ...row, quantity: line.quantity, unitPrice: row.unitPrice };
  });
}

/**
 * Create an order in `placed`, holding its stock. Throws `out_of_stock` and writes nothing
 * when any line does not fit, `not_for_sale` for an inactive or unpriced variant, and
 * `not_found` for an unknown variant or zone.
 */
export async function createOrder(
  db: Executor,
  input: CreateOrderInput
): Promise<OrderDetail> {
  const now = input.now ?? new Date();
  if (input.lines.length === 0) {
    throw new EcommerceError(
      "empty_order",
      "An order needs at least one line."
    );
  }
  const orderId = await db.transaction(async (tx) => {
    await lockVariants(
      tx,
      input.lines.map((line) => line.variantId)
    );
    const priced = await priceLines(tx, input.lines, input.currency);
    await assertAvailable(tx, input.lines, now);

    const [zone] = await tx
      .select()
      .from(shippingZones)
      .where(
        and(eq(shippingZones.id, input.zoneId), eq(shippingZones.active, true))
      );
    if (!zone) {
      throw new EcommerceError("not_found", `No active zone ${input.zoneId}.`);
    }
    if (zone.currency !== input.currency) {
      throw new EcommerceError(
        "currency_mismatch",
        `Zone ${zone.name} charges ${zone.currency}, the store sells in ${input.currency}.`
      );
    }

    const totals = orderTotals({
      currency: input.currency,
      lines: priced.map((line) => ({ ...line, currency: input.currency })),
      shipping: zone.rate,
    });

    const id = newId();
    await tx.insert(orders).values({
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      currency: input.currency,
      id,
      note: input.note ?? null,
      paymentMethod: input.paymentMethod,
      shipping: totals.shipping,
      shippingAddress: input.shippingAddress,
      status: "placed",
      subtotal: totals.subtotal,
      total: totals.total,
      userId: input.userId,
      zoneId: zone.id,
      zoneName: zone.name,
    });
    await tx.insert(orderItems).values(
      priced.map((line) => ({
        id: newId(),
        lineTotal: lineTotal({ ...line, currency: input.currency }),
        orderId: id,
        productId: line.productId,
        productTitle: line.productTitle,
        quantity: line.quantity,
        sku: line.sku,
        unitPrice: line.unitPrice,
        variantId: line.variantId,
        variantTitle: line.variantTitle,
      }))
    );
    await insertReservations(tx, id, input.lines, {
      expiresAt: holdExpiry(input.hold, now, input.holdHours),
    });
    await tx.insert(orderEvents).values({
      ...actorColumns(input.actor),
      fromStatus: null,
      id: newId(),
      orderId: id,
      toStatus: "placed",
    });
    return id;
  });
  return mustGetOrder(db, orderId);
}

/** An order with its lines and events, or null. */
export async function getOrder(
  db: Executor,
  orderId: string
): Promise<OrderDetail | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) {
    return null;
  }
  const [items, events] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id)),
    db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
  ]);
  return { ...order, events, items };
}

async function mustGetOrder(
  db: Executor,
  orderId: string
): Promise<OrderDetail> {
  const order = await getOrder(db, orderId);
  if (!order) {
    throw new EcommerceError("not_found", `No order ${orderId}.`);
  }
  return order;
}

/** An order by its number, as the buyer and staff read it. */
export async function getOrderByNumber(
  db: Executor,
  number: number
): Promise<OrderDetail | null> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.number, number));
  return order ? getOrder(db, order.id) : null;
}

/** A page of orders, newest first, for one buyer or for staff. */
export async function listOrders(
  db: Executor,
  input: {
    userId?: string;
    status?: OrderStatus;
    paymentMethod?: string;
    page?: number;
    pageSize: number;
  }
): Promise<OrderPage> {
  const page = Math.max(1, input.page ?? 1);
  const filters = [
    input.userId ? eq(orders.userId, input.userId) : undefined,
    input.status ? eq(orders.status, input.status) : undefined,
    input.paymentMethod
      ? eq(orders.paymentMethod, input.paymentMethod)
      : undefined,
  ].filter((filter) => filter !== undefined);
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [totalRow] = await db.select({ n: count() }).from(orders).where(where);
  const total = totalRow?.n ?? 0;
  const rows = await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt), desc(orders.number))
    .limit(input.pageSize)
    .offset((page - 1) * input.pageSize);
  return {
    orders: rows,
    page,
    pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    total,
  };
}

/**
 * Move an order to `to`, checked against the status machine, and apply its stock side.
 * Locks the order row, so two staff clicks on one order run one after the other and the
 * second gets `invalid_transition`. `restock` applies to `returned` only (grill Q8).
 */
export async function transitionOrder(
  db: Executor,
  input: {
    orderId: string;
    to: OrderStatus;
    actor: OrderActor;
    note?: string | null;
    restock?: boolean;
  }
): Promise<OrderDetail> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update");
    if (!order) {
      throw new EcommerceError("not_found", `No order ${input.orderId}.`);
    }
    assertTransition(order.status, input.to);
    const stockActor = {
      actorUserId: input.actor.type === "staff" ? input.actor.userId : null,
    };
    if (input.to === "shipped") {
      await convertReservations(tx, input.orderId, stockActor);
    } else if (input.to === "cancelled") {
      await releaseReservations(tx, input.orderId);
    } else if (input.to === "returned" && input.restock === true) {
      await restockOrder(tx, input.orderId, stockActor);
    }
    await tx
      .update(orders)
      .set({ status: input.to })
      .where(eq(orders.id, input.orderId));
    await tx.insert(orderEvents).values({
      ...actorColumns(input.actor),
      fromStatus: order.status,
      id: newId(),
      note: input.note ?? null,
      orderId: input.orderId,
      toStatus: input.to,
    });
  });
  return mustGetOrder(db, input.orderId);
}

/**
 * Cancel every `placed` order whose holds have all lapsed, with a `system` event (grill
 * Q3). A COD order, or one whose payment was submitted, holds with no expiry and is never
 * touched. Called by whatever reads the orders first: the buyer's page, the admin list,
 * checkout. Pass `orderIds` or `userId` to limit it to what the caller is about to read.
 * Returns the ids it cancelled.
 */
export async function cancelExpiredOrders(
  db: Executor,
  input: { orderIds?: readonly string[]; userId?: string; now?: Date } = {}
): Promise<string[]> {
  const now = input.now ?? new Date();
  if (input.orderIds?.length === 0) {
    return [];
  }
  const lapsed = sql`exists (
    select 1 from ${stockReservations}
    where ${stockReservations.orderId} = ${orders.id}
  ) and not exists (
    select 1 from ${stockReservations}
    where ${stockReservations.orderId} = ${orders.id}
      and (${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > ${now.toISOString()}::timestamptz)
  )`;
  const candidates = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "placed"),
        input.orderIds ? inArray(orders.id, [...input.orderIds]) : undefined,
        input.userId ? eq(orders.userId, input.userId) : undefined,
        lapsed
      )
    );
  const cancelled: string[] = [];
  for (const { id } of candidates) {
    const done = await db.transaction(async (tx) => {
      // Recheck under the row lock: a payment may have made the hold untimed meanwhile.
      const [row] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.status, "placed"), lapsed))
        .for("update");
      if (!row) {
        return false;
      }
      await releaseReservations(tx, id);
      await tx
        .update(orders)
        .set({ status: "cancelled" })
        .where(eq(orders.id, id));
      await tx.insert(orderEvents).values({
        actorType: "system",
        actorUserId: null,
        fromStatus: "placed",
        id: newId(),
        note: "The unpaid hold expired.",
        orderId: id,
        toStatus: "cancelled",
      });
      return true;
    });
    if (done) {
      cancelled.push(id);
    }
  }
  return cancelled;
}

/** The orders a staff list shows as awaiting a call: `placed` COD orders. */
export async function countPlacedCod(db: Executor): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.status, "placed"), eq(orders.paymentMethod, "cod")));
  return row?.n ?? 0;
}

/** How many orders hold each status, for the staff list's filter chips. */
export async function countOrdersByStatus(
  db: Executor
): Promise<Record<string, number>> {
  const rows = await db
    .select({ n: count(), status: orders.status })
    .from(orders)
    .groupBy(orders.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

/** What a staff list row shows beside the order: its unit count and its last payment. */
export interface OrderListExtra {
  itemCount: number;
  paymentStatus: string | null;
}

/**
 * The unit count and the newest payment's status of each order, in two queries for the
 * whole page. An order with no payment yet reads `paymentStatus: null`.
 */
export async function orderListExtras(
  db: Executor,
  orderIds: readonly string[]
): Promise<Map<string, OrderListExtra>> {
  const extras = new Map<string, OrderListExtra>(
    orderIds.map((id) => [id, { itemCount: 0, paymentStatus: null }])
  );
  if (orderIds.length === 0) {
    return extras;
  }
  const [counts, rows] = await Promise.all([
    db
      .select({
        orderId: orderItems.orderId,
        units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, [...orderIds]))
      .groupBy(orderItems.orderId),
    db
      .select({
        orderId: payments.referenceId,
        status: payments.status,
      })
      .from(payments)
      .where(
        and(
          eq(payments.referenceType, "order"),
          inArray(payments.referenceId, [...orderIds])
        )
      )
      .orderBy(asc(payments.createdAt), asc(payments.id)),
  ]);
  for (const row of counts) {
    const extra = extras.get(row.orderId);
    if (extra) {
      extra.itemCount = Number(row.units);
    }
  }
  // Oldest first, so the last write per order is its newest payment.
  for (const row of rows) {
    const extra = extras.get(row.orderId);
    if (extra) {
      extra.paymentStatus = row.status;
    }
  }
  return extras;
}

/** The stock an order still holds, for the order page. Empty once shipped or cancelled. */
export async function orderReservations(
  db: Executor,
  orderId: string
): Promise<(typeof stockReservations.$inferSelect)[]> {
  return db
    .select()
    .from(stockReservations)
    .where(eq(stockReservations.orderId, orderId));
}

export type OrderPaymentRow = typeof payments.$inferSelect;

/**
 * The payments that name an order, oldest first. The order keeps no "paid" flag of its
 * own; this is what the order page and the staff detail read (payment SKILL rule).
 */
export async function orderPayments(
  db: Executor,
  orderId: string
): Promise<OrderPaymentRow[]> {
  return db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.referenceType, "order"),
        eq(payments.referenceId, orderId)
      )
    )
    .orderBy(asc(payments.createdAt), asc(payments.id));
}

/** Point an order at another payment method, as "Pay again" with a new method does. */
export async function setOrderPaymentMethod(
  db: Executor,
  orderId: string,
  paymentMethod: string
): Promise<void> {
  await db.update(orders).set({ paymentMethod }).where(eq(orders.id, orderId));
}

/** True once a returned order's items went back on the shelf. */
export async function wasRestocked(
  db: Executor,
  orderId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.orderId, orderId),
        eq(stockMovements.reason, "restock")
      )
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Put a returned order's items back on the shelf, once (grill Q8). For an order the
 * payment listener returned, which had no "Restock items" checkbox to tick. Locks the order
 * row, so two clicks restock once: the second gets `conflict`. A non-returned order gets
 * `invalid_transition`.
 */
export async function restockReturnedOrder(
  db: Executor,
  orderId: string,
  actor: OrderActor
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) {
      throw new EcommerceError("not_found", `No order ${orderId}.`);
    }
    if (order.status !== "returned") {
      throw new EcommerceError(
        "invalid_transition",
        `Only a returned order is restocked; this one is ${order.status}.`
      );
    }
    if (await wasRestocked(tx, orderId)) {
      throw new EcommerceError(
        "conflict",
        "This order's items are already back in stock."
      );
    }
    await restockOrder(tx, orderId, {
      actorUserId: actor.type === "staff" ? actor.userId : null,
    });
  });
}
