import { findPlan } from "../define";
import { plans } from "../plans";
import { BillingError } from "../provider";
import type {
  BillableSubject,
  BillingEnv,
  BillingEvent,
  BillingProvider,
  CallbackResult,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  Plan,
  PlanInterval,
  PortalInput,
  QuantityInput,
  SubjectInput,
  Subscription,
  SubscriptionInput,
} from "../provider";

// SSLCOMMERZ, Bangladesh's main aggregator gateway, as a `billing` provider. One hosted
// checkout per period, reached with `fetch` and `URLSearchParams`: no SDK, no npm
// dependency, and `packages/billing` stays at zero runtime dependencies (ADR 0020).
//
// THE GATEWAY HAS NO SUBSCRIPTION. The v4 API opens a session, validates a payment, queries
// a transaction and refunds one. There is no recurring object, no stored card this project
// may charge, and no merchant-initiated charge in the public documentation. So a
// subscription here is a sequence of one-off payments the subject makes, one per period.
// This provider declares `renewal: "manual"`, and `billing.renewal-due` marks a row
// `past_due` when its period runs out so the subject is asked to pay for the next one
// (ADR 0039, and CONTEXT.md → "Manual renewal").
//
// TWO ARRIVALS, ONE ANSWER. The gateway reports a payment twice: an unauthenticated IPN
// POST, and a browser return the subject's own browser makes. Both run the same validation
// call and both mint the same event under the same `val_id`, so whichever lands second
// conflicts on the `billing_events` primary key and runs no side effect twice. That is what
// closes a lost IPN without a reconciliation job.
//
// NOTHING ON THE WIRE IS EVIDENCE. `handleCallback` reads one field off the callback body —
// `val_id` — and treats it as a lookup key, never as a statement. Every fact this file acts
// on comes off the Order Validation response, which it fetches itself over TLS from a host
// it names. `verify_sign` is deliberately not checked: SSLCOMMERZ does not specify the hash
// input, and the validation call is the stronger check it tells merchants to make.
//
// The gateway behaviour below — the endpoints, the `VALID`/`VALIDATED` pair, the failure
// set, the `PENDING` case, the strict comparison in minor units and the rule that an
// unreachable gateway is never a failure — is ported from a working integration against the
// live gateway.

/** The value `BILLING_PROVIDER` must hold for this provider to be selected. */
const PROVIDER_NAME = "sslcommerz";

/** Everything this provider mints carries this prefix, so its rows are obvious in a query. */
const PREFIX = "sslcz_";

/** The two published hosts, without a trailing slash. */
const SANDBOX_URL = "https://sandbox.sslcommerz.com";
const LIVE_URL = "https://securepay.sslcommerz.com";

/** Open a hosted session. */
const SESSION_PATH = "/gwprocess/v4/api.php";

/** The one endpoint that may be believed about money: "what is this `val_id` worth?". */
const VALIDATION_PATH = "/validator/api/validationserverAPI.php";

/**
 * The only currency this provider takes.
 *
 * An SSLCOMMERZ store is provisioned for a currency set, and a plan priced in anything else
 * would be refused by the gateway *after* the subject had been sent to the hosted page.
 * Refusing it at checkout names the plan instead. Widening this to a configurable list later
 * is additive and breaks nothing.
 */
const CURRENCY = "BDT";

/** The gateway's own word for "the session is open". Anything else is a refusal. */
const INIT_SUCCESS = "SUCCESS";

/**
 * `VALIDATED` IS `VALID`. SSLCOMMERZ answers `VALID` the first time a transaction is
 * validated and `VALIDATED` every time after, so the browser return that follows an IPN
 * reads `VALIDATED` for a payment that really did go through.
 *
 * The failure set is the gateway's whole vocabulary for "no money moved". It is kept apart
 * from the unknown case on purpose: a status this file does not recognise is a gap in this
 * list, not a failed payment, and mapping it to one would fail a charge nobody read.
 */
const VALID_STATUSES = new Set(["VALID", "VALIDATED"]);
const FAILED_STATUSES = new Set([
  "FAILED",
  "CANCELLED",
  "UNATTEMPTED",
  "EXPIRED",
  "INVALID_TRANSACTION",
]);

/** Still in flight. Nothing is minted; the browser return or a later IPN asks again. */
const PENDING_STATUS = "PENDING";

