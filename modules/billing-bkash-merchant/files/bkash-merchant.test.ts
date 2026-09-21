// Tests for the bKash merchant provider. Repo-only: the descriptor ships
// `bkash-merchant.ts` and nothing else, and this file runs on `node:test` via
// `pnpm test:modules`.
//
// `fetch` is stubbed and the KV store is a `Map`, so nothing touches the network and no
// sandbox merchant account is needed. The shims beside this module resolve `../provider`,
// `../define` and `../config` to the real `packages/billing` core, and `../plans` to a
// fixture plan table priced in BDT — the template's own table is priced for Stripe. See
// ../plans.ts.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  BKASH_TOKEN_JOB,
  bkashMerchantBilling,
  bkashTokenSchedule,
  runBkashToken,
} from "./bkash-merchant.ts";
import { BillingError } from "../provider.ts";
import type {
  BillingEnv,
  BillingEvent,
  HostContext,
  Subscription,
} from "../provider.ts";

const ENV: BillingEnv = {
  BILLING_APP_URL: "https://admin.example.test/billing",
  BILLING_PROVIDER: "bkash-merchant",
  BKASH_MERCHANT_APP_KEY: "key1",
  BKASH_MERCHANT_APP_SECRET: "secret1",
  BKASH_MERCHANT_PASSWORD: "pass1",
  BKASH_MERCHANT_USERNAME: "user1",
  KV_PROVIDER: "memory",
};

const CTX: HostContext = {
  auth: null,
  headers: new Headers({ host: "api.example.test" }),
};
const SUBJECT = { customerType: "user", referenceId: "user_1" };
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const checkout = {
  cancelUrl: "https://admin.example.test/billing?cancel",
  interval: "monthly" as const,
  planId: "pro",
  subject: SUBJECT,
  successUrl: "https://admin.example.test/billing?ok",
};

// --- the stubs ---------------------------------------------------------------------------

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/**
 * The smallest thing shaped like a `KvClient` that this provider actually uses: `key`, `get`
 * and `set`. Nothing here expires an entry — the token's own `expiresAt` is what the provider
 * reads, and a test that needed a real TTL would be testing `kv`, not this file.
 */
function fakeStore() {
  const entries = new Map<string, unknown>();
  return {
    client: {
      key: ({
        namespace,
        parts = [],
      }: {
        namespace: string;
        parts?: string[];
      }) => [namespace, ...parts].join(":"),
      get: <T>(key: string) =>
        Promise.resolve((entries.get(key) ?? null) as T | null),
      set: <T>(key: string, value: T) => {
        entries.set(key, value);
        return Promise.resolve();
      },
    },
    entries,
  };
}

const realFetch = globalThis.fetch;
let calls: Call[];
let responses: unknown[];
let store: ReturnType<typeof fakeStore>;

/** Queue bKash's answers, in order. An empty queue answers a good token grant. */
function respondWith(...bodies: unknown[]): void {
  responses = bodies;
}

/** The provider, wired to the stub store. `createKv` is the default in a real project. */
function provider() {
  return bkashMerchantBilling({
    store: () => store.client as never,
  });
}

