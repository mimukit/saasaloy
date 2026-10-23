import {
  PaymentError,
  setPaymentStoreResolver,
  setPaymentStoreRunner,
} from "@repo/payment";
import type {
  NewPayment,
  Payment,
  PaymentEventRecord,
  PaymentPatch,
  PaymentRefund,
  PaymentRefundRecord,
  PaymentStatus,
  PaymentStore,
  RejectReason,
} from "@repo/payment";
import type { Db, DbBindings } from "@repo/db/client";
import { withDb } from "@repo/db/client";
import { users } from "@repo/db/schema/auth";
import {
  paymentEvents,
  paymentRefunds,
  payments,
} from "@repo/db/schema/payment";
import { env } from "cloudflare:workers";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";

// The `PaymentStore` port over this request's Drizzle client, the scope the core reads it
// back out of, and the staff queue's own reads.
//
// `packages/payment` declares the port and never implements it: the core has zero npm
// runtime dependencies, so the SQL lives here, in the one workspace that holds both the
// schema and the request's client (ADR 0029). Every builder call below is the same under
// D1 and Postgres; the dialect reaches only the table files `modules/payment` ships twice
// under `onlyWith`.

const storeScope = new AsyncLocalStorage<PaymentStore>();

// Registered once, at module load. The payment routes import this file and
// `apps/api/src/index.ts` imports those routes, so the resolver is in place before the
// first request.
setPaymentStoreResolver(() => storeScope.getStore());

// The runner covers every caller that did not open a scope: an app's own shopper route
// that calls `createPayment(c.env).create(...)` directly, a listener, a queue job. It
// opens a client for the one call and closes it afterwards. `withDb` rather than `getDb`,
// because under `database-postgres` the call owns a real socket.
setPaymentStoreRunner((body) =>
  withDb(
    {
      env: env as unknown as DbBindings,
      executionCtx: {
        waitUntil: () => {
          // No request to keep alive. `withDb` closes the socket either way.
        },
      },
    },
    (db) => {
      const store = createPaymentStore(db);
      return withPaymentStore(store, () => body(store));
    }
  )
);

/** Run `body` with `store` in scope. Payment routes wrap their handler in this, inside `withDb`. */
export function withPaymentStore<T>(
  store: PaymentStore,
  body: () => Promise<T>
): Promise<T> {
  return storeScope.run(store, body);
}

/** Build the port over `db`. Call it inside `withDb`, and hand it to `withPaymentStore`. */
export function createPaymentStore(db: Db): PaymentStore {
  return {
    async appendEvent(record: PaymentEventRecord) {
      await db.insert(paymentEvents).values({
        ...record,
        createdAt: new Date(),
        id: crypto.randomUUID(),
      });
    },

    findPayment(id: string) {
      return db
        .select()
        .from(payments)
        .where(eq(payments.id, id))
        .limit(1)
        .then((rows) => (rows[0] ? toPayment(rows[0]) : undefined));
    },

    insertPayment(row: NewPayment) {
      const now = new Date();
      return db
        .insert(payments)
        .values({ ...row, createdAt: now, status: "pending", updatedAt: now })
        .returning()
        .then((rows) => toPayment(rows[0] as PaymentRow));
    },

    insertRefund(record: PaymentRefundRecord) {
      return db
        .insert(paymentRefunds)
        .values({ ...record, createdAt: new Date(), id: crypto.randomUUID() })
        .returning()
        .then((rows) => rows[0] as PaymentRefund);
    },

    async releaseRefund(id: string, amount: number) {
      await db
        .update(payments)
        .set({
          refundedAmount: sql`${payments.refundedAmount} - ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, id));
    },

    // The refund bound, as one conditional update. Two concurrent refunds cannot both pass
    // a read-then-write check: the database applies them one at a time, and the second sees
    // the first's total.
    reserveRefund(id: string, amount: number) {
      return db
        .update(payments)
        .set({
          refundedAmount: sql`${payments.refundedAmount} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payments.id, id),
            eq(payments.status, "successful"),
            sql`${payments.refundedAmount} + ${amount} <= ${payments.amount}`
          )
        )
        .returning()
        .then((rows) => (rows[0] ? toPayment(rows[0]) : undefined));
    },

    // The race guard. `status in (...)` is in the WHERE, so the database picks the winner
    // and the loser reads nothing back. The partial unique index runs here too, which is
    // why a duplicate transaction id is caught on the write and not by a read before it.
    async transition(
      id: string,
      from: readonly PaymentStatus[],
      to: PaymentStatus,
      patch: PaymentPatch
    ) {
      try {
        const rows = await db
          .update(payments)
          .set({ ...patch, status: to, updatedAt: new Date() })
          .where(and(eq(payments.id, id), inArray(payments.status, [...from])))
          .returning();
        return rows[0] ? toPayment(rows[0]) : undefined;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PaymentError(
            "duplicate_transaction",
            `Transaction id "${patch.transactionId ?? ""}" is already claimed by another payment. A rejected payment frees its id; otherwise check the id against your own record.`,
            { cause: error }
          );
        }
        throw error;
      }
    },

    updatePayment(id: string, patch: PaymentPatch) {
      return db
        .update(payments)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(payments.id, id))
        .returning()
        .then((rows) => (rows[0] ? toPayment(rows[0]) : undefined));
    },
  };
}

