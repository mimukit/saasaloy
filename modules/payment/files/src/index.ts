import { definePayment } from "./define";
import type { PaymentEnv } from "./provider";

export {
  checkReturnUrl,
  definePayment,
  normalize,
  selectProviders,
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

// The registration table, and the patch point for two kinds of module. Every
// `payment-<provider>` module appends its factory call to `providers`; a capability that
// reacts to a payment (a subscription renewal) appends a listener to `listeners`. The
// `plugin-array` patch is idempotent, and `saasaloy remove` takes the same line back out.
//
// An app adds its own listener here by hand, e.g. the rejection notice in the
// `saasaloy-payment` skill.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal for each property. The codemod behind the `plugin-array` patch
// kind has nothing to push into otherwise, and an install fails silently. Never omit an
// array, even while it is empty.
export const payment = definePayment({
  providers: [],
  listeners: [],
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