beforeEach(() => {
  calls = [];
  responses = [];
  store = fakeStore();
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      (init.headers ?? {}) as Record<string, string>
    )) {
      headers[key.toLowerCase()] = value;
    }
    calls.push({
      body:
        typeof init.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {},
      headers,
      url,
    });

    const next = responses.shift() ?? grantAnswer();
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(Response.json(next, { status: 200 }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- fixtures ----------------------------------------------------------------------------

function grantAnswer(overrides: Record<string, unknown> = {}) {
  return {
    expires_in: 3600,
    id_token: "token_1",
    refresh_token: "refresh_1",
    statusCode: "0000",
    ...overrides,
  };
}

function createAnswer(overrides: Record<string, unknown> = {}) {
  return {
    bkashURL: "https://sandbox.bka.sh/pay/abc",
    paymentID: "TR001",
    statusCode: "0000",
    ...overrides,
  };
}

/** A completed payment for the fixture's `pro` plan, monthly, paid in full. */
function completed(overrides: Record<string, unknown> = {}) {
  return {
    amount: "499.00",
    currency: "BDT",
    customerMsisdn: "01770618567",
    merchantInvoiceNumber: "pro:monthly:0:nonce-1",
    paymentExecuteTime: "2026-09-21T10:00:00:000 GMT+0600",
    paymentID: "TR001",
    payerReference: "user:user_1",
    statusCode: "0000",
    transactionStatus: "Completed",
    trxID: "TRX001",
    ...overrides,
  };
}

/** A stored token good for `minutes` from now. */
function storeToken(minutes: number, refreshToken = "refresh_1"): void {
  store.entries.set("billing:bkash-merchant:token", {
    expiresAt: Date.now() + minutes * MINUTE,
    idToken: "token_stored",
    refreshedAt: Date.now(),
    refreshToken,
  });
}

function returnRequest(query: string): Request {
  return new Request(
    `https://api.example.test/billing/callback/bkash-merchant/return?${query}`
  );
}

function webhookRequest(body: unknown): Request {
  return new Request(
    "https://api.example.test/billing/callback/bkash-merchant/webhook",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}

/** Run `body` and return the `BillingError` it threw. Fails the test if it threw nothing. */
async function rejects(body: () => Promise<unknown>): Promise<BillingError> {
  try {
    await body();
  } catch (error) {
    assert.ok(error instanceof BillingError, `not a BillingError: ${error}`);
    return error;
  }
  assert.fail("expected a BillingError, and nothing was thrown");
}

// --- construction ------------------------------------------------------------------------

describe("configuration", () => {
  it("names the first missing credential, before anything is sent", async () => {
    for (const key of [
      "BKASH_MERCHANT_APP_KEY",
      "BKASH_MERCHANT_APP_SECRET",
      "BKASH_MERCHANT_USERNAME",
      "BKASH_MERCHANT_PASSWORD",
    ]) {
      const error = await rejects(() =>
        provider().createCheckout({ ...ENV, [key]: undefined }, CTX, checkout)
      );
      assert.equal(error.code, "invalid_request");
      assert.match(error.message, new RegExp(key));
      assert.equal(calls.length, 0);
    }
  });

  it("names KV_PROVIDER, because the token has nowhere to live without it", async () => {
    const error = await rejects(() =>
      provider().createCheckout(
        { ...ENV, KV_PROVIDER: undefined },
        CTX,
        checkout
      )
    );
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /KV_PROVIDER/);
    assert.equal(calls.length, 0);
  });
});

// --- the token job -----------------------------------------------------------------------

describe("the token job", () => {
  it("grants when there is no record at all", async () => {
    const action = await runBkashToken(store.client as never, ENV, new Date());

    assert.equal(action, "granted");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/tokenized\/checkout\/token\/grant$/);
    // The two token calls carry the credentials as headers, not as an Authorization token.
    assert.equal(calls[0].headers.username, "user1");
    assert.equal(calls[0].headers.password, "pass1");
    assert.equal(
      (store.entries.get("billing:bkash-merchant:token") as { idToken: string })
        .idToken,
      "token_1"
    );
  });

  it("refreshes a record that expires inside 20 minutes", async () => {
    storeToken(10);
    respondWith(grantAnswer({ id_token: "token_2" }));

    const action = await runBkashToken(store.client as never, ENV, new Date());

    assert.equal(action, "refreshed");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/token\/refresh$/);
    assert.equal(calls[0].body.refresh_token, "refresh_1");
  });

  it("does nothing for a record that expires in 40 minutes", async () => {
    storeToken(40);

    const action = await runBkashToken(store.client as never, ENV, new Date());

    assert.equal(action, "none");
    assert.equal(calls.length, 0);
  });

  it("falls a refused refresh through to a grant", async () => {
    storeToken(10);
    respondWith(
      { statusCode: "2001", statusMessage: "Invalid refresh token" },
      grantAnswer({ id_token: "token_3" })
    );

    const action = await runBkashToken(store.client as never, ENV, new Date());

    assert.equal(action, "granted");
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/token\/grant$/);
  });

  it("throws, and does not ask to be retried, when the grant is refused", async () => {
    // A retry would spend the second of the hour's two calls on the same refusal. The next
    // tick is 15 minutes away, and there are three of them before the token is unusable.
    respondWith({ statusCode: "2001", statusMessage: "Invalid app key" });

    const error = await rejects(() =>
      runBkashToken(store.client as never, ENV, new Date())
    );
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, "token_refused");
  });

  it("skips an environment that carries no bKash credentials", async () => {
    // The job is registered on every deploy of a project that installed the module, whether
    // or not BILLING_PROVIDER names it. One KV read per tick is the whole cost.
    const action = await runBkashToken(
      store.client as never,
      { KV_PROVIDER: "memory" },
      new Date()
    );

    assert.equal(action, "skipped");
    assert.equal(calls.length, 0);
  });

  it("stays inside the two-calls-an-hour budget in the steady state", async () => {
    // This is the test the whole design exists to pass. Four ticks an hour, and the token is
    // only touched inside 20 minutes of its 3600-second life, so one caller refreshes it
    // every 45 minutes — the 40 minutes of usable life, rounded up to the next tick. Three
    // calls across two hours, one of which is the cold grant. bKash's published limit is two
    // an hour, and nothing else in this provider ever calls a token endpoint.
    const start = new Date("2026-09-21T00:00:00Z");
    const actions: string[] = [];

    for (let minute = 0; minute <= 120; minute += 15) {
      respondWith(grantAnswer({ id_token: `token_${minute}` }));
      actions.push(
        await runBkashToken(
          store.client as never,
          ENV,
          new Date(start.getTime() + minute * MINUTE)
        )
      );
    }

    assert.deepEqual(actions, [
      "granted", // 00:00 — nothing stored, so the cold grant
      "none", // 00:15 — 45 minutes left
      "none", // 00:30 — 30 minutes left
      "refreshed", // 00:45 — 15 minutes left, inside the window. Good until 01:45.
      "none", // 01:00
      "none", // 01:15
      "refreshed", // 01:30 — 15 minutes left again
      "none", // 01:45
      "none", // 02:00
    ]);
    // One grant plus two refreshes over two hours, and never two inside one hour.
    assert.equal(calls.length, 3);
  });

  it("registers a quarter-hour schedule against the job's own name", () => {
    const schedule = bkashTokenSchedule();

    assert.equal(schedule.cron, "*/15 * * * *");
    assert.equal(schedule.job, BKASH_TOKEN_JOB);
  });
});

