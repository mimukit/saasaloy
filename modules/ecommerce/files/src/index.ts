// `@repo/ecommerce`: money in minor units, cart and order totals, the order status machine,
// the catalog and stock rules, and the shared types. It has no dependencies and reads no
// env and no config, so the api, the admin app, the storefront and the ecommerce
// repositories in `@repo/db` all import it.

export { EcommerceError, isEcommerceError } from "./errors";
export type { EcommerceErrorCode } from "./errors";
export {
  addMinor,
  assertCurrency,
  assertMinor,
  formatMoney,
  formatPrice,
  fromMinor,
  isCurrencyCode,
  minorExponent,
  multiplyMinor,
  toMinor,
} from "./money";
export { cartTotals, lineTotal, orderTotals } from "./totals";
export type { CartTotals, OrderTotals, PricedLine } from "./totals";
export {
  assertTransition,
  canTransition,
  isOrderStatus,
  isTerminalStatus,
  nextStatuses,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
} from "./status";
export type { OrderStatus } from "./status";
export {
  assertProductActivatable,
  assertVariantActivatable,
  availableStock,
  holdExpiry,
  isLiveReservation,
  mergedQuantity,
} from "./rules";
export type { HoldKind, HoldLike, PriceLike } from "./rules";
export { fillOrderMessage, formatOrderNumber } from "./notify";
export type { OrderMessageValues } from "./notify";
export {
  ORDER_REFERENCE_TYPE,
  orderPaymentListener,
  setOrderPaymentHandler,
} from "./payment-listener";
export type {
  OrderPaymentChange,
  OrderPaymentHandler,
  OrderPaymentListener,
  OrderPaymentView,
} from "./payment-listener";
export { PRODUCT_STATUSES, STOCK_MOVEMENT_REASONS } from "./types";
export type {
  Address,
  Money,
  OrderActor,
  OrderEventView,
  ProductStatus,
  ShippingZone,
  StockMovementReason,
} from "./types";