/** Fixed session fields. A subscription is one figure against one plan, not a cart. */
const PRODUCT_CATEGORY = "subscription";
const PRODUCT_PROFILE = "non-physical-goods";
const COUNTRY = "Bangladesh";

/** What the gateway is told when the project cannot name the subject any better. */
const UNKNOWN_FIELD = "N/A";

/** Days in each interval. The same figures `billing-console` uses. */
const INTERVAL_DAYS: Record<PlanInterval, number> = {
  monthly: 30,
  yearly: 365,
};

/** The session-open answer, in the fields this file reads. The rest is stored, not read. */
interface SessionResponse {
  status?: string;
  failedreason?: string;
  GatewayPageURL?: string;
}

/**
 * The Order Validation answer, in the fields this file judges on.
 *
 * `amount` and `store_amount` are the store's own currency: what the subject was charged,
 * and what lands in the merchant account after the gateway's cut. `currency_type` and
 * `currency_amount` are what the instrument was charged, which is the pair compared below —
 * a card in another currency answers a `currency_type` this plan is not priced in, and that
 * is a mismatch rather than a conversion this file is willing to guess at.
 *
 * `value_a`–`value_d` are the fields the session put the subject and the plan in. The v4
 * docs return them on this response, which is what lets a callback be read with no lookup
 * table and no pending-checkout record.
 */
interface ValidationResponse {
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
  value_a?: string;
  value_b?: string;
  value_c?: string;
}

/** What a validated answer turned out to be about. Read off the answer, never off the POST. */
interface CheckoutIntent {
  subject: BillableSubject;
  plan: Plan;
  interval: PlanInterval;
  /** Days carried over from a period the subject had already paid for. See `changePlan`. */
  carriedDays: number;
}

export function sslcommerzBilling(): BillingProvider {
  return {
    cancel(
      _env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      // There is no subscription at the gateway to tell, so the event is minted from the row
      // the route read — the arrangement `billing-console` uses, and for the same reason.
      const current = carried(input);
      return Promise.resolve({
        event: event("subscription.changed", input.subject, {
          ...current,
          cancelAt: current.periodEnd ?? null,
          cancelAtPeriodEnd: true,
        }),
        url: "",
      });
    },

    async changePlan(
      env: BillingEnv,
      _ctx: HostContext,
      input: ChangePlanInput
    ): Promise<CheckoutResult> {
      // Full price for the new plan, and the days left on the old period are added to the
      // new one. There is no proration primitive at the gateway and no credit concept in the
      // core, so this is the cheapest answer that takes nothing from the subject.
      return await openCheckout(
        env,
        input,
        daysLeft(input.current, new Date())
      );
    },

    async createCheckout(
      env: BillingEnv,
      _ctx: HostContext,
      input: CheckoutInput
    ): Promise<CheckoutResult> {
      return await openCheckout(env, input, 0);
    },

    // No vendor portal exists, so the caller goes straight back where it came from.
    // Answering with a fabricated url would send a browser somewhere that is not there.
    createPortal(
      _env: BillingEnv,
      _ctx: HostContext,
      input: PortalInput
    ): Promise<{ url: string }> {
      return Promise.resolve({ url: input.returnUrl });
    },

    /**
     * One callback, on any of the four URLs the session registered.
     *
     * `ipn` is the gateway's server-to-server notification and owes an event. The three
     * returns are the subject's own browser and owe a place to land; `return/success`
     * additionally runs the same validation call, which is what makes it close a lost IPN.
     *
     * Every return goes back to `BILLING_APP_URL` with one query flag, rather than to a URL
     * carried through the gateway. `value_a`–`value_d` are capped at 255 characters each and
     * three of them are already carrying the subject and the plan, and a redirect target
     * that travelled through an unauthenticated callback would be an open redirect besides.
     */
    async handleCallback(
      env: BillingEnv,
      request: Request,
      path: string
    ): Promise<CallbackResult> {
      const route = path.replaceAll(/^\/+|\/+$/g, "");

      if (route === "return/fail") {
        return { kind: "redirect", url: appUrl(env, "failed") };
      }
      if (route === "return/cancel") {
        return { kind: "redirect", url: appUrl(env, "canceled") };
      }
      if (route !== "ipn" && route !== "return/success") {
        return { kind: "ignored" };
      }

      const valId = await readValId(request);
      if (!valId) {
        // Nothing to ask the gateway about. On the browser path the subject still has to
        // land somewhere, so they land on the billing page and read the row's real status.
        return route === "ipn"
          ? { kind: "ignored" }
          : { kind: "redirect", url: appUrl(env, "pending") };
      }

      const body = await validate(env, valId);
      const minted = eventFor(body, valId);

      if (route === "ipn") {
        return minted ? { event: minted, kind: "event" } : { kind: "ignored" };
      }

      return {
        kind: "redirect",
        url: appUrl(env, minted?.type === "payment.failed" ? "failed" : "paid"),
        ...(minted === undefined ? {} : { event: minted }),
      };
    },

    // The gateway issues no invoice list. An empty list rather than a throw: the admin
    // page's invoice section renders empty, which is the honest answer.
    listInvoices(): Promise<Invoice[]> {
      return Promise.resolve([]);
    },

    name: PROVIDER_NAME,

    /**
     * Nothing recurs on its own here. `billing.renewal-due` marks a row `past_due` when its
     * period ends, and the subject pays for the next one through `POST /billing/renew`.
     */
    renewal: "manual",

    restore(
      _env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      return Promise.resolve({
        event: event("subscription.changed", input.subject, {
          ...carried(input),
          cancelAt: null,
          cancelAtPeriodEnd: false,
        }),
        url: "",
      });
    },

    setQuantity(
      _env: BillingEnv,
      _ctx: HostContext,
      input: QuantityInput
    ): Promise<void> {
      if (input.seats < 1) {
        throw new BillingError(
          "invalid_request",
          `A subscription needs at least one seat; got ${input.seats}.`,
          { providerCode: "invalid_seats" }
        );
      }
      // Seats are a follow-up issue everywhere, and nothing reads the column yet.
      return Promise.resolve();
    },
  };
}

