import { EcommerceError } from "./errors";

// The catalog, stock and cart rules the repositories in `@repo/db/repositories/ecommerce/`
// apply. They live here, in the package with no dependencies, so the repositories and the
// api share one copy and a plain `node --test` covers them.

/** A price row as the activation rule reads it. */
export interface PriceLike {
  currency: string;
  amount: number;
}

/** A variant needs a price in the store currency before it may be active (grill Q4). */
export function assertVariantActivatable(
  prices: readonly PriceLike[],
  storeCurrency: string
): void {
  if (!prices.some((price) => price.currency === storeCurrency)) {
    throw new EcommerceError(
      "no_store_price",
      `A variant needs a ${storeCurrency} price before it can be active.`
    );
  }
}

/** A product needs one or more active variants before it may be active (grill Q4). */
export function assertProductActivatable(
  variants: readonly { active: boolean }[]
): void {
  if (!variants.some((variant) => variant.active)) {
    throw new EcommerceError(
      "no_active_variant",
      "A product needs at least one active variant before it can be active."
    );
  }
}

/** A stock reservation as the availability rule reads it. */
export interface HoldLike {
  quantity: number;
  /** Null holds until the order ships or is cancelled. */
  expiresAt: Date | null;
}

/** A hold counts while it has no expiry or its expiry is still ahead of `now`. */
export function isLiveReservation(
  hold: Pick<HoldLike, "expiresAt">,
  now: Date
): boolean {
  return hold.expiresAt === null || hold.expiresAt.getTime() > now.getTime();
}

/** On hand minus every live hold, never below zero. Expired holds stop counting at once. */
export function availableStock(
  onHand: number,
  holds: readonly HoldLike[],
  now: Date
): number {
  let held = 0;
  for (const hold of holds) {
    if (isLiveReservation(hold, now)) {
      held += hold.quantity;
    }
  }
  return Math.max(0, onHand - held);
}

/**
 * The kind of hold an order's reservation takes. `timed` is an unpaid online payment,
 * which lapses after the configured lifetime. `untimed` is COD, a submitted payment or a
 * successful one, which holds until the order ships or is cancelled.
 */
export type HoldKind = "timed" | "untimed";

/** The `expires_at` a hold of `kind` gets, created at `now`. */
export function holdExpiry(
  kind: HoldKind,
  now: Date,
  lifetimeHours: number
): Date | null {
  return kind === "timed"
    ? new Date(now.getTime() + lifetimeHours * 3_600_000)
    : null;
}

/** A guest line merged into the user's cart: the quantities add, capped at available. */
export function mergedQuantity(
  userQuantity: number,
  guestQuantity: number,
  available: number
): number {
  return Math.max(0, Math.min(userQuantity + guestQuantity, available));
}

/** A cart line as the checkout stock check reads it. */
export interface StockLine {
  productTitle: string;
  variantTitle: string;
  quantity: number;
  available: number;
}

/**
 * The buyer's message for the first line the available stock no longer covers, or null
 * when every line fits. Checkout answers it with `out_of_stock`, so the buyer reads which
 * item ran out rather than a variant id.
 */
export function shortLineMessage(lines: readonly StockLine[]): string | null {
  const short = lines.find((line) => line.quantity > line.available);
  if (!short) {
    return null;
  }
  const name = short.variantTitle
    ? `${short.productTitle} (${short.variantTitle})`
    : short.productTitle;
  return short.available <= 0
    ? `${name} sold out while you checked out. Remove it from the cart to place the order.`
    : `Only ${short.available} of ${name} left. Lower the quantity in the cart to place the order.`;
}
