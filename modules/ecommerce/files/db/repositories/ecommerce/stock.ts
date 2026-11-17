import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { EcommerceError, holdExpiry } from "@repo/ecommerce";
import type { HoldKind } from "@repo/ecommerce";
import {
  inventoryLevels,
  orderItems,
  productVariants,
  stockMovements,
  stockReservations,
} from "../../schema/ecommerce";
import { newId } from "./shared";
import type { Executor, Tx } from "./shared";

// Stock: what is on hand, what orders hold, and every change to on hand.
//
// Available = `inventory_levels.on_hand` minus the variant's reservations whose
// `expires_at` is null or still ahead of `now`. An expired hold stops counting at once,
// with no sweep job. On hand moves only here, and each move writes a `stock_movements`
// row: at `shipped` (`convertReservations`), on a restock, and on a staff edit.
//
// A write that reads availability first locks the variant rows with `SELECT … FOR UPDATE`
// inside its transaction, in id order, so two checkouts for the last unit run one after the
// other and the second sees the first one's reservation.

/** One variant's stock figures. */
export interface StockLevel {
  variantId: string;
  onHand: number;
  /** The sum of the live reservations. */
  reserved: number;
  /** `onHand - reserved`, never below zero. */
  available: number;
}

/** A variant and the quantity a line asks for. */
export interface StockLine {
  variantId: string;
  quantity: number;
}

/** Who changed stock by hand. Null for a change the system made. */
export interface StockActor {
  actorUserId?: string | null;
  note?: string | null;
}

/** The sum of a variant's live reservations at `now`, as a scalar subquery. */
function reservedAt(now: Date) {
  return sql<number>`coalesce((
    select sum(${stockReservations.quantity})
    from ${stockReservations}
    where ${stockReservations.variantId} = ${productVariants.id}
      and (${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > ${now.toISOString()}::timestamptz)
  ), 0)::int`;
}

/** Stock figures for `variantIds`, keyed by variant id. A variant with no level row has 0. */
export async function stockLevels(
  db: Executor,
  variantIds: readonly string[],
  now = new Date()
): Promise<Map<string, StockLevel>> {
  const levels = new Map<string, StockLevel>();
  if (variantIds.length === 0) {
    return levels;
  }
  const rows = await db
    .select({
      onHand: sql<number>`coalesce(${inventoryLevels.onHand}, 0)::int`,
      reserved: reservedAt(now),
      variantId: productVariants.id,
    })
    .from(productVariants)
    .leftJoin(
      inventoryLevels,
      eq(inventoryLevels.variantId, productVariants.id)
    )
    .where(inArray(productVariants.id, [...variantIds]));
  for (const row of rows) {
    levels.set(row.variantId, {
      ...row,
      available: Math.max(0, row.onHand - row.reserved),
    });
  }
  return levels;
}

/** The available stock of one variant at `now`. */
export async function availableFor(
  db: Executor,
  variantId: string,
  now = new Date()
): Promise<number> {
  const levels = await stockLevels(db, [variantId], now);
  return levels.get(variantId)?.available ?? 0;
}

/**
 * Lock the variant rows with `SELECT … FOR UPDATE`, in id order. Call inside a
 * transaction; the locks hold until it ends. Throws `not_found` for a missing variant.
 */
export async function lockVariants(
  tx: Tx,
  variantIds: readonly string[]
): Promise<void> {
  const ids = [...new Set(variantIds)].toSorted();
  if (ids.length === 0) {
    return;
  }
  const locked = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(inArray(productVariants.id, ids))
    .orderBy(asc(productVariants.id))
    .for("update");
  if (locked.length !== ids.length) {
    const found = new Set(locked.map((row) => row.id));
    throw new EcommerceError(
      "not_found",
      `No variant ${ids.find((id) => !found.has(id))}.`
    );
  }
}

/** Sum the quantities per variant, so two lines of one variant count once. */
export function quantitiesByVariant(
  lines: readonly StockLine[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new EcommerceError(
        "invalid_quantity",
        `A line needs a whole quantity of 1 or more, not ${line.quantity}.`
      );
    }
    totals.set(
      line.variantId,
      (totals.get(line.variantId) ?? 0) + line.quantity
    );
  }
  return totals;
}