/**
 * Open one hosted session, or mint a trial and call no gateway at all.
 *
 * Shared by `createCheckout` and `changePlan`, which differ only in the days they carry
 * over from a period the subject has already paid for.
 */
async function openCheckout(
  env: BillingEnv,
  input: CheckoutInput | ChangePlanInput,
  carriedDays: number
): Promise<CheckoutResult> {
  const plan = findPlan(plans, input.planId);
  const now = new Date();

  // A trial takes no money, and a gateway that only knows how to take money has nothing to
  // do with one. The row is minted here and delivered through the event, exactly as
  // `billing-console` does it, so a project can run a trial with no merchant account at all.
  if (plan.trialDays) {
    return {
      event: event(
        "subscription.changed",
        input.subject,
        trialing(plan, input.interval, now, input.subject)
      ),
      url: input.successUrl,
    };
  }

  const price = priceFor(plan, input.interval);
  const tranId = `${PREFIX}${crypto.randomUUID()}`;
  const form = sessionForm(env, input, plan, price, tranId, carriedDays);
  const body = await postSession(`${hostOf(env)}${SESSION_PATH}`, form);
  const page = body.GatewayPageURL?.trim();

  if (body.status !== INIT_SUCCESS || !page) {
    // The gateway said no, and it said why. `failedreason` names the store and often the
    // credential that is wrong, so it belongs in the message a developer reads.
    throw new BillingError(
      "provider_error",
      `sslcommerz refused to open a session: ${body.failedreason ?? body.status ?? "no reason given"}`,
      { providerCode: body.status ?? "no_status" }
    );
  }

  // No event. The money has not moved yet, and the validated callback is what says it did.
  return { url: page };
}

/**
 * The session-open form, field for field as SSLCOMMERZ v4 names them.
 *
 * `value_a` carries the subject, `value_b` the plan and interval, `value_c` the carried
 * days. All three come back on the Order Validation response, which is what lets a callback
 * be read with no lookup table and no pending-checkout row — and they are read off the
 * *validated* answer, never off the POST that arrived.
 *
 * `shipping_method` is `NO` and `num_of_item` is 1. A subscription is one figure against one
 * plan; declaring a shipping method would make the gateway demand an address it has no use
 * for.
 */
