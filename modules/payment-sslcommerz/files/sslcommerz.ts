import { PaymentError } from "../provider";
import type {
  CallbackContext,
  CallbackResult,
  CreateResult,
  Payment,
  PaymentEnv,
  PaymentMethod,
  PaymentOutcome,
  PaymentProvider,
  ProviderCreateInput,
  RefundInput,
  RefundResult,
} from "../provider";

// SSLCOMMERZ, Bangladesh's main card and wallet aggregator, as a `payment` provider. One
// hosted checkout per payment, reached with `fetch` and `URLSearchParams`: no SDK, no npm
// dependency, and `packages/payment` stays at zero runtime dependencies (ADR 0020). The
// gateway has no subscription object, so under ADR 0045 it is a payment provider only.
//
// THE PAYMENT ID IS THE `tran_id`. The session is opened with the `payments` row id as the
// gateway's transaction id, so every answer the gateway gives names the row it is about,
// with no lookup table and no pending-checkout record.
//
// NOTHING ON THE WIRE IS EVIDENCE. The gateway reports a payment twice: an unauthenticated
// IPN POST, and a browser return the payer's own browser makes. `handleCallback` reads two
// fields off either, `val_id` and `tran_id`, and treats them as lookup keys. Every fact it
// acts on comes off the Order Validation API or the transaction query API, which it calls
// itself over TLS on a host it names. `verify_sign` is deliberately not checked: SSLCOMMERZ
// does not specify the hash input, and the validation call is the check it tells merchants
// to make. Whichever arrival lands second finds the payment already moved, and the core
// changes nothing.
//
// The gateway behaviour below (the endpoints, the `VALID`/`VALIDATED` pair, the failure
// set, the `PENDING` case, the strict comparison in minor units, and the rule that an
// unreachable gateway is never a failure) is ported from the gateway half of PR #169.

/** The value `PAYMENT_PROVIDER` lists to select this provider. */
const NAME = "sslcommerz";

/** The two published hosts, without a trailing slash. */
const SANDBOX_URL = "https://sandbox.sslcommerz.com";
const LIVE_URL = "https://securepay.sslcommerz.com";

/** Open a hosted session. */
const SESSION_PATH = "/gwprocess/v4/api.php";

/** The one endpoint that may be believed about money: "what is this `val_id` worth?". */
const VALIDATION_PATH = "/validator/api/validationserverAPI.php";

/** Query a transaction by `tran_id`, and initiate a refund by `bank_tran_id`. */
const MERCHANT_API_PATH = "/validator/api/merchantTransIDvalidationAPI.php";

/**
 * The only currency this provider takes. An SSLCOMMERZ store is provisioned for a currency
 * set, and a payment in anything else would be refused *after* the payer reached the hosted
 * page. Refusing it at `create` names the problem instead.
 */
const CURRENCY = "BDT";

/** The gateway's own word for "the session is open". Anything else is a refusal. */
const INIT_SUCCESS = "SUCCESS";

/**
 * `VALIDATED` IS `VALID`. SSLCOMMERZ answers `VALID` the first time a transaction is
 * validated and `VALIDATED` every time after, so the browser return that follows an IPN
 * reads `VALIDATED` for a payment that really did go through.
 */
const VALID_STATUSES = new Set(["VALID", "VALIDATED"]);

/** The gateway's words for "no money moved", and the status each one becomes. */
const CLOSED_STATUSES: Record<string, "failed" | "cancelled"> = {
  CANCELLED: "cancelled",
  EXPIRED: "failed",
  FAILED: "failed",
};

/** Still open at the gateway. Nothing is reported; a later callback asks again. */
const OPEN_STATUSES = new Set(["PENDING", "UNATTEMPTED"]);

/** The validator's answer to a `val_id` it never issued. A forged callback, not a payment. */
const INVALID_TRANSACTION = "INVALID_TRANSACTION";

/** What the gateway is told when the project cannot name the payer any better. */
const UNKNOWN_FIELD = "N/A";

/** The four callback paths the session registers, under `/payment/callback/sslcommerz/`. */
const IPN = "ipn";
const RETURN_SUCCESS = "return/success";
const RETURN_FAIL = "return/fail";
const RETURN_CANCEL = "return/cancel";

/** The session-open answer, in the fields this file reads. */
interface SessionResponse {
  status?: string;
  failedreason?: string;
  GatewayPageURL?: string;
  sessionkey?: string;
}

