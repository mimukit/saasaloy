import { config } from "@repo/config";
import { withDb } from "@repo/db/client";
import type { Db, DbBindings } from "@repo/db/client";
import { getOrder } from "@repo/db/repositories/ecommerce/orders";
import { setOrderHold } from "@repo/db/repositories/ecommerce/stock";
import { paymentEvents } from "@repo/db/schema/payment";
import { setOrderPaymentHandler } from "@repo/ecommerce";
import type { OrderPaymentChange } from "@repo/ecommerce";
import { takesNoSubmission } from "@repo/payment";
import type { Payment } from "@repo/payment";
import { and, desc, eq } from "drizzle-orm";
import { currentAdminWrite } from "../admin-write";
import { moveOrder } from "./order-flow";
import type { ShopEnv } from "./order-flow";
import { currentShopDb } from "./scope";

// The work behind `orderPaymentListener` (`@repo/ecommerce`), which `saasaloy add
// ecommerce` registers in `packages/payment/src/index.ts`. This file registers it at
// module load; the shop routes import it, and the api's entry imports the routes, so it is
// in place before the first request.
//
// The rules (plan 0106, grill Q2, Q11, Q12), for an order still `placed`:
//
//   submitted              the hold loses its expiry
//   successful             the hold loses its expiry; an online payment confirms the order
//   failed or cancelled    an online payment's hold is timed again, from now; the order
//                          stays placed and its page offers "Pay again"
//
// and for a `shipped` order, a COD payment rejected with `delivery_refused` or
// `delivery_failed` moves it to `returned`. A COD payment confirmed later records the
// cash and moves nothing: staff confirm a COD order themselves, usually after a call.
//
// The listener writes through the client the change was made on: the open `adminWrite`'s
// transaction, the shop route's client, or one of its own for a caller with neither.
// Every rule checks the order's status first, so a replayed change moves nothing twice.

const DELIVERY_REASONS: Record<string, string> = {
  delivery_failed: "The courier could not deliver the parcel.",
  delivery_refused: "The buyer refused the parcel.",
};

/** The reason staff gave when they rejected the payment, or null. */
async function rejectReason(db: Db, paymentId: string): Promise<string | null> {
  const [row] = await db
    .select({ reason: paymentEvents.reason })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.paymentId, paymentId),
        eq(paymentEvents.toStatus, "failed")
      )
    )
    .orderBy(desc(paymentEvents.createdAt))
    .limit(1);
  return row?.reason ?? null;
}

/** Apply one payment change to its order. Exported for the listener's own tests. */
export async function applyPaymentChange(
  db: Db,
  env: ShopEnv,
  change: OrderPaymentChange
): Promise<void> {
  const { payment, to } = change;
  const order = await getOrder(db, payment.referenceId);
  if (!order) {
    return;
  }
  const noSubmission = takesNoSubmission(payment as unknown as Payment);
  const holdHours = config.ecommerce.unpaidHoldHours;
  const system = { type: "system" } as const;

  if (order.status === "placed") {
    if (to === "submitted" || to === "successful") {
      await setOrderHold(db, { holdHours, kind: "untimed", orderId: order.id });
      if (to === "successful" && !noSubmission) {
        await moveOrder(db, env, {
          actor: system,
          note: "The payment was received.",
          orderId: order.id,
          to: "confirmed",
        });
      }
    } else if ((to === "failed" || to === "cancelled") && !noSubmission) {
      await setOrderHold(db, { holdHours, kind: "timed", orderId: order.id });
    }
    return;
  }

  if (order.status === "shipped" && to === "failed" && noSubmission) {
    const reason = await rejectReason(db, payment.id);
    const note = reason === null ? undefined : DELIVERY_REASONS[reason];
    if (note !== undefined) {
      await moveOrder(db, env, {
        actor: system,
        note,
        orderId: order.id,
        to: "returned",
      });
    }
  }
}

setOrderPaymentHandler(async (env, change) => {
  const shopEnv = env as ShopEnv;
  const scoped = currentAdminWrite()?.db ?? currentShopDb();
  if (scoped) {
    await applyPaymentChange(scoped, shopEnv, change);
    return;
  }
  await withDb(
    {
      env: env as DbBindings,
      executionCtx: {
        waitUntil: () => {
          // No request to keep alive. `withDb` closes the socket either way.
        },
      },
    },
    (db) => applyPaymentChange(db, shopEnv, change)
  );
});
