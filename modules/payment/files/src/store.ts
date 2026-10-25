import type {
  Payment,
  PaymentStatus,
  ProviderData,
  RejectReason,
} from "./provider";

// The `PaymentStore` port, and the one indirection that lets the core reach it.
//
// `packages/payment` declares the port and never implements it: the core has zero npm
// runtime dependencies, so it cannot import `drizzle-orm` to write a query. `apps/api` is
// the one workspace that holds both the schema and the request's database client, so the
// SQL lives in `apps/api/src/payment-store.ts`, the same split `subscription` uses (ADR 0029).
//
// The port is reached through a resolver registered once at module load, not passed into
// `createPayment(env)`. That keeps the factory's signature `createPayment(env)` for every
// caller: a route that already opened a client puts the store in scope with
// `withPaymentStore`, and a caller that did not (an app's own shopper route, a listener of
// another capability) gets a client opened for the one call by the registered runner.
//
// The scope itself is an `AsyncLocalStorage` from `node:async_hooks`. Importing that here
// would force `"types": ["node"]` on every workspace that imports this package, so
// `apps/api/src/payment-store.ts` owns it and hands in a reader.

/** The values the core writes when it opens a payment. Status is always `pending`. */
export interface NewPayment {
  id: string;
  provider: string;
  method: string;
  amount: number;
  currency: string;
  referenceType: string;
  referenceId: string;
  userId: string | null;
  returnUrl: string | null;
}

/** The columns a status change or a provider answer may set besides `status`. */
export interface PaymentPatch {
  settledAmount?: number | null;
  claimedAmount?: number | null;
  transactionId?: string | null;
  transactionIdNormalized?: string | null;
  senderAccount?: string | null;
  providerData?: ProviderData | null;
  submittedAt?: Date | null;
  settledAt?: Date | null;
}

/** One `payment_events` row before it is written. */
export interface PaymentEventRecord {
  paymentId: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  actorUserId: string | null;
  reason: RejectReason | null;
  note: string | null;
}

/** One `payment_events` row. Append-only. */
export interface PaymentEventRow extends PaymentEventRecord {
  id: string;
  createdAt: Date;
}

/** One `payment_refunds` row before it is written. */
export interface PaymentRefundRecord {
  paymentId: string;
  amount: number;
  note: string | null;
  actorUserId: string | null;
  providerRefundId: string | null;
}

/** One `payment_refunds` row. */
export interface PaymentRefund extends PaymentRefundRecord {
  id: string;
  createdAt: Date;
}

/**
 * Everything the core asks of the database. Every write that a race could double is a
 * conditional update, so the database picks the winner and the loser reads nothing back.
 */
export interface PaymentStore {
  insertPayment(row: NewPayment): Promise<Payment>;
  findPayment(id: string): Promise<Payment | undefined>;
  /** Set columns without a status change. Used to keep a provider's `create` answer. */
  updatePayment(id: string, patch: PaymentPatch): Promise<Payment | undefined>;
  /**
   * Move a payment to `to` only while its status is one of `from`. Answers the new row,
   * or `undefined` when the status had already moved. Must throw
   * `PaymentError("duplicate_transaction")` when the write breaks the partial unique index
   * on `(provider, transaction_id_normalized)`.
   */
  transition(
    id: string,
    from: readonly PaymentStatus[],
    to: PaymentStatus,
    patch: PaymentPatch
  ): Promise<Payment | undefined>;
  appendEvent(record: PaymentEventRecord): Promise<void>;
  /**
   * Add `amount` to `refunded_amount` only while the payment is `successful` and the new
   * total stays at or below `amount`. Answers the new row, or `undefined` when either
   * check failed. This is the refund bound, and it holds under concurrent refunds.
   */
  reserveRefund(id: string, amount: number): Promise<Payment | undefined>;
  /** Undo a reservation after the provider refused the refund. */
  releaseRefund(id: string, amount: number): Promise<void>;
  insertRefund(record: PaymentRefundRecord): Promise<PaymentRefund>;
}

/** How the core opens a scope when the caller has none. See `setPaymentStoreRunner`. */
export type PaymentStoreRunner = <T>(
  body: (store: PaymentStore) => Promise<T>
) => Promise<T>;

let resolver: (() => PaymentStore | undefined) | undefined;
let runner: PaymentStoreRunner | undefined;

/**
 * Tell the core how to find the store for the work running now. `apps/api/src/payment-store.ts`
 * calls this at module load. A test calls it with a fake.
 */
export function setPaymentStoreResolver(
  read: () => PaymentStore | undefined
): void {
  resolver = read;
}

/**
 * Tell the core how to open a store when nothing is in scope. `apps/api/src/payment-store.ts`
 * calls this at module load with a runner over `withDb` and the importable Workers `env`.
 */
export function setPaymentStoreRunner(run: PaymentStoreRunner): void {
  runner = run;
}

/**
 * Run `body` with a store: the one in scope, or one the runner opens for this call. Every
 * client method goes through here.
 */
export function inPaymentStore<T>(
  body: (store: PaymentStore) => Promise<T>
): Promise<T> {
  const store = resolver?.();
  if (store) {
    return body(store);
  }
  if (!runner) {
    throw new Error(
      "No PaymentStore is in scope and no runner is registered. " +
        "`apps/api/src/payment-store.ts` registers both at module load; import it (or a route that imports it) " +
        "from the Worker entry, or wrap the caller in `withPaymentStore(createPaymentStore(db), ...)`."
    );
  }
  return runner(body);
}
