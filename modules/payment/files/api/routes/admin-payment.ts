import { zValidator } from "@hono/zod-validator";
import { createPayment, PaymentError } from "@repo/payment";
import type { PaymentEnv, PaymentStatus } from "@repo/payment";
import { requireAdmin, withAuthScope } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import {
  countPayments,
  createPaymentStore,
  listPayments,
  paymentDetail,
  withPaymentStore,
} from "../payment-store";
import type { Db } from "@repo/db/client";
import { paymentErrorStatus } from "./payment";
import type { PaymentBindings } from "./payment";

// The staff half of the payment capability, mounted at `/admin/payment` by this module's
// second `chained-route` patch, so `get("/payments")` serves `GET /admin/payment/payments`
// and `hc<AppType>` types it for the admin app as `api.admin.payment.payments`. The mount
// is `/admin/payment` and not `/admin` because a `chained-route` patch matches on its path,
// and `admin` already routes `/admin`: a second `/admin` link would be skipped as present.
//
// Four routes: the queue, one payment, a review decision, and a refund. Every one opens
// with `requireAdmin`, on the server. The admin app's root route denies a non-admin in
// the browser, and that is not the gate: it stops the SPA from asking, and this stops
// everyone else. Same arrangement as `apps/api/src/routes/admin-users.ts`.
//
// Nothing here verifies a payment. Under a manual method the only witness is the staff
// member reading their own statement; the review only records what they decided.
//
// Route module contract: ONE chained expression under a NAMED export matching the file.

type AdminPaymentContext = Context<{ Bindings: PaymentBindings }>;

const STATUSES = [
  "pending",
  "submitted",
  "successful",
  "failed",
  "cancelled",
] as const satisfies readonly PaymentStatus[];

const listQuery = z.object({ status: z.enum(STATUSES).optional() });

const note = z.string().trim().max(1000).optional();

const reviewBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), note }),
  z.object({
    action: z.literal("reject"),
    note,
    reason: z.enum(["amount_mismatch", "not_found", "duplicate", "other"]),
  }),
]);

const refundBody = z.object({
  amount: z.number().int().positive(),
  note,
});

/** The api's error envelope for a rejected input, so `hc` sees one 400 shape. */
function issueMessage(
  issues: readonly { path: PropertyKey[]; message: string }[]
) {
  const [issue] = issues;
  return issue
    ? `${issue.path.map(String).join(".") || "input"}: ${issue.message}`
    : "invalid input";
}

const validListQuery = zValidator("query", listQuery, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: issueMessage(result.error.issues),
        },
      },
      400
    );
  }
});

const validReviewBody = zValidator("json", reviewBody, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: issueMessage(result.error.issues),
        },
      },
      400
    );
  }
});

const validRefundBody = zValidator("json", refundBody, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: issueMessage(result.error.issues),
        },
      },
      400
    );
  }
});

export const adminPayment = new Hono<{ Bindings: PaymentBindings }>()
  // The queue. The admin page opens on `?status=submitted`; no status lists every payment.
  .get("/payments", validListQuery, (c) =>
    staff(c, async ({ db }) => {
      const { status } = c.req.valid("query");
      const [payments, counts] = await Promise.all([
        listPayments(db, status),
        countPayments(db),
      ]);
      return c.json({ counts, payments }, 200);
    })
  )

  // The sidebar's live count on the Payments row: how many payments wait for a review.
  // The admin shell polls it through NAV_COUNTS, so it answers only `{ count }`.
  .get("/review-count", (c) =>
    staff(c, async ({ db }) => {
      const { submitted } = await countPayments(db);
      return c.json({ count: submitted }, 200);
    })
  )

  // One payment, with its event history and its refunds.
  .get("/payments/:id", (c) =>
    staff(c, async ({ db }) => {
      const detail = await paymentDetail(db, c.req.param("id"));
      if (!detail) {
        throw new PaymentError(
          "not_found",
          `No payment with id "${c.req.param("id")}".`
        );
      }
      return c.json(detail, 200);
    })
  )

  // One decision. Both are conditional updates on `status = 'submitted'`, so two staff
  // racing get one 200 and one 409.
  .post("/payments/:id/review", validReviewBody, (c) =>
    staff(c, async ({ db, actorUserId }) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const client = createPayment(c.env as PaymentEnv);
      await (body.action === "confirm"
        ? client.confirm(id, { actorUserId, note: body.note ?? null })
        : client.reject(id, {
            actorUserId,
            note: body.note ?? null,
            reason: body.reason,
          }));
      return c.json(await detailOrThrow(db, id), 200);
    })
  )

  // Record a refund. Only from `successful`, and the refunds never add up past `amount`.
  .post("/payments/:id/refunds", validRefundBody, (c) =>
    staff(c, async ({ db, actorUserId }) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      await createPayment(c.env as PaymentEnv).refund(id, {
        actorUserId,
        amount: body.amount,
        note: body.note ?? null,
      });
      return c.json(await detailOrThrow(db, id), 200);
    })
  );

async function detailOrThrow(db: Db, id: string) {
  const detail = await paymentDetail(db, id);
  if (!detail) {
    throw new PaymentError("not_found", `No payment with id "${id}".`);
  }
  return detail;
}

/**
 * The gate and the scope every staff route opens with: the admin check, this request's
 * client, and the store in scope for the core. A `PaymentError` becomes the api's
 * `{ error: { code, message } }` envelope here, because it is not an `HTTPException` and
 * `onError` would otherwise answer it with a bare 500.
 *
 * Generic in what the handler returns, so `hc` keeps each route's body type.
 */
function staff<T>(
  c: AdminPaymentContext,
  body: (scope: { db: Db; actorUserId: string }) => Promise<T>
) {
  return withAuthScope(c, async () => {
    // Throws 401 when nobody is signed in and 403 for any role but admin or superadmin.
    const session = await requireAdmin(c);

    return withDb(c, (db) =>
      withPaymentStore(createPaymentStore(db), async () => {
        try {
          return await body({ actorUserId: session.user.id, db });
        } catch (error) {
          if (error instanceof PaymentError) {
            return c.json(
              { error: { code: error.code, message: error.message } },
              paymentErrorStatus(error)
            );
          }
          throw error;
        }
      })
    );
  });
}
