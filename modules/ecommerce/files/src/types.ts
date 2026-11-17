import type { OrderStatus } from "./status";

// The shared shapes the api, the admin screens and the storefront agree on. Rows come from
// `@repo/db/schema/ecommerce`; these are the narrow value types around them.

/** A product is a draft until staff publish it. Only an active product is for sale. */
export const PRODUCT_STATUSES = ["draft", "active"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Who moved an order: a staff member, or the system (an expired hold, a payment listener). */
export type OrderActor = { type: "staff"; userId: string } | { type: "system" };

/** Why on-hand stock changed. Each change writes one `stock_movements` row. */
export const STOCK_MOVEMENT_REASONS = [
  /** A reservation converted when its order shipped. Negative. */
  "shipped",
  /** A returned order's items put back by the "Restock items" checkbox. Positive. */
  "restock",
  /** A staff edit on the product page. Either sign. */
  "adjustment",
] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** A money amount: integer minor units beside an ISO 4217 code. */
export interface Money {
  amount: number;
  currency: string;
}

/** A shipping zone as checkout offers it: a flat rate per order. */
export interface ShippingZone {
  id: string;
  name: string;
  rate: Money;
  active: boolean;
}

/** A shipping address. The order keeps a copy, so a later edit leaves past orders alone. */
export interface Address {
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  area?: string | null;
  city: string;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

/** One order event as the history panel shows it. */
export interface OrderEventView {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actor: OrderActor;
  note: string | null;
  createdAt: Date;
}