// --- the cold start ----------------------------------------------------------------------

describe("the cold start", () => {
  it("grants once inline, so a fresh deploy does not wait for the first tick", async () => {
    respondWith(grantAnswer(), createAnswer());

    const result = await provider().createCheckout(ENV, CTX, checkout);

    assert.equal(result.url, "https://sandbox.bka.sh/pay/abc");
    assert.match(calls[0].url, /\/token\/grant$/);
    assert.match(calls[1].url, /\/tokenized\/checkout\/create$/);
  });

  it("refuses a second concurrent cold start rather than granting twice", async () => {
    // The marker is written before the grant, not after. Two requests that both granted would
    // spend the whole hour's budget on one deploy.
    store.entries.set("billing:bkash-merchant:token:granting", Date.now());

    const error = await rejects(() =>
      provider().createCheckout(ENV, CTX, checkout)
    );

    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, true);
    assert.equal(calls.length, 0);
  });

  it("reads a stored token and calls bKash only for the payment", async () => {
    storeToken(40);
    respondWith(createAnswer());

    await provider().createCheckout(ENV, CTX, checkout);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.authorization, "token_stored");
    assert.equal(calls[0].headers["x-app-key"], "key1");
  });
});

// --- checkout ----------------------------------------------------------------------------

describe("createCheckout", () => {
  beforeEach(() => {
    storeToken(40);
  });

  it("sends the plan, the subject and the callback, and mints no event", async () => {
    respondWith(createAnswer());

    const result = await provider().createCheckout(ENV, CTX, checkout);

    assert.equal(result.event, undefined);
    assert.equal(calls[0].body.mode, "0011");
    assert.equal(calls[0].body.intent, "sale");
    assert.equal(calls[0].body.amount, "499.00");
    assert.equal(calls[0].body.currency, "BDT");
    assert.equal(calls[0].body.payerReference, "user:user_1");
    assert.match(
      String(calls[0].body.merchantInvoiceNumber),
      /^pro:monthly:0:/
    );
    // The callback URL is the api Worker's own origin, off this request's Host header.
    assert.equal(
      calls[0].body.callbackURL,
      "https://api.example.test/billing/callback/bkash-merchant/return"
    );
  });

  it("strips the characters bKash refuses and caps the field at 255", async () => {
    respondWith(createAnswer());

    await provider().createCheckout(ENV, CTX, {
      ...checkout,
      subject: { customerType: "user", referenceId: "a<b>c&d".repeat(100) },
    });

    const reference = String(calls[0].body.payerReference);
    assert.equal(reference.includes("<"), false);
    assert.equal(reference.includes(">"), false);
    assert.equal(reference.includes("&"), false);
    assert.equal(reference.length, 255);
  });

  it("mints a trial and calls no gateway at all", async () => {
    const result = await provider().createCheckout(ENV, CTX, {
      ...checkout,
      planId: "trial",
    });

    assert.equal(calls.length, 0);
    assert.equal(result.url, checkout.successUrl);
    assert.equal(result.event?.subscription?.status, "trialing");
  });

  it("refuses a plan priced in anything but BDT, naming both", async () => {
    const error = await rejects(() =>
      provider().createCheckout(ENV, CTX, { ...checkout, planId: "dollars" })
    );

    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /dollars/);
    assert.match(error.message, /USD/);
    assert.equal(calls.length, 0);
  });

  it("reports a refused create with bKash's own code", async () => {
    respondWith({ statusCode: "2001", statusMessage: "Invalid App Key" });

    const error = await rejects(() =>
      provider().createCheckout(ENV, CTX, checkout)
    );

    assert.equal(error.code, "invalid_request");
    assert.equal(error.providerCode, "2001");
  });

  it("does not settle anything when bKash cannot be reached", async () => {
    respondWith(new Error("connect ETIMEDOUT"));

    const error = await rejects(() =>
      provider().createCheckout(ENV, CTX, checkout)
    );

    assert.equal(error.providerCode, "unreachable");
    assert.equal(error.retryable, true);
  });
});