/** How many rows one staff list answers with. The queue is worked, not browsed. */
export const PAYMENT_LIST_LIMIT = 200;

/** One payment as the staff queue shows it. Dates travel as ISO strings. */
export interface PaymentView {
  id: string;
  provider: string;
  method: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  settledAmount: number | null;
  claimedAmount: number | null;
  refundedAmount: number;
  referenceType: string;
  referenceId: string;
  userId: string | null;
  userEmail: string | null;
  transactionId: string | null;
  senderAccount: string | null;
  /** The account the payer was told to pay, from a manual provider's instructions. */
  receivingAccount: ReceivingAccount | null;
  submittedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceivingAccount {
  label: string;
  number: string;
  name: string | null;
  kind: string | null;
}

export interface PaymentEventView {
  id: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  actorUserId: string | null;
  actorEmail: string | null;
  reason: RejectReason | null;
  note: string | null;
  createdAt: string;
}

export interface PaymentRefundView {
  id: string;
  amount: number;
  note: string | null;
  actorUserId: string | null;
  providerRefundId: string | null;
  createdAt: string;
}

// The payment tables keep a user id as `text`, while a project's `users.id` may be `text`
// or `uuid`. Postgres has no `uuid = text` operator, so every join casts the users side
// to text. `CAST(... AS TEXT)` rather than `::text`, because D1 runs this file too.
const userIdText = sql<string>`CAST(${users.id} AS TEXT)`;

/** The staff queue: one page of payments, newest first, oldest first for `submitted`. */
export async function listPayments(
  db: Db,
  status: PaymentStatus | undefined
): Promise<PaymentView[]> {
  const query = db
    .select({ payment: payments, userEmail: users.email })
    .from(payments)
    .leftJoin(users, eq(userIdText, payments.userId));
  const filtered =
    status === undefined ? query : query.where(eq(payments.status, status));
  // A queue is worked from the front: the payer who submitted first has waited longest
  // with money already sent.
  const rows = await filtered
    .orderBy(
      status === "submitted"
        ? asc(payments.createdAt)
        : desc(payments.createdAt)
    )
    .limit(PAYMENT_LIST_LIMIT);
  return rows.map((row) => toView(toPayment(row.payment), row.userEmail));
}

/** How many payments sit in each status. Every status is present, zero included. */
export async function countPayments(
  db: Db
): Promise<Record<PaymentStatus, number>> {
  const rows = await db
    .select({ status: payments.status, total: count() })
    .from(payments)
    .groupBy(payments.status);
  const counts: Record<PaymentStatus, number> = {
    cancelled: 0,
    failed: 0,
    pending: 0,
    submitted: 0,
    successful: 0,
  };
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as PaymentStatus] = Number(row.total);
    }
  }
  return counts;
}

