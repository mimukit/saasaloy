import { and, desc, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import { ORDER_STATUSES } from "@repo/ecommerce";
import type { OrderStatus } from "@repo/ecommerce";
import { orderItems, orders } from "../../schema/ecommerce";
import { payments } from "../../schema/payment";
import type { Executor } from "./shared";

// The shop's reports, computed by SQL at read time with no rollup tables (plan 0106,
// "Reports", grill Q9). Every query takes a half-open range `[from, to)` on the order's
// `created_at`; the api turns "today", "7 days", "30 days" or a custom pair of dates into
// one.
//
// A sale is an order that was neither cancelled nor returned. The COD figures count the
// COD orders that reached an outcome: `delivered` or `returned`. Collected means the COD
// payment is `successful`, which staff confirm when the courier remits the cash.

export interface ReportRange {
  from: Date;
  to: Date;
}

/** One day of sales, the day in `timeZone`. */
export interface SalesDay {
  /** `YYYY-MM-DD`. */
  day: string;
  orders: number;
  total: number;
}

export interface TopProduct {
  productId: string | null;
  productTitle: string;
  quantity: number;
  revenue: number;
}

export interface CountAndAmount {
  count: number;
  amount: number;
}

export interface CodReport {
  delivered: CountAndAmount;
  returned: CountAndAmount;
  collected: CountAndAmount;
  /** `collected.count / (delivered.count + returned.count)`, 0 with no outcome. */
  collectionRate: number;
  /** `returned.count / (delivered.count + returned.count)`, 0 with no outcome. */
  refusalRate: number;
}

const NOT_SALES: OrderStatus[] = ["cancelled", "returned"];

function inRange(range: ReportRange) {
  return and(gte(orders.createdAt, range.from), lt(orders.createdAt, range.to));
}

/** Orders and their totals per day, sales only. Days with no sale are left out. */
export async function salesByDay(
  db: Executor,
  range: ReportRange & { timeZone: string }
): Promise<SalesDay[]> {
  const day = sql<string>`to_char((${orders.createdAt} at time zone ${range.timeZone})::date, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      orders: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.total}), 0)::int`,
    })
    .from(orders)
    .where(and(inRange(range), notInArray(orders.status, NOT_SALES)))
    // By position: the time zone is a bound parameter, so a repeated expression would
    // carry a second placeholder and Postgres would not see the two as one.
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((row) => ({
    day: row.day,
    orders: Number(row.orders),
    total: Number(row.total),
  }));
}

/** The products sold most, by quantity, sales only. */
export async function topProducts(
  db: Executor,
  range: ReportRange & { limit?: number }
): Promise<TopProduct[]> {
  const quantity = sql<number>`sum(${orderItems.quantity})::int`;
  const rows = await db
    .select({
      productId: orderItems.productId,
      productTitle: sql<string>`max(${orderItems.productTitle})`,
      quantity,
      revenue: sql<number>`sum(${orderItems.lineTotal})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(inRange(range), notInArray(orders.status, NOT_SALES)))
    .groupBy(orderItems.productId, orderItems.productTitle)
    .orderBy(desc(quantity), desc(sql`sum(${orderItems.lineTotal})`))
    .limit(range.limit ?? 10);
  return rows.map((row) => ({
    productId: row.productId,
    productTitle: row.productTitle,
    quantity: Number(row.quantity),
    revenue: Number(row.revenue),
  }));
}

/** How many orders of the range sit in each status now. Every status is present. */
export async function ordersByStatus(
  db: Executor,
  range: ReportRange
): Promise<Record<OrderStatus, number>> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int`, status: orders.status })
    .from(orders)
    .where(inRange(range))
    .groupBy(orders.status);
  const counts = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status, 0])
  ) as Record<OrderStatus, number>;
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as OrderStatus] = Number(row.n);
    }
  }
  return counts;
}

/** COD collection and refusal, by order count with the amount beside it (Q9). */
export async function codReport(
  db: Executor,
  range: ReportRange
): Promise<CodReport> {
  const paid = sql`exists (
    select 1 from ${payments}
    where ${payments.referenceType} = 'order'
      and ${payments.referenceId} = ${orders.id}
      and ${payments.status} = 'successful'
  )`;
  const [row] = await db
    .select({
      collectedAmount: sql<number>`coalesce(sum(${orders.total}) filter (where ${paid}), 0)::int`,
      collectedCount: sql<number>`count(*) filter (where ${paid})::int`,
      deliveredAmount: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'delivered'), 0)::int`,
      deliveredCount: sql<number>`count(*) filter (where ${orders.status} = 'delivered')::int`,
      returnedAmount: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'returned'), 0)::int`,
      returnedCount: sql<number>`count(*) filter (where ${orders.status} = 'returned')::int`,
    })
    .from(orders)
    .where(
      and(
        inRange(range),
        eq(orders.paymentMethod, "cod"),
        sql`${orders.status} in ('delivered', 'returned')`
      )
    );
  const delivered = {
    amount: Number(row?.deliveredAmount ?? 0),
    count: Number(row?.deliveredCount ?? 0),
  };
  const returned = {
    amount: Number(row?.returnedAmount ?? 0),
    count: Number(row?.returnedCount ?? 0),
  };
  const collected = {
    amount: Number(row?.collectedAmount ?? 0),
    count: Number(row?.collectedCount ?? 0),
  };
  const outcomes = delivered.count + returned.count;
  return {
    collected,
    collectionRate: outcomes === 0 ? 0 : collected.count / outcomes,
    delivered,
    refusalRate: outcomes === 0 ? 0 : returned.count / outcomes,
    returned,
  };
}
