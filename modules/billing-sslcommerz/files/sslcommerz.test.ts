// Tests for the SSLCOMMERZ provider. Repo-only: the descriptor ships `sslcommerz.ts` and
// nothing else, and this file runs on `node:test` via `pnpm test:modules`.
//
// `fetch` is stubbed, so nothing touches the network and no sandbox account is needed. The
// shims beside this module resolve `../provider`, `../define` and `../plans` — the first two
// to the real `packages/billing` core, the third to a fixture plan table priced in BDT,
// because the template's own table is priced for Stripe. See ../plans.ts.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sslcommerzBilling } from "./sslcommerz.ts";
import { BillingError } from "../provider.ts";
import type {
  BillingEnv,
  BillingEvent,
  HostContext,
  Subscription,
} from "../provider.ts";

const ENV: BillingEnv = {
  BILLING_APP_URL: "https://admin.example.test/billing",
  BILLING_PROVIDER: "sslcommerz",
  SSLCOMMERZ_CALLBACK_URL: "https://api.example.test",
  SSLCOMMERZ_RECEIPT_EMAIL: "billing@example.test",
  SSLCOMMERZ_STORE_ID: "store1",
  SSLCOMMERZ_STORE_PASSWORD: "pass1",
};

const CTX: HostContext = { auth: null, headers: new Headers() };
const SUBJECT = { customerType: "user", referenceId: "user_1" };
const DAY = 24 * 60 * 60 * 1000;

const checkout = {
  cancelUrl: "https://admin.example.test/billing?cancel",
  interval: "monthly" as const,
  planId: "pro",
  subject: SUBJECT,
  successUrl: "https://admin.example.test/billing?ok",
};

interface Call {
  url: string;
  method: string;
  form: Record<string, string>;
}

const realFetch = globalThis.fetch;
let calls: Call[];
let responses: unknown[];

