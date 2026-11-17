import { config } from "@repo/config";
import type { Db } from "@repo/db/client";
import {
  createOrder,
  getOrder,
  transitionOrder,
} from "@repo/db/repositories/ecommerce/orders";
import type {
  CreateOrderInput,
  OrderDetail,
  OrderPaymentRow,
} from "@repo/db/repositories/ecommerce/orders";
import { setOrderHold } from "@repo/db/repositories/ecommerce/stock";
import { logSms } from "@repo/db/repositories/sms-messages";
import {
  EcommerceError,
  fillOrderMessage,
  formatOrderNumber,
  nextStatuses,
} from "@repo/ecommerce";
import type { OrderActor, OrderStatus } from "@repo/ecommerce";
import { createLogger } from "@repo/logger";
import type { LoggerEnv } from "@repo/logger";
import { createPayment, PaymentError, takesNoSubmission } from "@repo/payment";
import type { Payment, PaymentEnv, PaymentNext } from "@repo/payment";
import { createSms } from "@repo/sms";
import type { SmsEnv } from "@repo/sms";
import { currentAdminWrite } from "../admin-write";

// What the shop routes and the payment listener share: placing an order and starting its
// payment, moving an order and texting the buyer, and the order as a screen reads it.
//
// Placing an order is one transaction, then one payment (plan 0106, "Payment at checkout"):
// `createOrder` locks the variants, checks stock and writes the order, its lines and its
// timed holds; then `payment.create` gets the amount from the order row, never from the
// browser. A method that takes no submission (cash on delivery) holds its stock with no
// expiry, so the hold becomes untimed once the payment says so.

const shop = () => config.ecommerce;

/** Every env key the shop's server code hands on: payment, sms, logger and the db's. */
export type ShopEnv = PaymentEnv & SmsEnv & LoggerEnv & Record<string, unknown>;

/** The order number with the configured prefix, such as `ORD-1001`. */
export function orderLabel(order: { number: number }): string {
  return formatOrderNumber(shop().orderNumberPrefix, order.number);
}

function asPayment(row: OrderPaymentRow): Payment {
  return row as unknown as Payment;
}

/** One payment as an order screen shows it. */
export function paymentView(row: OrderPaymentRow) {
  const payment = asPayment(row);
  return {
    amount: row.amount,
    createdAt: row.createdAt.toISOString(),
    currency: row.currency,
    id: row.id,
    method: row.method,
    refundedAmount: row.refundedAmount,
    reviewable:
      row.status === "submitted" ||
      (row.status === "pending" && takesNoSubmission(payment)),
    status: row.status,
    takesNoSubmission: takesNoSubmission(payment),
    transactionId: row.transactionId,
  };
}

/**
 * The flags an order screen needs, read from the payments (the order keeps no paid flag).
 *
 * - `canPayAgain`: a `placed` order whose last payment failed or was cancelled (grill Q11).
 * - `refundDue`: a cancelled or returned order with a successful payment not yet refunded
 *   in full (grill Q14). It clears when staff record the refund on the payment.
 */
export function paymentFlags(
  order: { status: string },
  payments: readonly OrderPaymentRow[]
) {
  const last = payments.at(-1);
  return {
    canPayAgain:
      order.status === "placed" &&
      last !== undefined &&
      (last.status === "failed" || last.status === "cancelled"),
    refundDue:
      (order.status === "cancelled" || order.status === "returned") &&
      payments.some(
        (payment) =>
          payment.status === "successful" &&
          payment.refundedAmount < payment.amount
      ),
  };
}

/** An order with its payments, as staff read it. */
export function staffOrderView(
  order: OrderDetail,
  payments: readonly OrderPaymentRow[],
  extra: { restocked: boolean }
) {
  return {
    ...order,
    ...paymentFlags(order, payments),
    label: orderLabel(order),
    nextStatuses: nextStatuses(order.status as OrderStatus),
    payments: payments.map(paymentView),
    restocked: extra.restocked,
  };
}

/** An order with its payments, as its buyer reads it: no staff ids, no staff notes. */
export function buyerOrderView(
  order: OrderDetail,
  payments: readonly OrderPaymentRow[]
) {
  return {
    ...paymentFlags(order, payments),
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    createdAt: order.createdAt.toISOString(),
    currency: order.currency,
    events: order.events.map((event) => ({
      createdAt: event.createdAt.toISOString(),
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
    })),
    items: order.items.map((item) => ({
      lineTotal: item.lineTotal,
      productId: item.productId,
      productTitle: item.productTitle,
      quantity: item.quantity,
      sku: item.sku,
      unitPrice: item.unitPrice,
      variantId: item.variantId,
      variantTitle: item.variantTitle,
    })),
    label: orderLabel(order),
    number: order.number,
    paymentMethod: order.paymentMethod,
    payments: payments.map(paymentView),
    shipping: order.shipping,
    shippingAddress: order.shippingAddress,
    status: order.status,
    subtotal: order.subtotal,
    total: order.total,
    zoneName: order.zoneName,
  };
}

