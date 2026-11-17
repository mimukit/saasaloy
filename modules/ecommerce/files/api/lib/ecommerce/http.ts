import { isEcommerceError } from "@repo/ecommerce";
import type { EcommerceErrorCode } from "@repo/ecommerce";
import { PaymentError } from "@repo/payment";
import { errorBody } from "@repo/validators/common";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// The shop routes' error envelope. A repository throws `EcommerceError` and the payment
// core throws `PaymentError`; neither is an `HTTPException`, so the api's `onError` would
// answer both with a bare 500. `shopError` turns each into the api's
// `{ error: { code, message } }` with a status per code, and rethrows anything else.

/** Every ecommerce code on HTTP. */
const ECOMMERCE_STATUS: Record<EcommerceErrorCode, ContentfulStatusCode> = {
  conflict: 409,
  currency_mismatch: 409,
  empty_order: 400,
  invalid_amount: 400,
  invalid_currency: 400,
  invalid_quantity: 400,
  invalid_transition: 409,
  no_active_variant: 409,
  no_store_price: 409,
  not_for_sale: 409,
  not_found: 404,
  out_of_stock: 409,
};

/** The payment core's codes on HTTP, as `routes/payment.ts` maps them. */
const PAYMENT_STATUS: Record<string, ContentfulStatusCode> = {
  callback_invalid: 400,
  conflict: 409,
  declined: 502,
  duplicate_transaction: 409,
  invalid_request: 400,
  method_unavailable: 400,
  not_found: 404,
  provider_error: 502,
  rate_limited: 429,
};

/** An ecommerce or payment error as the envelope, or a rethrow. */
export function shopError(c: Context, error: unknown): Response {
  if (isEcommerceError(error)) {
    return c.json(
      errorBody(error.code, error.message),
      ECOMMERCE_STATUS[error.code]
    );
  }
  if (error instanceof PaymentError) {
    return c.json(
      errorBody(error.code, error.message),
      PAYMENT_STATUS[error.code] ?? 400
    );
  }
  throw error;
}

/** What a Zod failure carries, structurally, so one hook takes every schema's error. */
interface Issues {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}

/** The `zValidator` failure hook: a 400 `invalid_input` naming the first issue. */
export function invalidInput(
  result: { success: boolean; error?: Issues },
  c: Context
) {
  if (!result.success && result.error) {
    const [issue] = result.error.issues;
    const message = issue
      ? `${issue.path.map(String).join(".") || "input"}: ${issue.message}`
      : "invalid input";
    return c.json(errorBody("invalid_input", message), 400);
  }
}