/** Queue the gateway's answers, in order. An empty queue answers a valid session open. */
function respondWith(...bodies: unknown[]): void {
  responses = bodies;
}

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const form: Record<string, string> = {};
    // The session open sends a form body; the validation call sends a query string. Both are
    // flattened here so a test can assert on one shape.
    for (const [key, value] of new URL(url).searchParams) {
      form[key] = value;
    }
    if (init.body instanceof URLSearchParams) {
      for (const [key, value] of init.body) {
        form[key] = value;
      }
    }
    calls.push({ form, method: init.method ?? "GET", url });

    const next = responses.shift() ?? {
      GatewayPageURL: "https://sandbox.sslcommerz.com/pay/abc",
      status: "SUCCESS",
    };
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(Response.json(next, { status: 200 }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A validated answer for the fixture's `pro` plan, monthly, paid in full. */
function validated(overrides: Record<string, unknown> = {}) {
  return {
    amount: "499.00",
    bank_tran_id: "bank_1",
    currency_amount: "499.00",
    currency_type: "BDT",
    risk_level: "0",
    status: "VALID",
    store_amount: "487.02",
    tran_id: lastTranId(),
    val_id: "val_1",
    value_a: "user:user_1",
    value_b: "pro:monthly",
    value_c: "0",
    ...overrides,
  };
}

/** The `tran_id` the session open minted, so a validation answer can name the same one. */
function lastTranId(): string {
  return calls.at(0)?.form.tran_id ?? "sslcz_unknown";
}

function ipn(valId = "val_1"): Request {
  return new Request(
    "https://api.example.test/billing/callback/sslcommerz/ipn",
    {
      body: new URLSearchParams({ tran_id: "x", val_id: valId }),
      method: "POST",
    }
  );
}

async function callbackError(request: Request, path: string) {
  try {
    await sslcommerzBilling().handleCallback?.(ENV, request, path);
  } catch (error) {
    assert.ok(
      error instanceof BillingError,
      `expected BillingError, got ${String(error)}`
    );
    return error;
  }
  return assert.fail("expected handleCallback to throw");
}

async function checkoutError(env: BillingEnv, planId: string) {
  try {
    await sslcommerzBilling().createCheckout(env, CTX, {
      ...checkout,
      planId,
    });
  } catch (error) {
    assert.ok(
      error instanceof BillingError,
      `expected BillingError, got ${String(error)}`
    );
    return error;
  }
  return assert.fail("expected createCheckout to throw");
}

describe("sslcommerz: identity", () => {
  it("is selected by the name `sslcommerz` and renews manually", () => {
    const provider = sslcommerzBilling();

    assert.equal(provider.name, "sslcommerz");
    assert.equal(provider.renewal, "manual");
    assert.equal(typeof provider.handleCallback, "function");
    // No vendor auth plugin: the callbacks come in on the capability's own route.
    assert.equal(provider.authPlugin, undefined);
  });
});

describe("sslcommerz: createCheckout", () => {
  it("opens a session and answers the GatewayPageURL, with no event", async () => {
    const result = await sslcommerzBilling().createCheckout(ENV, CTX, checkout);

    assert.equal(result.url, "https://sandbox.sslcommerz.com/pay/abc");
    // The money has not moved yet, so nothing is written. The validated callback is what
    // says it did.
    assert.equal(result.event, undefined);

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(
      call?.url,
      "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
    );
    assert.equal(call?.method, "POST");
    assert.equal(call?.form.total_amount, "499.00");
    assert.equal(call?.form.currency, "BDT");
    assert.equal(call?.form.store_id, "store1");
    assert.equal(call?.form.value_a, "user:user_1");
    assert.equal(call?.form.value_b, "pro:monthly");
    assert.equal(call?.form.value_c, "0");
    assert.ok(call?.form.tran_id.startsWith("sslcz_"));
    assert.equal(
      call?.form.ipn_url,
      "https://api.example.test/billing/callback/sslcommerz/ipn"
    );
    assert.equal(
      call?.form.success_url,
      "https://api.example.test/billing/callback/sslcommerz/return/success"
    );
  });

  it("uses the live host only for the exact string `live`", async () => {
    await sslcommerzBilling().createCheckout(
      { ...ENV, SSLCOMMERZ_MODE: "live" },
      CTX,
      checkout
    );
    assert.ok(calls[0]?.url.startsWith("https://securepay.sslcommerz.com"));

    calls = [];
    // A typo must not reach the live gateway, and neither must a capital L.
    await sslcommerzBilling().createCheckout(
      { ...ENV, SSLCOMMERZ_MODE: "Live" },
      CTX,
      checkout
    );
    assert.ok(calls[0]?.url.startsWith("https://sandbox.sslcommerz.com"));

    calls = [];
    await sslcommerzBilling().createCheckout(
      { ...ENV, SSLCOMMERZ_MODE: "livee" },
      CTX,
      checkout
    );
    assert.ok(calls[0]?.url.startsWith("https://sandbox.sslcommerz.com"));
  });

  it("sends the yearly figure for the yearly interval", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, {
      ...checkout,
      interval: "yearly",
    });

    assert.equal(calls[0]?.form.total_amount, "4990.00");
    assert.equal(calls[0]?.form.value_b, "pro:yearly");
  });

  it("mints a trialing event and calls no gateway for a plan with trialDays", async () => {
    const result = await sslcommerzBilling().createCheckout(ENV, CTX, {
      ...checkout,
      planId: "trial",
    });

    assert.equal(calls.length, 0);
    assert.equal(result.url, checkout.successUrl);
    assert.equal(result.event?.type, "subscription.changed");
    assert.equal(result.event?.subscription?.status, "trialing");
    assert.equal(
      result.event?.subscription?.providerSubscriptionId,
      "sslcz_sub_user_user_1"
    );
    // The renewal sweep reads `trialEnd` on a trialing row, so the two dates agree.
    assert.deepEqual(
      result.event?.subscription?.trialEnd,
      result.event?.subscription?.periodEnd
    );
  });

  it("refuses a plan priced in anything but BDT, naming the plan", async () => {
    const error = await checkoutError(ENV, "dollars");

    assert.equal(error.code, "invalid_request");
    assert.equal(error.providerCode, "unsupported_currency");
    assert.match(error.message, /"dollars" is priced in USD/);
    assert.equal(calls.length, 0);
  });

  it("refuses a plan carrying no price for the interval", async () => {
    const error = await checkoutError(ENV, "free");

    assert.equal(error.code, "invalid_request");
    assert.equal(error.providerCode, "no_price");
    assert.equal(calls.length, 0);
  });

  it("refuses before sending anything when a credential is unset", async () => {
    const error = await checkoutError(
      { ...ENV, SSLCOMMERZ_STORE_ID: "" },
      "pro"
    );

    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /SSLCOMMERZ_STORE_ID is unset/);
    assert.equal(calls.length, 0);
  });

  it("maps a refused session open onto provider_error, keeping the gateway's word", async () => {
    respondWith({ failedreason: "Invalid Store Credential", status: "FAILED" });

    const error = await checkoutError(ENV, "pro");

    assert.equal(error.code, "provider_error");
    assert.equal(error.providerCode, "FAILED");
    assert.match(error.message, /Invalid Store Credential/);
    assert.equal(error.retryable, false);
  });

  it("treats an unreachable gateway as retryable, and never as a failure", async () => {
    respondWith(new TypeError("network"));

    const error = await checkoutError(ENV, "pro");

    assert.equal(error.code, "provider_error");
    assert.equal(error.providerCode, "unreachable");
    assert.equal(error.retryable, true);
  });
});

