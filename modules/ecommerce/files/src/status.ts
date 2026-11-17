import { EcommerceError } from "./errors";

// The order status machine (plan 0106, grill Q2, Q11, Q12). This table is the only list of
// moves: the repositories and the api check every status change against it.
//
//   placed    -> confirmed   staff (COD), or the payment listener on `successful`
//   placed    -> cancelled   staff, or `system` when an unpaid hold expires
//   confirmed -> shipped     staff; the reservation becomes stock_movements rows
//   confirmed -> cancelled   staff; "Refund due" when a payment is successful
//   shipped   -> delivered   staff; COD cash is confirmed on the payment, separately
//   shipped   -> returned    staff, or the listener on a COD delivery reject
//
// An order never carries its own "paid" flag. It reads `payments` by reference.

export const ORDER_STATUSES = [
  "placed",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: [],
  cancelled: [],
  returned: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

/** True when the table allows `from -> to`. An unknown status on either side is false. */
export function canTransition(from: string, to: string): boolean {
  return (
    isOrderStatus(from) &&
    isOrderStatus(to) &&
    ORDER_TRANSITIONS[from].includes(to)
  );
}

/** Throw `invalid_transition` unless the table allows `from -> to`. */
export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new EcommerceError(
      "invalid_transition",
      `An order cannot move from ${from} to ${to}.`
    );
  }
}

/** The statuses an order in `from` may move to. */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

/** True for a status no move leaves: delivered, cancelled, returned. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}