describe("changePlan", () => {
  it("charges full price and adds the days left on the old period", async () => {
    storeToken(40);
    respondWith(createAnswer(), completed({ merchantInvoiceNumber: "" }));

    const current = {
      periodEnd: new Date(Date.now() + 10 * DAY),
    } as Subscription;
    await provider().changePlan(ENV, CTX, { ...checkout, current });

    // `<plan>:<interval>:<carriedDays>:<nonce>` — the days ride out on the invoice number and
    // come home on bKash's own echo, so no pending-checkout row is needed.
    assert.match(
      String(calls[0].body.merchantInvoiceNumber),
      /^pro:monthly:(9|10):/
    );
  });
});

// --- the browser return ------------------------------------------------------------------

describe("the browser return", () => {
  beforeEach(() => {
    storeToken(40);
  });

  it("executes the payment and mints one payment.succeeded under the trxID", async () => {
    respondWith(completed());

    const result = await provider().handleCallback!(
      ENV,
      returnRequest("paymentID=TR001&status=success"),
      "return"
    );

    assert.equal(result.kind, "redirect");
    const event = (result as { event?: BillingEvent }).event;
    assert.equal(event?.type, "payment.succeeded");
    assert.equal(event?.providerEventId, "TRX001");
    assert.equal(event?.provider, "bkash-merchant");
    assert.deepEqual(event?.subject, SUBJECT);
    assert.equal(event?.subscription?.plan, "pro");
    assert.equal(event?.subscription?.status, "active");
    // Derived from the subject, so the next period converges on the same row.
    assert.equal(
      event?.subscription?.providerSubscriptionId,
      "bkash_sub_user_user_1"
    );
    assert.match(calls[0].url, /\/tokenized\/checkout\/execute$/);
  });

  it("carries the days off the invoice number into the period end", async () => {
    respondWith(completed({ merchantInvoiceNumber: "pro:monthly:10:nonce-1" }));

    const result = await provider().handleCallback!(
      ENV,
      returnRequest("paymentID=TR001&status=success"),
      "return"
    );

    const row = (result as { event?: BillingEvent }).event?.subscription;
    const start = row?.periodStart as Date;
    const end = row?.periodEnd as Date;
    assert.equal(Math.round((end.getTime() - start.getTime()) / DAY), 40);
  });

  it("falls a 2062 through to payment/status and settles from that", async () => {
    respondWith(
      { statusCode: "2062", statusMessage: "already completed" },
      completed()
    );

    const result = await provider().handleCallback!(
      ENV,
      returnRequest("paymentID=TR001&status=success"),
      "return"
    );

    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/tokenized\/checkout\/payment\/status$/);
    assert.equal(
      (result as { event?: BillingEvent }).event?.type,
      "payment.succeeded"
    );
  });

  it("settles nothing on an amount mismatch", async () => {
    respondWith(completed({ amount: "1.00" }));

    const error = await rejects(() =>
      provider().handleCallback!(
        ENV,
        returnRequest("paymentID=TR001&status=success"),
        "return"
      )
    );

    assert.equal(error.providerCode, "mismatch");
    assert.equal(error.retryable, false);
    assert.match(error.message, /499\.00/);
  });

  it("settles nothing on a currency mismatch", async () => {
    respondWith(completed({ currency: "USD" }));

    const error = await rejects(() =>
      provider().handleCallback!(
        ENV,
        returnRequest("paymentID=TR001&status=success"),
        "return"
      )
    );

    assert.equal(error.providerCode, "mismatch");
  });

  it("maps a declined payment onto payment.failed with the raw code kept", async () => {
    for (const code of ["2023", "2011", "2010"]) {
      calls = [];
      respondWith(
        completed({
          statusCode: code,
          transactionStatus: "Failed",
          trxID: `TRX_${code}`,
        })
      );

      const result = await provider().handleCallback!(
        ENV,
        returnRequest("paymentID=TR001&status=success"),
        "return"
      );

      const event = (result as { event?: BillingEvent }).event;
      assert.equal(event?.type, "payment.failed");
      // No projected row: no money moved, so no entitlement is granted.
      assert.equal(event?.subscription, undefined);
      assert.match((result as { url: string }).url, /billing=failed/);
    }
  });

  it("grants nothing when the subject cancels on bKash's own page", async () => {
    const result = await provider().handleCallback!(
      ENV,
      returnRequest("paymentID=TR001&status=cancel"),
      "return"
    );

    assert.equal(result.kind, "redirect");
    assert.equal((result as { event?: BillingEvent }).event, undefined);
    assert.equal(calls.length, 0);
  });

  it("grants nothing on a failed return, and asks bKash nothing", async () => {
    const result = await provider().handleCallback!(
      ENV,
      returnRequest("paymentID=TR001&status=failure"),
      "return"
    );

    assert.equal((result as { event?: BillingEvent }).event, undefined);
    assert.equal(calls.length, 0);
  });

  it("refuses to settle a payment whose echo names no subject", async () => {
    respondWith(completed({ payerReference: "" }));

    const error = await rejects(() =>
      provider().handleCallback!(
        ENV,
        returnRequest("paymentID=TR001&status=success"),
        "return"
      )
    );

    assert.equal(error.providerCode, "no_subject");
  });
});