function sessionForm(
  env: BillingEnv,
  input: CheckoutInput | ChangePlanInput,
  plan: Plan,
  price: { amount: number; currency: string },
  tranId: string,
  carriedDays: number
): URLSearchParams {
  const base = callbackBase(env);

  return new URLSearchParams({
    cancel_url: `${base}/billing/callback/${PROVIDER_NAME}/return/cancel`,
    // The gateway insists on these. The capability's subject is an id, not a person: which
    // of the two it names is exactly what a provider must not learn (CONTEXT.md → "Billable
    // subject"), so nothing here tries to look one up.
    cus_add1: UNKNOWN_FIELD,
    cus_city: UNKNOWN_FIELD,
    cus_country: COUNTRY,
    cus_email: required(env, "SSLCOMMERZ_RECEIPT_EMAIL"),
    cus_name: `${input.subject.customerType} ${input.subject.referenceId}`,
    cus_phone: UNKNOWN_FIELD,
    currency: price.currency,
    fail_url: `${base}/billing/callback/${PROVIDER_NAME}/return/fail`,
    ipn_url: `${base}/billing/callback/${PROVIDER_NAME}/ipn`,
    num_of_item: "1",
    product_category: PRODUCT_CATEGORY,
    // What the subject reads on the hosted page and on their statement.
    product_name: plan.name,
    product_profile: PRODUCT_PROFILE,
    shipping_method: "NO",
    store_id: required(env, "SSLCOMMERZ_STORE_ID"),
    store_passwd: required(env, "SSLCOMMERZ_STORE_PASSWORD"),
    success_url: `${base}/billing/callback/${PROVIDER_NAME}/return/success`,
    // Major units with two decimals, which is the only form the gateway accepts. The figure
    // itself is held in minor units everywhere else in this file.
    total_amount: major(price.amount),
    tran_id: tranId,
    value_a: `${input.subject.customerType}:${input.subject.referenceId}`,
    value_b: `${plan.id}:${input.interval}`,
    value_c: String(carriedDays),
  });
}

/**
 * The gateway's answer as JSON, or a refusal saying why there is none.
 *
 * Every failure here is retryable, because none of them is the gateway saying no — a refusal
 * it *meant* arrives as a 200 carrying a non-`SUCCESS` status, and that is read by the
 * caller. A timeout, a proxy's 502 and an HTML error page are the same thing here: nobody
 * knows whether a session was opened, and nothing has been charged either way.
 */
