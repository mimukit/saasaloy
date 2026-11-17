// The `payment` listener that moves an order when its payment changes (plan 0106, grill
// Q2, Q11, Q12). `saasaloy add ecommerce` appends `orderPaymentListener()` to the
// `listeners` array in `packages/payment/src/index.ts`.
//
// The listener lives here, in the package with no dependencies, and does no work itself.
// The work needs the database, the status machine's repository and the SMS sender, and
// `packages/payment` has zero runtime dependencies, so it cannot import them. The api
// registers the handler that does the work at module load
// (`apps/api/src/lib/ecommerce/payment-listener.ts`), the same way it registers the
// payment store's resolver. This file only filters and dispatches.
//
// The types are structural, so this package does not import `@repo/payment` either:
// the listener fits `PaymentListener` because a `PaymentChange` carries every
// field named here.

/** The part of a `Payment` the order side reads. */
export interface OrderPaymentView {
  id: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  referenceType: string;
  referenceId: string;
  userId: string | null;
  /** Kept by the payment core. `instructions.fields` empty marks a method with no submission (COD). */
  providerData: Record<string, unknown> | null;
}

/** One payment status change, as the payment core reports it. */
export interface OrderPaymentChange {
  payment: OrderPaymentView;
  from: string | null;
  to: string;
}

/** What does the work: the api's handler, with the request's env. */
export type OrderPaymentHandler = (
  env: object,
  change: OrderPaymentChange
) => Promise<void>;

/** The `referenceType` an order's payments carry. */
export const ORDER_REFERENCE_TYPE = "order";

let handler: OrderPaymentHandler | undefined;

/** Register the handler. The api calls this once at module load; a test passes `undefined` to clear it. */
export function setOrderPaymentHandler(
  next: OrderPaymentHandler | undefined
): void {
  handler = next;
}

/** The listener the payment core calls with each status change. */
export type OrderPaymentListener = (
  env: object,
  change: OrderPaymentChange
) => Promise<void>;

/**
 * The listener, as the `plugin-array` patch registers it: `listeners:
 * [orderPaymentListener()]`. A payment for anything but an order is not ours. An order
 * payment with no handler registered throws, which the payment core logs with the payment
 * id: the status change stands, and the log says why the order did not move.
 */
export function orderPaymentListener(): OrderPaymentListener {
  return async (env, change) => {
    if (change.payment.referenceType !== ORDER_REFERENCE_TYPE) {
      return;
    }
    if (!handler) {
      throw new Error(
        `ecommerce: no order payment handler is registered, so order ${change.payment.referenceId} did not move. apps/api/src/lib/ecommerce/payment-listener.ts registers it; import it from the Worker entry.`
      );
    }
    await handler(env, change);
  };
}