/**
 * Throw `out_of_stock` unless every line fits the available stock. Call after
 * `lockVariants`, in the same transaction.
 */
export async function assertAvailable(
  tx: Tx,
  lines: readonly StockLine[],
  now: Date
): Promise<void> {
  const wanted = quantitiesByVariant(lines);
  const levels = await stockLevels(tx, [...wanted.keys()], now);
  for (const [variantId, quantity] of wanted) {
    const available = levels.get(variantId)?.available ?? 0;
    if (quantity > available) {
      throw new EcommerceError(
        "out_of_stock",
        `Variant ${variantId}: ${quantity} asked, ${available} available.`
      );
    }
  }
}

/**
 * Hold stock for an order: lock the variants, check availability, insert one reservation
 * per variant. `kind: "timed"` expires after `holdHours`; `"untimed"` holds until the order
 * ships or is cancelled. Throws `out_of_stock` and writes nothing when a line does not fit.
 */
export async function reserveStock(
  db: Executor,
  input: {
    orderId: string;
    lines: readonly StockLine[];
    kind: HoldKind;
    holdHours: number;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await lockVariants(
      tx,
      input.lines.map((line) => line.variantId)
    );
    await assertAvailable(tx, input.lines, now);
    await insertReservations(tx, input.orderId, input.lines, {
      expiresAt: holdExpiry(input.kind, now, input.holdHours),
    });
  });
}

/** Insert the reservation rows. The caller has locked the variants and checked stock. */
export async function insertReservations(
  tx: Tx,
  orderId: string,
  lines: readonly StockLine[],
  options: { expiresAt: Date | null }
): Promise<void> {
  const rows = [...quantitiesByVariant(lines)].map(([variantId, quantity]) => ({
    expiresAt: options.expiresAt,
    id: newId(),
    orderId,
    quantity,
    variantId,
  }));
  if (rows.length > 0) {
    await tx.insert(stockReservations).values(rows);
  }
}

/**
 * Change an order's holds between timed and untimed (grill Q11): a `successful`,
 * `submitted` or COD payment takes `untimed`; a `failed` or `cancelled` one goes back to
 * `timed`, now plus the lifetime. A hold that already expired is renewed only when stock
 * still allows it: the call locks the variants and throws `out_of_stock` otherwise.
 */
export async function setOrderHold(
  db: Executor,
  input: { orderId: string; kind: HoldKind; holdHours: number; now?: Date }
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const holds = await tx
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, input.orderId));
    if (holds.length === 0) {
      return;
    }
    await lockVariants(
      tx,
      holds.map((hold) => hold.variantId)
    );
    const lapsed = holds.filter(
      (hold) =>
        hold.expiresAt !== null && hold.expiresAt.getTime() <= now.getTime()
    );
    if (lapsed.length > 0) {
      // A lapsed hold no longer counts, so it competes for stock like a new one.
      await assertAvailable(tx, lapsed, now);
    }
    await tx
      .update(stockReservations)
      .set({ expiresAt: holdExpiry(input.kind, now, input.holdHours) })
      .where(eq(stockReservations.orderId, input.orderId));
  });
}

/** Delete an order's holds: the order was cancelled. On hand does not change. */
export async function releaseReservations(
  db: Executor,
  orderId: string
): Promise<void> {
  await db
    .delete(stockReservations)
    .where(eq(stockReservations.orderId, orderId));
}