/**
 * One transaction as the gateway reports it, from the Order Validation API or one element
 * of a transaction query.
 *
 * `currency_type` and `currency_amount` are what the payer was charged, and they are the
 * pair compared against the row. `amount` and `store_amount` are the store's own currency:
 * the charge, and what lands in the merchant account after the gateway's cut.
 */
interface GatewayTransaction {
  status?: string;
  tran_id?: string;
  val_id?: string;
  amount?: string;
  store_amount?: string;
  currency_type?: string;
  currency_amount?: string;
  risk_level?: string;
  bank_tran_id?: string;
  error?: string;
}

/** The transaction query answer. */
interface QueryResponse {
  APIConnect?: string;
  no_of_trans_found?: number | string;
  element?: GatewayTransaction[];
}

/** The refund-initiate answer. */
interface RefundResponse {
  APIConnect?: string;
  bank_tran_id?: string;
  trans_id?: string;
  refund_ref_id?: string;
  status?: string;
  errorReason?: string;
}

/** The two callback fields this provider reads. Lookup keys, never statements. */
interface CallbackKeys {
  valId: string;
  tranId: string;
}

/**
 * The SSLCOMMERZ payment provider. Reads `SSLCOMMERZ_STORE_ID`,
 * `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_RECEIPT_EMAIL` and `SSLCOMMERZ_MODE` from the
 * Worker environment.
 */
export function sslcommerz(): PaymentProvider {
  return {
    name: NAME,

    methods(env: PaymentEnv): PaymentMethod[] {
      // Unconfigured is unavailable, so `create` answers `method_unavailable` with the
      // provider's name rather than failing at the gateway.
      const configured =
        text(env, "SSLCOMMERZ_STORE_ID") !== "" &&
        text(env, "SSLCOMMERZ_STORE_PASSWORD") !== "";
      return [{ available: configured, id: "card", label: "Card or wallet" }];
    },

    async create(
      env: PaymentEnv,
      input: ProviderCreateInput
    ): Promise<CreateResult> {
      const { payment } = input;
      if (payment.currency !== CURRENCY) {
        throw new PaymentError(
          "invalid_request",
          `sslcommerz takes ${CURRENCY} only; payment "${payment.id}" is in ${payment.currency}.`,
          { providerCode: "unsupported_currency" }
        );
      }

      const body = await getJson<SessionResponse>(
        `${hostOf(env)}${SESSION_PATH}`,
        "session",
        {
          body: sessionForm(env, input),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        }
      );
      const gatewayPage = body.GatewayPageURL?.trim();

      if (body.status !== INIT_SUCCESS || !gatewayPage) {
        // The gateway said no, and it said why. `failedreason` names the store and often
        // the credential that is wrong, so it belongs in the message a developer reads.
        throw new PaymentError(
          "provider_error",
          `sslcommerz refused to open a session: ${body.failedreason ?? body.status ?? "no reason given"}`,
          { providerCode: body.status ?? "no_status" }
        );
      }

      return {
        kind: "redirect",
        providerData: { sessionKey: body.sessionkey ?? null },
        url: gatewayPage,
      };
    },

    async refund(
      env: PaymentEnv,
      payment: Payment,
      input: RefundInput
    ): Promise<RefundResult> {
      const bankTranId = payment.providerData?.bankTranId;
      if (typeof bankTranId !== "string" || bankTranId === "") {
        throw new PaymentError(
          "invalid_request",
          `Payment "${payment.id}" carries no bank_tran_id, so sslcommerz cannot refund it. Refund it in the SSLCOMMERZ merchant panel.`,
          { providerCode: "no_bank_tran_id" }
        );
      }

      const query = credentials(env);
      query.set("bank_tran_id", bankTranId);
      query.set("refund_amount", major(input.amount));
      query.set("refund_remarks", input.note?.trim() || "Refund");
      // The merchant's own id for this refund, which newer API versions require.
      query.set("refund_trans_id", crypto.randomUUID().replaceAll("-", ""));
      query.set("refe_id", payment.id);

      const body = await getJson<RefundResponse>(
        `${hostOf(env)}${MERCHANT_API_PATH}?${query.toString()}`,
        "refund",
        { method: "GET" }
      );

      if (body.APIConnect !== "DONE") {
        throw new PaymentError(
          "provider_error",
          `sslcommerz did not take the refund request: ${body.APIConnect ?? "no APIConnect"}`,
          { providerCode: body.APIConnect ?? "no_api_connect" }
        );
      }

      const status = body.status?.trim().toLowerCase();
      if (status === "success" || status === "processing") {
        return { providerRefundId: body.refund_ref_id ?? null };
      }
      throw new PaymentError(
        "declined",
        `sslcommerz declined the refund: ${body.errorReason ?? status ?? "no reason given"}`,
        { providerCode: status ?? "no_status" }
      );
    },

    /**
     * One callback, on any of the four URLs the session registered.
     *
     * `ipn` is the gateway's server-to-server notification and answers an event. The three
     * returns are the payer's own browser: each verifies the same way, so a lost IPN is
     * closed by the browser return, and then sends the browser to the payment's
     * `returnUrl`, which the core checked against PAYMENT_APP_URL at `create`.
     */
    async handleCallback(
      env: PaymentEnv,
      request: Request,
      path: string,
      ctx: CallbackContext
    ): Promise<CallbackResult> {
      const route = path.replaceAll(/^\/+|\/+$/g, "");
      if (
        route !== IPN &&
        route !== RETURN_SUCCESS &&
        route !== RETURN_FAIL &&
        route !== RETURN_CANCEL
      ) {
        return { kind: "ignored" };
      }

      const keys = await readKeys(request);
      const payment = keys.tranId ? await ctx.payment(keys.tranId) : undefined;
      if (keys.tranId && (!payment || payment.provider !== NAME)) {
        throw new PaymentError(
          "callback_invalid",
          `sslcommerz reported on tran_id "${keys.tranId}", which is no sslcommerz payment here.`,
          { providerCode: "unknown_tran_id" }
        );
      }

      const outcome = await verify(env, keys, payment, ctx);

      if (route === IPN) {
        return outcome ? { kind: "event", outcome } : { kind: "ignored" };
      }

      const returning = await ctx.payment(outcome?.paymentId ?? keys.tranId);
      const target = returning?.returnUrl;
      if (target) {
        return outcome
          ? { kind: "redirect", outcome, url: target }
          : { kind: "redirect", url: target };
      }
      // No return URL to send the browser to. The row holds the real status.
      const response = page(
        "Back from the gateway",
        "The gateway handed your payment back. You can close this tab."
      );
      return outcome
        ? { kind: "response", outcome, response }
        : { kind: "response", response };
    },
  };
}