/** One payment with its history and its refunds, or `undefined`. */
export async function paymentDetail(db: Db, id: string) {
  const found = await db
    .select({ payment: payments, userEmail: users.email })
    .from(payments)
    .leftJoin(users, eq(userIdText, payments.userId))
    .where(eq(payments.id, id))
    .limit(1);
  const [row] = found;
  if (!row) {
    return;
  }

  const events = await db
    .select({ actorEmail: users.email, event: paymentEvents })
    .from(paymentEvents)
    .leftJoin(users, eq(userIdText, paymentEvents.actorUserId))
    .where(eq(paymentEvents.paymentId, id))
    .orderBy(asc(paymentEvents.createdAt));

  const refunds = await db
    .select()
    .from(paymentRefunds)
    .where(eq(paymentRefunds.paymentId, id))
    .orderBy(asc(paymentRefunds.createdAt));

  return {
    events: events.map(({ actorEmail, event }): PaymentEventView => ({
      actorEmail: actorEmail ?? null,
      actorUserId: event.actorUserId,
      createdAt: event.createdAt.toISOString(),
      fromStatus: event.fromStatus as PaymentStatus | null,
      id: event.id,
      note: event.note,
      reason: event.reason as RejectReason | null,
      toStatus: event.toStatus as PaymentStatus,
    })),
    payment: toView(toPayment(row.payment), row.userEmail),
    refunds: refunds.map((refund): PaymentRefundView => ({
      actorUserId: refund.actorUserId,
      amount: refund.amount,
      createdAt: refund.createdAt.toISOString(),
      id: refund.id,
      note: refund.note,
      providerRefundId: refund.providerRefundId,
    })),
  };
}

type PaymentRow = typeof payments.$inferSelect;

function toPayment(row: PaymentRow): Payment {
  return {
    ...row,
    providerData: (row.providerData ?? null) as Payment["providerData"],
    status: row.status as PaymentStatus,
  };
}

function toView(payment: Payment, userEmail: string | null): PaymentView {
  return {
    amount: payment.amount,
    claimedAmount: payment.claimedAmount,
    createdAt: payment.createdAt.toISOString(),
    currency: payment.currency,
    id: payment.id,
    method: payment.method,
    provider: payment.provider,
    receivingAccount: receivingAccountOf(payment),
    referenceId: payment.referenceId,
    referenceType: payment.referenceType,
    refundedAmount: payment.refundedAmount,
    senderAccount: payment.senderAccount,
    settledAmount: payment.settledAmount,
    status: payment.status,
    submittedAt: payment.submittedAt?.toISOString() ?? null,
    settledAt: payment.settledAt?.toISOString() ?? null,
    transactionId: payment.transactionId,
    updatedAt: payment.updatedAt.toISOString(),
    userEmail: userEmail ?? null,
    userId: payment.userId,
  };
}

/** The account a manual provider told the payer to pay, kept by the core at `create`. */
function receivingAccountOf(payment: Payment): ReceivingAccount | null {
  const instructions = payment.providerData?.instructions as
    { account?: Record<string, unknown> } | undefined;
  const account = instructions?.account;
  if (
    !account ||
    typeof account.label !== "string" ||
    typeof account.number !== "string"
  ) {
    return null;
  }
  return {
    kind: typeof account.kind === "string" ? account.kind : null,
    label: account.label,
    name: typeof account.name === "string" ? account.name : null,
    number: account.number,
  };
}

/**
 * Whether a write broke a unique index. Postgres reports SQLSTATE 23505; D1 reports
 * `UNIQUE constraint failed`. Drizzle wraps the driver's error in its own, so walk the
 * `cause` chain. The query text Drizzle puts in its own message names the column, so the
 * check reads the driver's error, not that text.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const { code, message } = current as {
        code?: unknown;
        message?: unknown;
      };
      if (code === "23505") {
        return true;
      }
      if (
        typeof message === "string" &&
        (message.includes("UNIQUE constraint failed") ||
          message.includes("duplicate key value violates unique constraint"))
      ) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
    } else {
      return false;
    }
  }
  return false;
}