/** Add `delta` to a variant's on hand and write the movement. The caller holds the lock. */
async function moveStock(
  tx: Tx,
  input: {
    variantId: string;
    delta: number;
    reason: "shipped" | "restock" | "adjustment";
    orderId?: string | null;
  } & StockActor
): Promise<number> {
  // Update first: Postgres checks `inventory_levels_on_hand_check` on the row an
  // `INSERT … ON CONFLICT` proposes, before it finds the conflict, so an upsert with a
  // negative delta would fail even on a row that holds enough. A missing row is on hand 0.
  // Going below zero trips the check, which `stockCheck` turns into `out_of_stock`.
  const write = async () => {
    const [updated] = await tx
      .update(inventoryLevels)
      .set({ onHand: sql`${inventoryLevels.onHand} + ${input.delta}` })
      .where(eq(inventoryLevels.variantId, input.variantId))
      .returning({ onHand: inventoryLevels.onHand });
    if (updated) {
      return updated;
    }
    const [inserted] = await tx
      .insert(inventoryLevels)
      .values({ onHand: input.delta, variantId: input.variantId })
      .returning({ onHand: inventoryLevels.onHand });
    return inserted;
  };
  const level = await write().catch((error: unknown) => {
    throw stockCheck(error, input.variantId);
  });
  await tx.insert(stockMovements).values({
    actorUserId: input.actorUserId ?? null,
    delta: input.delta,
    id: newId(),
    note: input.note ?? null,
    orderId: input.orderId ?? null,
    reason: input.reason,
    variantId: input.variantId,
  });
  return level?.onHand ?? 0;
}

/** The `on_hand >= 0` check failing is an `out_of_stock`, not a crash. */
function stockCheck(error: unknown, variantId: string): unknown {
  const text = String((error as { cause?: unknown }).cause ?? error);
  return text.includes("inventory_levels_on_hand_check")
    ? new EcommerceError(
        "out_of_stock",
        `On hand for ${variantId} cannot go below zero.`
      )
    : error;
}

/**
 * The order shipped: each reservation leaves on hand as a `shipped` movement and is
 * deleted. This is the only place an order changes on hand on the way out (grill Q13).
 */
export async function convertReservations(
  db: Executor,
  orderId: string,
  actor: StockActor = {}
): Promise<void> {
  await db.transaction(async (tx) => {
    const holds = await tx
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    await lockVariants(
      tx,
      holds.map((hold) => hold.variantId)
    );
    for (const hold of holds) {
      await moveStock(tx, {
        ...actor,
        delta: -hold.quantity,
        orderId,
        reason: "shipped",
        variantId: hold.variantId,
      });
    }
    await releaseReservations(tx, orderId);
  });
}

/**
 * A returned order's items go back on the shelf: one `restock` movement per line whose
 * variant still exists. The "Restock items" checkbox decides whether this runs (grill Q8).
 */
export async function restockOrder(
  db: Executor,
  orderId: string,
  actor: StockActor = {}
): Promise<void> {
  await db.transaction(async (tx) => {
    const lines = await tx
      .select({
        quantity: orderItems.quantity,
        variantId: orderItems.variantId,
      })
      .from(orderItems)
      .where(
        and(eq(orderItems.orderId, orderId), isNotNull(orderItems.variantId))
      );
    const wanted = quantitiesByVariant(
      lines.map((line) => ({
        quantity: line.quantity,
        variantId: line.variantId ?? "",
      }))
    );
    await lockVariants(tx, [...wanted.keys()]);
    for (const [variantId, quantity] of wanted) {
      await moveStock(tx, {
        ...actor,
        delta: quantity,
        orderId,
        reason: "restock",
        variantId,
      });
    }
  });
}

/**
 * A staff stock edit: a `delta`, or a counted `onHand`. Writes an `adjustment` movement
 * and returns the new on hand. Throws `out_of_stock` when on hand would go below zero.
 */
export async function adjustStock(
  db: Executor,
  variantId: string,
  change: { delta: number } | { onHand: number },
  actor: StockActor = {}
): Promise<number> {
  return db.transaction(async (tx) => {
    await lockVariants(tx, [variantId]);
    const [current] = await tx
      .select({ onHand: inventoryLevels.onHand })
      .from(inventoryLevels)
      .where(eq(inventoryLevels.variantId, variantId));
    const onHand = current?.onHand ?? 0;
    const delta = "delta" in change ? change.delta : change.onHand - onHand;
    if (!Number.isSafeInteger(delta)) {
      throw new EcommerceError("invalid_quantity", `${delta} is not whole.`);
    }
    if (onHand + delta < 0) {
      throw new EcommerceError(
        "out_of_stock",
        `On hand for ${variantId} cannot go below zero.`
      );
    }
    if (delta === 0) {
      return onHand;
    }
    return moveStock(tx, { ...actor, delta, reason: "adjustment", variantId });
  });
}