/** Throw `method_unavailable` unless a listed provider takes `method` now. */
export function assertMethod(env: ShopEnv, method: string): void {
  const offered = createPayment(env).methods();
  if (!offered.some((listed) => listed.id === method)) {
    throw new PaymentError(
      "method_unavailable",
      `No installed payment provider takes "${method}". Offered: ${offered.map((listed) => listed.id).join(", ") || "none"}.`
    );
  }
}

/**
 * Start a payment for an order, for its full total. A method with no submission (cash on
 * delivery) makes the order's hold untimed (grill Q11).
 */
export async function openPayment(
  db: Db,
  env: ShopEnv,
  order: { id: string; total: number; currency: string; userId: string },
  input: { method: string; returnUrl?: string }
): Promise<{ payment: Payment; next: PaymentNext }> {
  const created = await createPayment(env).create({
    amount: order.total,
    currency: order.currency,
    method: input.method,
    referenceId: order.id,
    referenceType: "order",
    returnUrl: input.returnUrl,
    userId: order.userId,
  });
  if (takesNoSubmission(created.payment)) {
    await setOrderHold(db, {
      holdHours: shop().unpaidHoldHours,
      kind: "untimed",
      orderId: order.id,
    });
  }
  return created;
}

/**
 * Place an order and start its payment: the checkout and the staff "New order" page (Q33)
 * both come here. Throws `method_unavailable` before anything is written when no provider
 * takes the method. When the payment cannot start, the order is cancelled by the system
 * and the error is thrown on.
 */
export async function placeOrder(
  db: Db,
  env: ShopEnv,
  input: Omit<CreateOrderInput, "currency" | "hold" | "holdHours"> & {
    returnUrl?: string;
  }
): Promise<{ order: OrderDetail; payment: Payment; next: PaymentNext }> {
  assertMethod(env, input.paymentMethod);
  const { returnUrl, ...rest } = input;
  const order = await createOrder(db, {
    ...rest,
    currency: shop().currency,
    hold: "timed",
    holdHours: shop().unpaidHoldHours,
  });
  let started: { payment: Payment; next: PaymentNext };
  try {
    started = await openPayment(db, env, order, {
      method: input.paymentMethod,
      returnUrl,
    });
  } catch (error) {
    await transitionOrder(db, {
      actor: { type: "system" },
      note: "The payment could not start.",
      orderId: order.id,
      to: "cancelled",
    });
    throw error;
  }
  return { ...started, order: await mustGetOrder(db, order.id) };
}

export async function mustGetOrder(
  db: Db,
  orderId: string
): Promise<OrderDetail> {
  const order = await getOrder(db, orderId);
  if (!order) {
    throw new EcommerceError("not_found", `No order ${orderId}.`);
  }
  return order;
}

/** The SMS a status sends, or null when the status sends none or its switch is off. */
function messageFor(status: OrderStatus) {
  const settings = shop();
  if (status === "confirmed" && settings.notifyOnConfirmed) {
    return { template: "order-confirmed", text: settings.confirmedMessage };
  }
  if (status === "shipped" && settings.notifyOnShipped) {
    return { template: "order-shipped", text: settings.shippedMessage };
  }
  return null;
}

/**
 * Text the buyer about a status (grill Q10, Q15): one SMS on `confirmed` and one on
 * `shipped`, each behind its config switch. Inside an `adminWrite` the send waits for the
 * commit; elsewhere it goes now. A failed send is logged in `sms_messages` and never fails
 * the move that caused it.
 */
export async function notifyBuyer(
  db: Db,
  env: ShopEnv,
  order: OrderDetail,
  status: OrderStatus
): Promise<void> {
  const message = messageFor(status);
  if (!message) {
    return;
  }
  const body = fillOrderMessage(message.text, {
    orderNumber: orderLabel(order),
    shopName: shop().shopName,
  });
  const send = async (client: Db) => {
    const entry = {
      purpose: "order_status",
      template: message.template,
      toPhone: order.contactPhone,
      userId: order.userId,
    };
    let provider = "unknown";
    try {
      const sender = createSms(env);
      ({ provider } = sender);
      const { messageId } = await sender.send({ body, to: order.contactPhone });
      await logSms(client, {
        ...entry,
        provider,
        providerRef: messageId,
        status: "sent",
      });
    } catch (error) {
      createLogger(env).error("ecommerce: the order SMS was not sent", {
        err: error,
        orderId: order.id,
        status,
      });
      await logSms(client, {
        ...entry,
        error: error instanceof Error ? error.message.slice(0, 500) : null,
        provider,
        status: "failed",
      }).catch(() => {
        // The log is best effort; the status change already stands.
      });
    }
  };
  const write = currentAdminWrite();
  if (write) {
    write.afterCommit(send);
    return;
  }
  await send(db);
}

/** Move an order through the status machine, then text the buyer when the status says so. */
export async function moveOrder(
  db: Db,
  env: ShopEnv,
  input: {
    orderId: string;
    to: OrderStatus;
    actor: OrderActor;
    note?: string | null;
    restock?: boolean;
  }
): Promise<OrderDetail> {
  const order = await transitionOrder(db, input);
  await notifyBuyer(db, env, order, input.to);
  return order;
}