/**
 * What the gateway says about the transaction a callback names, as an outcome, or nothing
 * when the gateway has not decided yet.
 *
 * A `val_id` goes to the Order Validation API. Without one (a failed or cancelled IPN, or a
 * fail or cancel return) the `tran_id` goes to the transaction query API. A callback with
 * neither has nothing to ask about.
 */
async function verify(
  env: PaymentEnv,
  keys: CallbackKeys,
  posted: Payment | undefined,
  ctx: CallbackContext
): Promise<PaymentOutcome | undefined> {
  let answer: GatewayTransaction | undefined;

  if (keys.valId) {
    answer = await validate(env, keys.valId);
    const status = upper(answer.status);
    if (status === INVALID_TRANSACTION || answer.error) {
      throw new PaymentError(
        "callback_invalid",
        `sslcommerz does not recognise val_id "${keys.valId}": ${answer.error ?? status}`,
        { providerCode: status || "invalid_val_id" }
      );
    }
  } else if (keys.tranId) {
    answer = await queryTransaction(env, keys.tranId);
  }

  if (!answer) {
    return undefined;
  }

  const tranId = answer.tran_id?.trim() ?? "";
  if (keys.tranId && tranId !== keys.tranId) {
    throw new PaymentError(
      "callback_invalid",
      `The callback named tran_id "${keys.tranId}" but the gateway validated "${tranId || "(none)"}".`,
      { providerCode: "tran_id_mismatch" }
    );
  }
  const payment = posted ?? (tranId ? await ctx.payment(tranId) : undefined);
  if (!payment || payment.provider !== NAME) {
    throw new PaymentError(
      "callback_invalid",
      `sslcommerz validated tran_id "${tranId || "(none)"}", which is no sslcommerz payment here.`,
      { providerCode: "unknown_tran_id" }
    );
  }

  const status = upper(answer.status);

  if (VALID_STATUSES.has(status)) {
    const mismatch = mismatchIn(answer, payment);
    if (mismatch) {
      throw new PaymentError(
        "callback_invalid",
        `sslcommerz answered ${status} for payment "${payment.id}" but ${mismatch}`,
        { providerCode: "mismatch" }
      );
    }
    const bankTranId = answer.bank_tran_id?.trim() || null;
    return {
      paymentId: payment.id,
      providerData: {
        bankTranId,
        riskLevel: answer.risk_level ?? null,
        storeAmount: answer.store_amount ?? null,
        valId: answer.val_id ?? null,
      },
      settledAmount: minor(answer.currency_amount),
      status: "successful",
      ...(bankTranId
        ? { transactionId: bankTranId, transactionIdNormalized: bankTranId }
        : {}),
    };
  }

  const closed = CLOSED_STATUSES[status];
  if (closed) {
    return {
      paymentId: payment.id,
      providerData: { gatewayStatus: status },
      status: closed,
    };
  }

  if (OPEN_STATUSES.has(status)) {
    return undefined;
  }

  // A word this file has not read is a gap in the lists above, not a failed payment.
  throw new PaymentError(
    "provider_error",
    `sslcommerz answered a status this provider does not recognise: ${status || "(none)"}`,
    { providerCode: status || "no_status" }
  );
}