describe("sslcommerz: changePlan", () => {
  it("charges full price and carries the days left on the old period", async () => {
    const current = {
      createdAt: new Date(),
      customerType: "user",
      id: "row_1",
      periodEnd: new Date(Date.now() + 10 * DAY + 60_000),
      plan: "pro",
      providerCustomerId: "sslcz_cus_user_user_1",
      providerSubscriptionId: "sslcz_sub_user_user_1",
      referenceId: "user_1",
      status: "active",
      updatedAt: new Date(),
    } as Subscription;

    await sslcommerzBilling().changePlan(ENV, CTX, {
      ...checkout,
      current,
      interval: "yearly",
    });

    assert.equal(calls[0]?.form.total_amount, "4990.00");
    // Ten days and a minute left, and `daysLeft` floors rather than rounds up.
    assert.equal(calls[0]?.form.value_c, "10");
  });

  it("carries nothing when the old period has already ended", async () => {
    await sslcommerzBilling().changePlan(ENV, CTX, checkout);

    assert.equal(calls[0]?.form.value_c, "0");
  });
});

describe("sslcommerz: handleCallback — the browser returns", () => {
  it("redirects a fail and a cancel to the billing page, and mints nothing", async () => {
    for (const [path, flag] of [
      ["return/fail", "failed"],
      ["return/cancel", "canceled"],
    ]) {
      const result = await sslcommerzBilling().handleCallback?.(
        ENV,
        new Request("https://api.example.test/x", { method: "POST" }),
        path as string
      );

      assert.equal(result?.kind, "redirect");
      assert.equal(
        result?.kind === "redirect" ? result.url : "",
        `https://admin.example.test/billing?billing=${flag as string}`
      );
      assert.equal(calls.length, 0);
    }
  });

  it("ignores a path this provider did not register", async () => {
    const result = await sslcommerzBilling().handleCallback?.(
      ENV,
      ipn(),
      "webhook"
    );

    assert.equal(result?.kind, "ignored");
    assert.equal(calls.length, 0);
  });

  it("validates the return too, and answers a redirect carrying the same event", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(validated({ status: "VALIDATED" }));

    const result = await sslcommerzBilling().handleCallback?.(
      ENV,
      ipn(),
      "return/success"
    );

    assert.equal(result?.kind, "redirect");
    assert.equal(
      result?.kind === "redirect" ? result.url : "",
      "https://admin.example.test/billing?billing=paid"
    );
    // The same `val_id`, so whichever of the IPN and the return lands second is a no-op
    // against the billing_events primary key.
    const event = result?.kind === "redirect" ? result.event : undefined;
    assert.equal(event?.providerEventId, "val_1");
    assert.equal(event?.type, "payment.succeeded");
  });
});

