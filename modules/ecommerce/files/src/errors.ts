// The one error type `@repo/ecommerce` and the ecommerce repositories throw. A caller's
// `catch` reads `code`, which is stable; the message is for a log.

/** Every code an ecommerce rule or repository throws. */
export type EcommerceErrorCode =
  /** The order is not in a status the move starts from. */
  | "invalid_transition"
  /** Not enough available stock for the quantity asked. */
  | "out_of_stock"
  /** A row the call names does not exist. */
  | "not_found"
  /** A concurrent write got there first, or a unique key is taken. */
  | "conflict"
  /** A variant has no price in the store currency, so it cannot be active. */
  | "no_store_price"
  /** A product has no active variant, so it cannot be active. */
  | "no_active_variant"
  /** A product or variant that is not active cannot be sold. */
  | "not_for_sale"
  /** Two amounts in one sum carry different currencies. */
  | "currency_mismatch"
  /** Not an ISO 4217 code. */
  | "invalid_currency"
  /** Not a non-negative integer in minor units, or past the safe integer range. */
  | "invalid_amount"
  /** Not a whole number of items, or not above zero where one is required. */
  | "invalid_quantity"
  /** An order needs at least one line. */
  | "empty_order";

export class EcommerceError extends Error {
  readonly code: EcommerceErrorCode;

  constructor(code: EcommerceErrorCode, message: string) {
    super(message);
    this.name = "EcommerceError";
    this.code = code;
  }
}

export function isEcommerceError(error: unknown): error is EcommerceError {
  return error instanceof EcommerceError;
}