/**
 * Why a validated answer does not describe the stored payment, or null when it does.
 *
 * The amount is compared in **minor units**. The gateway writes `499.00`, `499.0` and `499`
 * for the same figure, so a string comparison would refuse a correct payment. Nothing is
 * rounded towards agreement: a payment short by one poisha is one this provider cannot
 * explain.
 */
function mismatchIn(
  answer: GatewayTransaction,
  payment: Payment
): string | null {
  const currency = upper(answer.currency_type);
  if (currency !== payment.currency) {
    return `the gateway charged in ${currency || "(none)"}, not ${payment.currency}.`;
  }
  const charged = minor(answer.currency_amount);
  if (charged !== payment.amount) {
    return `the gateway charged ${major(charged)}, not the ${major(payment.amount)} the payment is for.`;
  }
  return null;
}

/**
 * The session-open form, field for field as SSLCOMMERZ v4 names them.
 *
 * `shipping_method` is `NO` and `num_of_item` is 1. A payment is one figure against one app
 * record; a shipping method would make the gateway demand an address it has no use for.
 */
function sessionForm(
  env: PaymentEnv,
  input: ProviderCreateInput
): URLSearchParams {
  const { payment } = input;
  return new URLSearchParams({
    cancel_url: input.callbackUrl(RETURN_CANCEL),
    // The gateway insists on these. A provider is handed an opaque reference and never
    // learns the payer's address, so nothing here tries to look one up.
    cus_add1: UNKNOWN_FIELD,
    cus_city: UNKNOWN_FIELD,
    cus_country: "Bangladesh",
    cus_email: required(env, "SSLCOMMERZ_RECEIPT_EMAIL"),
    cus_name: payment.userId ?? UNKNOWN_FIELD,
    cus_phone: UNKNOWN_FIELD,
    currency: payment.currency,
    fail_url: input.callbackUrl(RETURN_FAIL),
    ipn_url: input.callbackUrl(IPN),
    num_of_item: "1",
    product_category: payment.referenceType,
    product_name: `${payment.referenceType} ${payment.referenceId}`,
    product_profile: "non-physical-goods",
    shipping_method: "NO",
    store_id: required(env, "SSLCOMMERZ_STORE_ID"),
    store_passwd: required(env, "SSLCOMMERZ_STORE_PASSWORD"),
    success_url: input.callbackUrl(RETURN_SUCCESS),
    // Major units with two decimals, the only form the gateway accepts.
    total_amount: major(payment.amount),
    tran_id: payment.id,
  });
}

/** Ask the gateway what a `val_id` is worth. */
async function validate(
  env: PaymentEnv,
  valId: string
): Promise<GatewayTransaction> {
  const query = credentials(env);
  query.set("val_id", valId);
  return await getJson<GatewayTransaction>(
    `${hostOf(env)}${VALIDATION_PATH}?${query.toString()}`,
    "validation",
    { method: "GET" }
  );
}