// --- the webhook -------------------------------------------------------------------------

describe("the webhook", () => {
  beforeEach(() => {
    storeToken(40);
  });

  it("believes nothing on the body and re-reads payment/status", async () => {
    // The body claims a plan and an amount. Neither is read: the event is built from the
    // answer this provider fetched itself.
    respondWith(completed());

    const result = await provider().handleCallback!(
      ENV,
      webhookRequest({
        amount: "1.00",
        merchantInvoiceNumber: "free:yearly:0:x",
        paymentID: "TR001",
      }),
      "webhook"
    );

    assert.equal(result.kind, "event");
    assert.match(calls[0].url, /\/tokenized\/checkout\/payment\/status$/);
    assert.equal(calls[0].body.paymentID, "TR001");
    const event = (result as { event: BillingEvent }).event;
    assert.equal(event.providerEventId, "TRX001");
    assert.equal(event.subscription?.plan, "pro");
  });

  it("mints the same trxID a browser return would, so one period is granted", async () => {
    respondWith(completed(), completed());

    const viaReturn = await provider().handleCallback!(
      ENV,
      returnRequest("paymentID=TR001&status=success"),
      "return"
    );
    const viaWebhook = await provider().handleCallback!(
      ENV,
      webhookRequest({ paymentID: "TR001" }),
      "webhook"
    );

    // `(provider, providerEventId)` is the `billing_events` primary key, so the second
    // arrival is an insert conflict and runs no side effect.
    assert.equal(
      (viaReturn as { event: BillingEvent }).event.providerEventId,
      (viaWebhook as { event: BillingEvent }).event.providerEventId
    );
  });

  it("ignores a notification naming a payment bKash does not recognise", async () => {
    respondWith({ statusCode: "2023", statusMessage: "not found" });

    const result = await provider().handleCallback!(
      ENV,
      webhookRequest({ paymentID: "forged" }),
      "webhook"
    );

    assert.equal(result.kind, "ignored");
  });

  it("reads the payment id out of an SNS Message envelope", async () => {
    respondWith(completed());

    await provider().handleCallback!(
      ENV,
      webhookRequest({
        Message: JSON.stringify({ paymentID: "TR001" }),
        Type: "Notification",
      }),
      "webhook"
    );

    assert.equal(calls[0].body.paymentID, "TR001");
  });

  it("refuses to fetch a SubscribeURL on a host that is not bKash's", async () => {
    const result = await provider().handleCallback!(
      ENV,
      webhookRequest({
        SubscribeURL: "https://attacker.example.test/confirm",
        Type: "SubscriptionConfirmation",
      }),
      "webhook"
    );

    assert.equal(result.kind, "ignored");
    assert.equal(calls.length, 0);
  });

  it("confirms a SubscribeURL on a bKash host", async () => {
    const result = await provider().handleCallback!(
      ENV,
      webhookRequest({
        SubscribeURL: "https://sns.ap-southeast-1.amazonaws.com/confirm",
        Type: "SubscriptionConfirmation",
      }),
      "webhook"
    );

    assert.equal(result.kind, "ignored");
    assert.equal(calls.length, 1);
  });

  it("ignores a body that is not JSON at all", async () => {
    const result = await provider().handleCallback!(
      ENV,
      new Request(
        "https://api.example.test/billing/callback/bkash-merchant/webhook",
        { body: "not json", method: "POST" }
      ),
      "webhook"
    );

    assert.equal(result.kind, "ignored");
    assert.equal(calls.length, 0);
  });

  it("ignores a path it does not serve", async () => {
    const result = await provider().handleCallback!(
      ENV,
      returnRequest(""),
      "ipn"
    );

    assert.equal(result.kind, "ignored");
  });
});

