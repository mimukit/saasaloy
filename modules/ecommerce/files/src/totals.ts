import { EcommerceError } from "./errors";
import { addMinor, assertMinor, multiplyMinor } from "./money";

// Cart and order totals. The server computes every figure from catalog prices and the
// chosen zone's rate; a price the browser sends is never an input here. Prices include
// tax, so there is no tax line.

/** One line of a cart or an order: a unit price in minor units times a quantity. */
export interface PricedLine {
  unitPrice: number;
  quantity: number;
  currency: string;
}

export interface CartTotals {
  currency: string;
  /** The number of items, the quantities summed. */
  itemCount: number;
  subtotal: number;
}

export interface OrderTotals extends CartTotals {
  shipping: number;
  total: number;
}

/** The unit price times the quantity. A line needs a quantity of one or more. */
export function lineTotal(line: PricedLine): number {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new EcommerceError(
      "invalid_quantity",
      `A line needs a whole quantity of 1 or more, not ${line.quantity}.`
    );
  }
  return multiplyMinor(line.unitPrice, line.quantity);
}

/** The subtotal and item count of `lines`, all in `currency`. */
export function cartTotals(
  lines: readonly PricedLine[],
  currency: string
): CartTotals {
  let subtotal = 0;
  let itemCount = 0;
  for (const line of lines) {
    if (line.currency !== currency) {
      throw new EcommerceError(
        "currency_mismatch",
        `A ${line.currency} line cannot go in a ${currency} total.`
      );
    }
    subtotal = addMinor(subtotal, lineTotal(line));
    itemCount += line.quantity;
  }
  return { currency, itemCount, subtotal };
}

/** The order's subtotal, its shipping rate and the total the payment asks for. */
export function orderTotals(input: {
  currency: string;
  lines: readonly PricedLine[];
  /** The zone's flat rate, in minor units. */
  shipping: number;
}): OrderTotals {
  if (input.lines.length === 0) {
    throw new EcommerceError(
      "empty_order",
      "An order needs at least one line."
    );
  }
  const cart = cartTotals(input.lines, input.currency);
  const shipping = assertMinor(input.shipping);
  return { ...cart, shipping, total: addMinor(cart.subtotal, shipping) };
}
