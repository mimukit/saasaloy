import { declare, zValidator } from "../contract";
import { createPayment, PaymentError, REJECT_REASONS } from "@repo/payment";
import type { PaymentEnv, PaymentStatus, RejectReason } from "@repo/payment";
import { adminGate, requireAdmin, withAuthScope } from "@repo/auth/server";
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
import type { PaymentView } from "../payment-store";
import { adminWrite } from "../lib/admin-write";
import type { AdminWriteScope } from "../lib/admin-write";
import type { Db } from "@repo/db/client";
import { paymentErrorStatus } from "./payment";
import type { PaymentBindings } from "./payment";

// The staff half of the payment capability, mounted at `/admin/payment` by this module's
// second `api.routes` row, so `get("/payments")` serves `GET /admin/payment/payments`
// and `hc<AppType>` types it for the admin app as `api.admin.payment.payments`. The mount
// is `/admin/payment` and not `/admin` because the route table keeps one row per path,
// and `admin` already routes `/admin`: a second `/admin` row would be dropped.
//
// Five routes: the queue, the review count, one payment, a review decision, and a refund.
// Every one lists `adminGate` first, before its validator, so a caller with no admin
// session gets a 401 and never a 400 that describes the input. The handler then reads the
// session again, through `requireAdmin` in `staff()` or `adminWrite` in `staffWrite()`,
// because it needs the actor's id. The admin app's root route denies a non-admin in the
// browser, and that is not the gate: it stops the SPA from asking, and this stops
// everyone else.
//
// The two writes run through `adminWrite` (`../lib/admin-write.ts`), so each writes one
// audit row with its change. Their actions are in `../audit/payment.ts`.
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
    reason: z.enum(REJECT_REASONS as [RejectReason, ...RejectReason[]]),
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
  .get(
    "/payments",
    declare({
      name: "admin_payments_list",
      description: "List payments for the admin console.",
      agent: { callable: false, reason: "Admin routes are never callable." },
    }),
    adminGate,
    validListQuery,
    (c) =>
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
  .get(
    "/review-count",
    declare({
      name: "admin_payments_review_count",
      description: "Count the payments that wait on a review.",
      agent: { callable: false, reason: "Admin routes are never callable." },
    }),
    adminGate,
    (c) =>
      staff(c, async ({ db }) => {
        const { submitted } = await countPayments(db);
        return c.json({ count: submitted }, 200);
      })
  )

  // One payment, with its event history and its refunds.
  .get(
    "/payments/:id",
    declare({
      name: "admin_payment_read",
      description: "Read one payment with its events.",
      agent: { callable: false, reason: "Admin routes are never callable." },
    }),
    adminGate,
    (c) =>
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

  // One decision. Both are conditional updates on `status = 'submitted'`, or on
  // `status = 'pending'` for a method that takes no submission (cash on delivery), so two
  // staff racing get one 200 and one 409. The decision, its event row and its audit row commit
  // together: `staffWrite` runs it inside `adminWrite`.
  .post(
    "/payments/:id/review",
    declare({
      name: "admin_payment_review",
      description: "Accept or reject a manual payment.",
      agent: { callable: false, reason: "Admin routes are never callable." },
    }),
    adminGate,
    validReviewBody,
    (c) =>
      staffWrite(c, async ({ db, actorUserId, audit }) => {
        const id = c.req.param("id");
        const body = c.req.valid("json");
        const before = await detailOrThrow(db, id);
        const client = createPayment(c.env as PaymentEnv);
        await (body.action === "confirm"
          ? client.confirm(id, { actorUserId, note: body.note ?? null })
          : client.reject(id, {
              actorUserId,
              note: body.note ?? null,
              reason: body.reason,
            }));
        const after = await detailOrThrow(db, id);
        audit({
          action:
            body.action === "confirm"
              ? "payment.review.confirm"
              : "payment.review.reject",
          after: {
            note: body.note ?? null,
            status: after.payment.status,
            ...(body.action === "reject" ? { reason: body.reason } : {}),
          },
          before: { status: before.payment.status },
          target: paymentTarget(after.payment),
        });
        return c.json(after, 200);
      })
  )

  // Record a refund. Only from `successful`, and the refunds never add up past `amount`.
  .post(
    "/payments/:id/refunds",
    declare({
      name: "admin_payment_refund",
      description: "Record a refund on a successful payment.",
      agent: { callable: false, reason: "Admin routes are never callable." },
    }),
    adminGate,
    validRefundBody,
    (c) =>
      staffWrite(c, async ({ db, actorUserId, audit }) => {
        const id = c.req.param("id");
        const body = c.req.valid("json");
        const before = await detailOrThrow(db, id);
        const { refund } = await createPayment(c.env as PaymentEnv).refund(id, {
          actorUserId,
          amount: body.amount,
          note: body.note ?? null,
        });
        const after = await detailOrThrow(db, id);
        audit({
          action: "payment.refund.create",
          after: {
            refund: { amount: refund.amount, id: refund.id, note: refund.note },
            refundedAmount: after.payment.refundedAmount,
          },
          before: { refundedAmount: before.payment.refundedAmount },
          target: paymentTarget(after.payment),
        });
        return c.json(after, 200);
      })
  );

async function detailOrThrow(db: Db, id: string) {
  const detail = await paymentDetail(db, id);
  if (!detail) {
    throw new PaymentError("not_found", `No payment with id "${id}".`);
  }
  return detail;
}

/** A payment as the audit log names it: its id, labelled with the reference staff see. */
function paymentTarget(payment: PaymentView) {
  return {
    id: payment.id,
    label: `${payment.referenceType} · ${payment.referenceId}`,
  };
}

/** A `PaymentError` as the api's `{ error: { code, message } }` envelope, or a rethrow. */
function answerPaymentError(c: AdminPaymentContext, error: unknown) {
  if (error instanceof PaymentError) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      paymentErrorStatus(error)
    );
  }
  throw error;
}

/**
 * The scope every staff read opens with: the admin check, this request's client, and the
 * store in scope for the core. A `PaymentError` becomes the api's
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
          return answerPaymentError(c, error);
        }
      })
    );
  });
}

/**
 * `staff` for a write. `adminWrite` runs the admin check and opens one transaction, and
 * the payment store is built over that transaction's `db`, so the core's payment update,
 * its `payment_events` or `payment_refunds` row and the audit row all go through it.
 * They commit together, and the 4xx a `PaymentError` becomes rolls every one of them
 * back.
 */
function staffWrite<T>(
  c: AdminPaymentContext,
  body: (scope: {
    db: Db;
    actorUserId: string;
    audit: AdminWriteScope["audit"];
  }) => Promise<T>
) {
  return adminWrite(c, ({ db, actor, audit }) =>
    withPaymentStore(createPaymentStore(db), async () => {
      try {
        return await body({ actorUserId: actor.id, audit, db });
      } catch (error) {
        return answerPaymentError(c, error);
      }
    })
  );
}