async function postSession(
  url: string,
  form: URLSearchParams
): Promise<SessionResponse> {
  return await getJson<SessionResponse>(url, "session", {
    body: form,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

/**
 * Ask the gateway what a `val_id` is worth.
 *
 * A GET with the store credentials in the query string, which is the shape SSLCOMMERZ
 * publishes. The call goes out over TLS to a host this file names, so the credentials never
 * cross a hop the caller chose.
 */
async function validate(
  env: BillingEnv,
  valId: string
): Promise<ValidationResponse> {
  const query = new URLSearchParams({
    format: "json",
    store_id: required(env, "SSLCOMMERZ_STORE_ID"),
    store_passwd: required(env, "SSLCOMMERZ_STORE_PASSWORD"),
    val_id: valId,
  });

  return await getJson<ValidationResponse>(
    `${hostOf(env)}${VALIDATION_PATH}?${query.toString()}`,
    "validation",
    { method: "GET" }
  );
}

/**
 * One request against the gateway, as JSON.
 *
 * **Not being able to ask is not an answer.** Every failure here throws `provider_error`
 * with `retryable: true` rather than settling anything: a validation call that timed out
 * says nothing about whether the payment went through, and mapping it to a failure would
 * fail a charge that had already been taken. The queue redelivers, and the browser return
 * asks again besides.
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
    throw new BillingError(
      "provider_error",
      `sslcommerz: the ${what} request did not complete`,
      { cause: error, providerCode: "unreachable", retryable: true }
    );
  }

  const body = await response.text();

  if (!response.ok) {
    throw new BillingError(
      "provider_error",
      `sslcommerz answered HTTP ${response.status} to the ${what} request`,
      { providerCode: `http_${response.status}`, retryable: true }
    );
  }

  try {
    return JSON.parse(body) as Body;
  } catch (error) {
    throw new BillingError(
      "provider_error",
      `sslcommerz answered the ${what} request with something that is not JSON`,
      { cause: error, providerCode: "unreadable", retryable: true }
    );
  }
}

/**
 * The `val_id` off a callback, whatever shape it arrived in.
 *
 * Form-encoded is what the gateway sends, and it is why `handleCallback` is handed the raw
 * `Request`: the core must not guess an encoding. A query-string `val_id` is accepted too,
 * because SSLCOMMERZ appends one on some return configurations.
 */
async function readValId(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get("val_id");
  if (fromQuery) {
    return fromQuery.trim();
  }

  if (request.method !== "POST") {
    return "";
  }

  try {
    const form = await request.formData();
    const value = form.get("val_id");
    return typeof value === "string" ? value.trim() : "";
  } catch {
    // An empty body, or a content type the runtime cannot parse as a form. There is nothing
    // to look up, and a throw here would dead-letter a message no retry can fix.
    return "";
  }
}

/**
 * The event a validated answer is worth, or nothing.
 *
 * Four outcomes. A valid answer that describes the plan it claims to is a payment. A valid
 * answer that does not is a `provider_error` — never a silent accept, because an
 * underpayment quietly accepted is how a subscription is bought at the wrong price. A
 * documented failure is a declined payment. A status this file does not recognise is a gap
 * in the list above, so it throws rather than failing a charge on a word nobody has read.
 */
function eventFor(
  body: ValidationResponse,
  valId: string
): BillingEvent | undefined {
  const status = body.status?.trim().toUpperCase() ?? "";
  const intent = intentOf(body);

  if (status === PENDING_STATUS) {
    // The gateway has not finished deciding. Nothing is written, and the browser return or
    // the next IPN asks again.
    return undefined;
  }

  if (VALID_STATUSES.has(status)) {
    const mismatch = mismatchIn(body, intent);
    if (mismatch) {
      throw new BillingError(
        "provider_error",
        `sslcommerz answered ${status} but ${mismatch}`,
        { providerCode: "mismatch", retryable: false }
      );
    }

    const now = new Date();
    return {
      occurredAt: now,
      provider: PROVIDER_NAME,
      // The gateway's own id for this validation, and half the `billing_events` key. It is
      // what makes the IPN and the browser return converge on one side effect.
      providerEventId: valId,
      subject: intent.subject,
      subscription: paid(body, intent, now),
      type: "payment.succeeded",
    };
  }

  if (FAILED_STATUSES.has(status)) {
    // No projected row: no money moved, so there is no subscription state to write. The core
    // reads the subject's current row for the dunning email (`NEEDS_CURRENT_ROW`), and a
    // first checkout that fails simply has none.
    return {
      occurredAt: new Date(),
      provider: PROVIDER_NAME,
      providerEventId: valId,
      subject: intent.subject,
      type: "payment.failed",
    };
  }

  throw new BillingError(
    "provider_error",
    `sslcommerz answered a status this provider does not recognise: ${status || "(none)"}`,
    { providerCode: status || "no_status", retryable: false }
  );
}

/**
 * What the session was opened for, read back off the validated answer.
 *
 * `value_a` and `value_b` were written by `sessionForm` and echoed by the gateway. They are
 * believed here because the answer they arrive on came from a call this file made, not from
 * the POST a stranger sent.
 */
function intentOf(body: ValidationResponse): CheckoutIntent {
  const [customerType, referenceId] = split(body.value_a);
  const [planId, interval] = split(body.value_b);

  if (!customerType || !referenceId || !planId) {
    throw new BillingError(
      "provider_error",
      "sslcommerz validated a transaction that carries no subject: value_a and value_b were not the pair this provider wrote at session open.",
      { providerCode: "no_subject", retryable: false }
    );
  }

  const days = Number(body.value_c);

  return {
    carriedDays: Number.isFinite(days) && days > 0 ? days : 0,
    interval: interval === "yearly" ? "yearly" : "monthly",
    plan: findPlan(plans, planId),
    subject: { customerType, referenceId },
  };
}

/** `"user:user_1"` → `["user", "user_1"]`. Splits once, so a value may hold a colon. */
function split(value: string | undefined): [string, string] {
  const at = value?.indexOf(":") ?? -1;
  if (!value || at === -1) {
    return ["", ""];
  }
  return [value.slice(0, at), value.slice(at + 1)];
}

/**
 * Why a validated answer does not describe the plan it names, or nothing when it does.
 *
 * Three comparisons, all strict, all against the plan table rather than against anything the
 * caller sent. The `tran_id` proves the transaction was opened by this provider. The
 * currency and the amount prove the subject was charged what the plan costs.
 *
 * The amount is compared in **minor units**. The gateway writes `499.00`, `499.0` and `499`
 * for the same figure, so a string comparison would report a mismatch on a correct payment,
 * and `0.1 + 0.2` is what a float would make of the alternative. Nothing is rounded towards
 * agreement: a payment short by one poisha is one this provider cannot explain.
 */
function mismatchIn(
  body: ValidationResponse,
  intent: CheckoutIntent
): string | null {
  const tranId = body.tran_id?.trim() ?? "";
  if (!tranId.startsWith(PREFIX)) {
    return `the gateway validated tran_id ${tranId || "(none)"}, which this provider did not open`;
  }

  const price = priceFor(intent.plan, intent.interval);

  const currency = body.currency_type?.trim().toUpperCase();
  if (currency !== price.currency) {
    return `the gateway charged in ${currency ?? "(none)"}, not ${price.currency}`;
  }

  const charged = minor(body.currency_amount);
  if (charged !== price.amount) {
    return `the gateway charged ${major(charged)}, not the ${major(price.amount)} plan "${intent.plan.id}" costs per ${intent.interval === "yearly" ? "year" : "month"}`;
  }

  return null;
}

/** The row a validated payment produces. */
function paid(
  body: ValidationResponse,
  intent: CheckoutIntent,
  now: Date
): SubscriptionInput {
  return {
    billingInterval: intent.interval === "yearly" ? "year" : "month",
    cancelAtPeriodEnd: false,
    // The gateway's raw answer, kept whole enough for a human to reconcile a payment by
    // hand. `risk_level` is carried and never acted on: the money moved either way, and
    // holding a paid subscription on a flag would lock out a subject who had paid.
    metadata: {
      bankTranId: body.bank_tran_id ?? null,
      carriedDays: intent.carriedDays,
      rawStatus: body.status ?? null,
      riskLevel: body.risk_level ?? null,
      storeAmount: body.store_amount ?? null,
      valId: body.val_id ?? null,
    },
    periodEnd: addDays(
      now,
      INTERVAL_DAYS[intent.interval] + intent.carriedDays
    ),
    periodStart: now,
    plan: intent.plan.id,
    providerCustomerId: customerId(intent.subject),
    // Derived from the subject rather than random, so the second period's payment converges
    // on the row the first one created instead of stacking a history row. The column is
    // unique, which is what makes `upsertSubscription` an update here.
    providerSubscriptionId: subscriptionId(intent.subject),
    seats: 1,
    status: "active",
  };
}

/** The row a trial produces. No gateway call, and no money. */
function trialing(
  plan: Plan,
  interval: PlanInterval,
  now: Date,
  subject: BillableSubject
): SubscriptionInput {
  const trialDays = plan.trialDays ?? 0;
  return {
    billingInterval: interval === "yearly" ? "year" : "month",
    cancelAtPeriodEnd: false,
    metadata: { rawStatus: "trialing", trial: true },
    // The same instant as `trialEnd`. The renewal sweep reads `trialEnd` on a `trialing`
    // row, and keeping the two in step means a trial that ends is asked to pay once.
    periodEnd: addDays(now, trialDays),
    periodStart: now,
    plan: plan.id,
    providerCustomerId: customerId(subject),
    providerSubscriptionId: subscriptionId(subject),
    seats: 1,
    status: "trialing",
    trialEnd: addDays(now, trialDays),
    trialStart: now,
  };
}

/** The price a plan carries for an interval, or a refusal naming what is missing. */
function priceFor(
  plan: Plan,
  interval: PlanInterval
): { amount: number; currency: string } {
  const price = plan.price[interval];

  if (!price || price.amount <= 0) {
    throw new BillingError(
      "invalid_request",
      `Plan "${plan.id}" carries no ${interval} price. sslcommerz is handed a figure rather than a price id, so set price.${interval} = { amount, currency: "${CURRENCY}" } in packages/billing/src/plans.ts — amount in poisha, so 499 BDT is 49900.`,
      { providerCode: "no_price" }
    );
  }

  if (price.currency.trim().toUpperCase() !== CURRENCY) {
    throw new BillingError(
      "invalid_request",
      `Plan "${plan.id}" is priced in ${price.currency} and sslcommerz takes ${CURRENCY} only. An SSLCOMMERZ store is provisioned for a currency set, and a mismatch would otherwise surface after the subject had paid.`,
      { providerCode: "unsupported_currency" }
    );
  }

  return { amount: price.amount, currency: CURRENCY };
}

/**
 * The row a `cancel` or a `restore` starts from — the live one the route read, minus the
 * columns the core owns.
 *
 * The contract hands a provider no database, and this gateway holds no subscription to read
 * back, so the route supplies `SubjectInput.current`. Without it the event would have to
 * invent the plan it is cancelling and write the invention over the real row.
 */
function carried(input: SubjectInput): SubscriptionInput {
  const current = input.current;
  if (!current) {
    throw new BillingError(
      "not_found",
      `No live subscription for ${input.subject.customerType} ${input.subject.referenceId}. Start one through POST /billing/checkout first.`,
      { providerCode: "no_subscription" }
    );
  }

  // `provider`, `lockedAt`, `reminderSentAt` and the row's own id and timestamps are
  // core-owned and must not travel back through an event.
  const {
    createdAt: _createdAt,
    customerType: _customerType,
    id: _id,
    lockedAt: _lockedAt,
    provider: _provider,
    referenceId: _referenceId,
    reminderSentAt: _reminderSentAt,
    updatedAt: _updatedAt,
    ...projected
  } = current;

  return projected;
}

/** Days still left on the row the subject is paying on, or zero. */
function daysLeft(current: Subscription | undefined, now: Date): number {
  const endsAt = current?.periodEnd ?? current?.trialEnd;
  if (!endsAt || endsAt.getTime() <= now.getTime()) {
    return 0;
  }
  return Math.floor((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/** Build one normalized event from a projection this provider minted itself. */
function event(
  type: BillingEvent["type"],
  subject: BillableSubject,
  subscription: SubscriptionInput
): BillingEvent {
  return {
    occurredAt: new Date(),
    provider: PROVIDER_NAME,
    // Random, because no gateway call produced an id: these events report a decision this
    // project made, not one the gateway reported, so two of them must never dedupe.
    providerEventId: `${PREFIX}evt_${crypto.randomUUID()}`,
    subject,
    subscription,
    type,
  };
}

function subscriptionId(subject: BillableSubject): string {
  return `${PREFIX}sub_${subject.customerType}_${subject.referenceId}`;
}

function customerId(subject: BillableSubject): string {
  return `${PREFIX}cus_${subject.customerType}_${subject.referenceId}`;
}

/**
 * The host for this env.
 *
 * Anything that is not exactly `live` resolves to the sandbox, so a typo in
 * `SSLCOMMERZ_MODE` cannot send a real payment to the live gateway.
 */
function hostOf(env: BillingEnv): string {
  return text(env, "SSLCOMMERZ_MODE") === "live" ? LIVE_URL : SANDBOX_URL;
}

/** Where the four callback URLs live: this project's own api, without a trailing slash. */
function callbackBase(env: BillingEnv): string {
  return required(env, "SSLCOMMERZ_CALLBACK_URL").replace(/\/+$/, "");
}

/** Where a browser return lands, with one flag saying what happened. */
function appUrl(env: BillingEnv, outcome: string): string {
  const base = text(env, "BILLING_APP_URL") || "http://localhost:3001/billing";
  const url = new URL(base);
  url.searchParams.set("billing", outcome);
  return url.toString();
}

/** A required env value, or a refusal naming the key that is unset. */
function required(env: BillingEnv, key: string): string {
  const value = text(env, key);
  if (!value) {
    throw new BillingError(
      "invalid_request",
      `sslcommerz is not configured here: ${key} is unset. Set it in apps/api/.dev.vars for local development and with \`wrangler secret put ${key}\` for a deployed Worker.`,
      { providerCode: "unconfigured" }
    );
  }
  return value;
}

function text(env: BillingEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

/** `49900` → `"499.00"`. The only form the gateway accepts a figure in. */
function major(amount: number): string {
  return (amount / 100).toFixed(2);
}

/** `"499.00"` → `49900`. Rounded, never truncated: `4.999` poisha is not a real figure. */
function minor(amount: string | undefined): number {
  return Math.round(Number(amount ?? "0") * 100);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