describe("sslcommerz: handleCallback — the IPN", () => {
  async function ipnEvent(
    body: Record<string, unknown>
  ): Promise<BillingEvent | undefined> {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(body);
    const result = await sslcommerzBilling().handleCallback?.(
      ENV,
      ipn(),
      "ipn"
    );
    return result?.kind === "event" ? result.event : undefined;
  }

  it("asks the validation API about the val_id, and nothing else", async () => {
    await ipnEvent(validated());

    const validation = calls.at(-1);
    assert.ok(
      validation?.url.startsWith(
        "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
      )
    );
    assert.equal(validation?.method, "GET");
    assert.equal(validation?.form.val_id, "val_1");
    assert.equal(validation?.form.store_id, "store1");
  });

  it("mints payment.succeeded with the val_id as the event id", async () => {
    const event = await ipnEvent(validated());

    assert.equal(event?.type, "payment.succeeded");
    assert.equal(event?.provider, "sslcommerz");
    assert.equal(event?.providerEventId, "val_1");
    assert.deepEqual(event?.subject, SUBJECT);

    const row = event?.subscription;
    assert.equal(row?.plan, "pro");
    assert.equal(row?.status, "active");
    assert.equal(row?.billingInterval, "month");
    // Derived from the subject, so the next period's payment updates this row rather than
    // stacking a second one.
    assert.equal(row?.providerSubscriptionId, "sslcz_sub_user_user_1");
    assert.equal(row?.providerCustomerId, "sslcz_cus_user_user_1");
    assert.deepEqual(row?.metadata, {
      bankTranId: "bank_1",
      carriedDays: 0,
      rawStatus: "VALID",
      riskLevel: "0",
      storeAmount: "487.02",
      valId: "val_1",
    });

    const days =
      ((row?.periodEnd?.getTime() ?? 0) - (row?.periodStart?.getTime() ?? 0)) /
      DAY;
    assert.equal(days, 30);
  });

  it("adds the carried days to the period it opens", async () => {
    const event = await ipnEvent(validated({ value_c: "9" }));
    const row = event?.subscription;

    const days =
      ((row?.periodEnd?.getTime() ?? 0) - (row?.periodStart?.getTime() ?? 0)) /
      DAY;
    assert.equal(days, 39);
  });

  it("treats VALIDATED exactly as VALID", async () => {
    const event = await ipnEvent(validated({ status: "VALIDATED" }));

    assert.equal(event?.type, "payment.succeeded");
  });

  it("ignores a PENDING answer, so nothing is written either way", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(validated({ status: "PENDING" }));

    const result = await sslcommerzBilling().handleCallback?.(
      ENV,
      ipn(),
      "ipn"
    );

    assert.equal(result?.kind, "ignored");
  });

  it("mints payment.failed for every documented failure status", async () => {
    for (const status of [
      "FAILED",
      "CANCELLED",
      "UNATTEMPTED",
      "EXPIRED",
      "INVALID_TRANSACTION",
    ]) {
      calls = [];
      const event = await ipnEvent(validated({ status }));

      assert.equal(event?.type, "payment.failed", status);
      // No projected row: no money moved, so there is no subscription state to write.
      assert.equal(event?.subscription, undefined);
    }
  });

  it("refuses an amount that is short, rather than accepting it", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(validated({ currency_amount: "498.99" }));

    const error = await callbackError(ipn(), "ipn");

    assert.equal(error.code, "provider_error");
    assert.equal(error.providerCode, "mismatch");
    assert.match(error.message, /charged 498\.99, not the 499\.00/);
  });

  it("refuses a payment made in another currency", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(validated({ currency_amount: "499.00", currency_type: "USD" }));

    const error = await callbackError(ipn(), "ipn");

    assert.equal(error.providerCode, "mismatch");
    assert.match(error.message, /charged in USD, not BDT/);
  });

  it("refuses a tran_id this provider never opened", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(validated({ tran_id: "someone-elses-order" }));

    const error = await callbackError(ipn(), "ipn");

    assert.equal(error.providerCode, "mismatch");
    assert.match(error.message, /which this provider did not open/);
  });

  it("refuses a status it does not recognise, rather than failing the charge", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(validated({ status: "SOMETHING_NEW" }));

    const error = await callbackError(ipn(), "ipn");

    assert.equal(error.code, "provider_error");
    assert.equal(error.providerCode, "SOMETHING_NEW");
    assert.match(error.message, /does not recognise/);
  });

  it("refuses an answer that carries no subject", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(validated({ value_a: "", value_b: "" }));

    const error = await callbackError(ipn(), "ipn");

    assert.equal(error.providerCode, "no_subject");
  });

  it("treats an unreachable validation call as retryable", async () => {
    await sslcommerzBilling().createCheckout(ENV, CTX, checkout);
    respondWith(new TypeError("network"));

    const error = await callbackError(ipn(), "ipn");

    assert.equal(error.retryable, true);
    assert.equal(error.providerCode, "unreachable");
  });

  it("ignores an IPN that carries no val_id, without calling the gateway", async () => {
    const result = await sslcommerzBilling().handleCallback?.(
      ENV,
      new Request("https://api.example.test/x", {
        body: new URLSearchParams({ tran_id: "x" }),
        method: "POST",
      }),
      "ipn"
    );

    assert.equal(result?.kind, "ignored");
    assert.equal(calls.length, 0);
  });
});

