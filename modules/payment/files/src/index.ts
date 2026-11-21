import { definePayment } from "./define";
import type { PaymentEnv } from "./provider";
import { paymentListeners } from "./listeners.generated";
import { paymentProviders } from "./providers.generated";

export {
  checkReturnUrl,
  definePayment,
  normalize,
  selectProviders,
  takesNoSubmission,
} from "./define";
export type {
  CallbackReply,
  CreatedPayment,
  ListedMethod,
  PaymentClient,
  PaymentConfig,
  PaymentRegistry,
  RejectInput,
  ReviewInput,
} from "./define";
export { PAYMENT_STATUSES, PaymentError, REJECT_REASONS } from "./provider";
export type {
  CallbackContext,
  CallbackResult,
  ConfirmResult,
  CreateInput,
  CreateResult,
  Payment,
  PaymentChange,
  PaymentEnv,
  PaymentErrorCode,
  PaymentErrorOptions,
  PaymentInstructions,
  PaymentListener,
  PaymentMethod,
  PaymentNext,
  PaymentOutcome,
  PaymentProvider,
  PaymentStatus,
  ProviderCreateInput,
  ProviderData,
  RefundInput,
  RefundResult,
  RejectReason,
  SubmitField,
  SubmitInput,
  SubmitResult,
} from "./provider";
export {
  inPaymentStore,
  setPaymentStoreResolver,
  setPaymentStoreRunner,
} from "./store";
export { paymentProviderEnv, setPaymentProviderEnv } from "./provider-env";
export type {
  NewPayment,
  PaymentEventRecord,
  PaymentEventRow,
  PaymentPatch,
  PaymentRefund,
  PaymentRefundRecord,
  PaymentStore,
  PaymentStoreRunner,
} from "./store";

// The registration table, for two kinds of module. Every `payment-<provider>` module adds
// a row to `payment.providers`; a capability that reacts to a payment (a subscription
// renewal) adds a listener row to `payment.listeners`. The CLI writes
// `./providers.generated.ts` and `./listeners.generated.ts` from those rows on every run,
// and `saasaloy remove` takes a row back out.
//
// An app adds its own listener here by hand, after the spread, e.g. the rejection notice
// in the `saasaloy-payment` skill. Never edit a generated file: the CLI overwrites it, and
// `saasaloy update` refuses when it was edited.
export const payment = definePayment({
  providers: [...paymentProviders],
  listeners: [...paymentListeners],
});

/**
 * Get a payment client for this request's environment. It takes the whole `env`, because
 * which key the active provider reads is exactly what a calling route must not know.
 *
 * ```ts
 * const { payment, next } = await createPayment(c.env).create({
 *   amount: 125000, currency: "BDT", method: "card",
 *   referenceType: "order", referenceId: order.id, userId: user.id,
 *   returnUrl: "https://shop.x.com/orders/" + order.id,
 * });
 * ```
 *
 * Throws when `PAYMENT_PROVIDER` is unset, empty, or names a provider that is not installed.
 */
export function createPayment(env: PaymentEnv) {
  return payment.create(env);
}
