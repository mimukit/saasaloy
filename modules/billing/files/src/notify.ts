import type { BillableSubject, Subscription } from "./provider";

// How the capability sends the three billing emails, and the indirection that keeps the
// core free of `@repo/email`. The sibling of `./store.ts` and `./enqueue.ts`.
//
// `packages/billing` has zero npm runtime dependencies and does not import another
// workspace's code, so it cannot call `createEmail(env)` — and it should not want to. Which
// provider sends, what `EMAIL_FROM` is and how a template renders are the email
// capability's business. The core decides *when* a notification is owed and *who* it is
// owed to; `apps/api/src/billing-store.ts` supplies the function that turns that into a
// message.
//
// Every one of these fires from a queue consumer or a scheduled job, never from a request
// handler. A route that sent the payment-failed email itself would send it again on every
// webhook redelivery, and would send nothing at all when the failure arrives while nobody
// is signed in — which is the normal case for a dunning email.

/** Which of the three billing emails is owed. */
export type BillingNotificationKind =
  /** Three days before a trial converts, once per subscription. */
  | "trial.ending"
  /** A charge was refused. Sent on every distinct failure event, not once per row. */
  | "payment.failed"
  /** The lockout job just set `lockedAt`, so the subject is back on the default plan. */
  | "account.locked";

/** Who a billing email goes to. `BillingStore.recipientFor` resolves it from the subject. */
export interface BillingRecipient {
  email: string;
  /** Display name, when the project has one. Templates fall back to the address. */
  name?: string | null;
}

/** One notification, as the core hands it over. */
export interface BillingNotification {
  kind: BillingNotificationKind;
  to: BillingRecipient;
  subject: BillableSubject;
  /** The row that occasioned it, so a template can name the plan and the dates. */
  subscription: Subscription;
}

/** What `apps/api` implements over `createEmail(env)` and the three templates. */
export type BillingNotifier = (
  notification: BillingNotification
) => Promise<void>;

let notifier: BillingNotifier | undefined;

/**
 * Tell `packages/billing` how to send a billing email.
 *
 * `apps/api/src/billing-store.ts` calls this at module load, next to
 * `setBillingStoreResolver` and `setBillingEnqueuer`. Calling it again replaces the
 * notifier, which is what a test wants and what nothing else should do.
 */
export function setBillingNotifier(send: BillingNotifier): void {
  notifier = send;
}

/**
 * Send one billing email, or throw naming what has to register the notifier.
 *
 * A throw rather than a silent drop, and deliberately inside the event's guarded body: the
 * consumer retries the delivery, so an unregistered notifier surfaces as a failing job with
 * an instruction in it instead of a dunning email nobody ever gets.
 */
export function notifyBilling(
  notification: BillingNotification
): Promise<void> {
  if (!notifier) {
    throw new Error(
      "No billing notifier is registered. `apps/api/src/billing-store.ts` calls " +
        "`setBillingNotifier` at module load; import it from the Worker entry so the " +
        "call has run before the first trial reminder or dunning email is owed."
    );
  }
  return notifier(notification);
}