describe("sslcommerz: the methods the gateway has no counterpart for", () => {
  const current = {
    createdAt: new Date(),
    customerType: "user",
    id: "row_1",
    lockedAt: null,
    periodEnd: new Date(Date.now() + 10 * DAY),
    plan: "pro",
    provider: "sslcommerz",
    providerCustomerId: "sslcz_cus_user_user_1",
    providerSubscriptionId: "sslcz_sub_user_user_1",
    referenceId: "user_1",
    status: "active",
    updatedAt: new Date(),
  } as Subscription;

  it("cancels by minting an event off the row the route read", async () => {
    const result = await sslcommerzBilling().cancel(ENV, CTX, {
      current,
      subject: SUBJECT,
    });

    assert.equal(result?.event?.subscription?.cancelAtPeriodEnd, true);
    assert.deepEqual(result?.event?.subscription?.cancelAt, current.periodEnd);
    // The core owns these, and a provider must never write one back through an event.
    assert.equal(
      "provider" in (result?.event?.subscription ?? {}),
      false,
      "the provider column must not travel back through an event"
    );
    assert.equal(calls.length, 0);
  });

  it("restores by clearing the pending cancellation", async () => {
    const result = await sslcommerzBilling().restore(ENV, CTX, {
      current,
      subject: SUBJECT,
    });

    assert.equal(result?.event?.subscription?.cancelAtPeriodEnd, false);
    assert.equal(result?.event?.subscription?.cancelAt, null);
  });

  it("refuses a cancel with no live row rather than inventing a plan", () => {
    // A synchronous throw, like `billing-console`'s. `defineBilling`'s wrapper calls every
    // contract method inside its own `try`, so it still reaches the caller as a
    // `BillingError` either way.
    assert.throws(
      () => sslcommerzBilling().cancel(ENV, CTX, { subject: SUBJECT }),
      (error: unknown) =>
        error instanceof BillingError && error.code === "not_found"
    );
  });

  it("returns the caller's own url from createPortal, and no invoices", async () => {
    const portal = await sslcommerzBilling().createPortal(ENV, CTX, {
      returnUrl: "https://admin.example.test/billing",
      subject: SUBJECT,
    });

    assert.equal(portal.url, "https://admin.example.test/billing");
    assert.deepEqual(
      await sslcommerzBilling().listInvoices(ENV, CTX, {
        subject: SUBJECT,
      }),
      []
    );
  });

  it("validates a seat count and does nothing else", async () => {
    await sslcommerzBilling().setQuantity(ENV, CTX, {
      seats: 3,
      subject: SUBJECT,
    });

    assert.throws(
      () =>
        sslcommerzBilling().setQuantity(ENV, CTX, {
          seats: 0,
          subject: SUBJECT,
        }),
      (error: unknown) =>
        error instanceof BillingError && error.code === "invalid_request"
    );
    assert.equal(calls.length, 0);
  });
});