/**
 * Ask the gateway about a `tran_id`. A transaction can carry several attempts; a valid one
 * wins, then the latest closed one. No element at all means nothing to report.
 */
async function queryTransaction(
  env: PaymentEnv,
  tranId: string
): Promise<GatewayTransaction | undefined> {
  const query = credentials(env);
  query.set("tran_id", tranId);
  const body = await getJson<QueryResponse>(
    `${hostOf(env)}${MERCHANT_API_PATH}?${query.toString()}`,
    "transaction query",
    { method: "GET" }
  );
  if (body.APIConnect !== undefined && body.APIConnect !== "DONE") {
    throw new PaymentError(
      "provider_error",
      `sslcommerz did not answer the transaction query: ${body.APIConnect}`,
      { providerCode: body.APIConnect, retryable: true }
    );
  }
  const elements = body.element ?? [];
  return (
    elements.find((e) => VALID_STATUSES.has(upper(e.status))) ?? elements.at(-1)
  );
}

/**
 * One request against the gateway, as JSON.
 *
 * **Not being able to ask is not an answer.** Every failure here throws `provider_error`
 * with `retryable: true` rather than settling anything: a validation call that timed out
 * says nothing about whether the payment went through. The callback route answers 502, and
 * the gateway retries its IPN.
 */
async function getJson<Body>(
  url: string,
  what: string,
  init: RequestInit
): Promise<Body> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new PaymentError(
      "provider_error",
      `sslcommerz: the ${what} request did not complete`,
      { cause: error, providerCode: "unreachable", retryable: true }
    );
  }

  const body = await response.text();
  if (!response.ok) {
    throw new PaymentError(
      "provider_error",
      `sslcommerz answered HTTP ${String(response.status)} to the ${what} request`,
      { providerCode: `http_${String(response.status)}`, retryable: true }
    );
  }

  try {
    return JSON.parse(body) as Body;
  } catch (error) {
    throw new PaymentError(
      "provider_error",
      `sslcommerz answered the ${what} request with something that is not JSON`,
      { cause: error, providerCode: "unreadable", retryable: true }
    );
  }
}

/**
 * `val_id` and `tran_id` off a callback, whatever shape it arrived in. Form-encoded is
 * what the gateway sends; a query string is accepted too, because some return
 * configurations append the fields there.
 */
async function readKeys(request: Request): Promise<CallbackKeys> {
  const query = new URL(request.url).searchParams;
  let form: FormData | undefined;
  if (request.method === "POST") {
    try {
      form = await request.formData();
    } catch {
      // An empty body, or a content type the runtime cannot parse as a form.
      form = undefined;
    }
  }
  const field = (key: string): string => {
    const value = form?.get(key) ?? query.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  return { tranId: field("tran_id"), valId: field("val_id") };
}

/**
 * The host for this env. Only the exact string `live` selects the live gateway, so a
 * deploy that never set the key sends test payments to the sandbox.
 */
function hostOf(env: PaymentEnv): string {
  return text(env, "SSLCOMMERZ_MODE") === "live" ? LIVE_URL : SANDBOX_URL;
}

/** The store credentials and the JSON format flag every merchant API call carries. */
function credentials(env: PaymentEnv): URLSearchParams {
  return new URLSearchParams({
    format: "json",
    store_id: required(env, "SSLCOMMERZ_STORE_ID"),
    store_passwd: required(env, "SSLCOMMERZ_STORE_PASSWORD"),
  });
}

/** A required env value, or a refusal naming the key that is unset. */
function required(env: PaymentEnv, key: string): string {
  const value = text(env, key);
  if (!value) {
    throw new PaymentError(
      "provider_error",
      `sslcommerz is not configured here: ${key} is unset. Set it with saasaloy env and pnpm env:setup for local development, and with \`wrangler secret put ${key}\` for a deployed Worker.`,
      { providerCode: "unconfigured" }
    );
  }
  return value;
}

function text(env: PaymentEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function upper(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

/** `49900` → `"499.00"`. The only form the gateway accepts a figure in. */
function major(amount: number): string {
  return (amount / 100).toFixed(2);
}

/** `"499.00"` → `49900`. Rounded, never truncated. A missing figure is NaN, never zero. */
function minor(amount: string | undefined): number {
  return Math.round(Number(amount ?? Number.NaN) * 100);
}

function page(title: string, message: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body><h1>${title}</h1><p>${message}</p></body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 }
  );
}