// --- the rest of the contract -------------------------------------------------------------

describe("the methods with no gateway behind them", () => {
  it("cancels and restores from the row the route read", async () => {
    storeToken(40);
    const current = {
      periodEnd: new Date(Date.now() + 10 * DAY),
      plan: "pro",
      status: "active",
    } as Subscription;

    const cancelled = await provider().cancel(ENV, CTX, {
      current,
      subject: SUBJECT,
    });
    assert.equal(cancelled?.event?.subscription?.cancelAtPeriodEnd, true);

    const restored = await provider().restore(ENV, CTX, {
      current,
      subject: SUBJECT,
    });
    assert.equal(restored?.event?.subscription?.cancelAtPeriodEnd, false);
    assert.equal(calls.length, 0);
  });

  it("refuses to cancel a subject with no live row", async () => {
    storeToken(40);
    const error = await rejects(() =>
      provider().cancel(ENV, CTX, { subject: SUBJECT })
    );

    assert.equal(error.code, "not_found");
  });

  it("returns the caller's own url for a portal that does not exist", async () => {
    const result = await provider().createPortal(ENV, CTX, {
      returnUrl: "https://admin.example.test/billing",
      subject: SUBJECT,
    });

    assert.equal(result.url, "https://admin.example.test/billing");
  });

  it("lists no invoices", async () => {
    assert.deepEqual(
      await provider().listInvoices(ENV, CTX, { subject: SUBJECT }),
      []
    );
  });

  it("validates a seat count and does nothing with it", async () => {
    await provider().setQuantity(ENV, CTX, { seats: 3, subject: SUBJECT });

    const error = await rejects(() =>
      provider().setQuantity(ENV, CTX, { seats: 0, subject: SUBJECT })
    );
    assert.equal(error.providerCode, "invalid_seats");
  });

  it("renews manually, so the renewal sweep picks its rows up", () => {
    assert.equal(provider().renewal, "manual");
    assert.equal(provider().name, "bkash-merchant");
  });
});
