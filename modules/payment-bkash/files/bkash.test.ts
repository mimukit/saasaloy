// Tests for the bKash provider: checkout, the browser return, the webhook, refunds and the
// token job. Repo-only: the descriptor ships `bkash.ts` and `env.ts` and nothing else. It
// runs on `node:test` via `pnpm test:modules`.
//
// `../index` resolves through the shim beside this module to the real `packages/payment`
// barrel, so the selection, the conditional update and the event rows are the ones a
// deployed Worker runs. The database, the KV store and bKash itself are fakes: `fetch` is
// replaced for each test and answers from a route table.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  BKASH_TOKEN_JOB,
  bkash,
  bkashTokenJob,
  bkashTokenSchedule,
  runBkashToken,
} from "./bkash.ts";
import {
  definePayment,
  setPaymentProviderEnv,
  setPaymentStoreResolver,
} from "../index.ts";
import type { Payment, PaymentEventRecord, PaymentStore } from "../index.ts";
import type { KvClient } from "@repo/kv";

const ENV = {
  BETTER_AUTH_URL: "http://localhost:4000",
  BKASH_APP_KEY: "key",
  BKASH_APP_SECRET: "secret",
  BKASH_PASSWORD: "pass",
  BKASH_USERNAME: "user",
  KV_PROVIDER: "memory",
  PAYMENT_PROVIDER: "bkash",
};

const SANDBOX = "https://tokenized.sandbox.bka.sh/v1.2.0-beta";

let rows: Map<string, Payment>;
let events: PaymentEventRecord[];
let kvData: Map<string, unknown>;
let calls: { path: string; body: Record<string, string> }[];
let routes: Record<string, (body: Record<string, string>) => unknown>;
const realFetch = globalThis.fetch;

function fakeStore(): PaymentStore {
  return {
    appendEvent(record) {
      events.push(record);
      return Promise.resolve();
    },
    findPayment: (id) => Promise.resolve(rows.get(id)),
    insertPayment(row) {
      const now = new Date();
      const payment: Payment = {
        ...row,
        claimedAmount: null,
        createdAt: now,
        providerData: null,
        refundedAmount: 0,
        senderAccount: null,
        settledAmount: null,
        settledAt: null,
        status: "pending",
        submittedAt: null,
        transactionId: null,
        transactionIdNormalized: null,
        updatedAt: now,
      };
      rows.set(row.id, payment);
      return Promise.resolve(payment);
    },
    insertRefund: (record) =>
      Promise.resolve({ ...record, createdAt: new Date(), id: "r_1" }),
    releaseRefund: () => Promise.resolve(),
    reserveRefund(id, amount) {
      const row = rows.get(id);
      if (!row) {
        return Promise.resolve();
      }
      const next = { ...row, refundedAmount: row.refundedAmount + amount };
      rows.set(id, next);
      return Promise.resolve(next);
    },
    transition(id, from, to, patch) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) {
        return Promise.resolve();
      }
      const next = { ...row, ...patch, status: to };
      rows.set(id, next);
      return Promise.resolve(next);
    },
    updatePayment(id, patch) {
      const row = rows.get(id);
      if (!row) {
        return Promise.resolve();
      }
      const next = { ...row, ...patch };
      rows.set(id, next);
      return Promise.resolve(next);
    },
  };
}

/** The slice of `KvClient` the provider uses, over a Map. TTLs are ignored. */
function fakeKv(): KvClient {
  return {
    get: <T>(key: string) =>
      Promise.resolve((kvData.get(key) as T | undefined) ?? null),
    key: ({ namespace, parts }: { namespace: string; parts: string[] }) =>
      [namespace, ...parts].join(":"),
    set: (key: string, value: unknown) => {
      kvData.set(key, value);
      return Promise.resolve();
    },
  } as unknown as KvClient;
}

const deps = { store: () => fakeKv() };
const client = (env: Record<string, string> = ENV) =>
  definePayment({ listeners: [], providers: [bkash(deps)] }).create(env);

const order = {
  amount: 49_900,
  currency: "BDT",
  method: "bkash",
  referenceId: "o_1",
  referenceType: "order",
  returnUrl: "http://localhost:3000/orders/o_1",
};

function freshToken(): void {
  kvData.set("payment:bkash:token", {
    expiresAt: Date.now() + 3_600_000,
    idToken: "tok",
    refreshToken: "ref",
    refreshedAt: Date.now(),
  });
}

/** Create a payment against a create route that answers paymentID `P1`. */
async function created(): Promise<Payment> {
  routes["/tokenized/checkout/create"] = () => ({
    bkashURL: "https://sandbox.bka.sh/pay/P1",
    paymentID: "P1",
    statusCode: "0000",
  });
  const { payment } = await client().create(order);
  return payment;
}

function completed(payment: Payment, extra: Record<string, string> = {}) {
  return () => ({
    amount: "499.00",
    currency: "BDT",
    merchantInvoiceNumber: payment.id,
    paymentID: "P1",
    statusCode: "0000",
    transactionStatus: "Completed",
    trxID: "abc123",
    ...extra,
  });
}

function returning(payment: Payment, query: string) {
  return client().handleCallback(
    "bkash",
    new Request(
      `http://localhost:4000/payment/callback/bkash/return/${payment.id}?${query}`
    ),
    `return/${payment.id}`
  );
}

beforeEach(() => {
  rows = new Map();
  events = [];
  kvData = new Map();
  calls = [];
  routes = {};
  setPaymentStoreResolver(fakeStore);
  freshToken();
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.startsWith(SANDBOX) ? url.slice(SANDBOX.length) : url;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      string
    >;
    calls.push({ body, path });
    const route = routes[path];
    if (!route) {
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }
    return Promise.resolve(Response.json(route(body)));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("payment-bkash: checkout", () => {
  it("offers bkash only when configured", () => {
    assert.deepEqual(
      client()
        .methods()
        .map((m) => m.id),
      ["bkash"]
    );
    const { BKASH_APP_KEY: _key, ...missing } = ENV;
    assert.deepEqual(client(missing).methods(), []);
  });

  it("create answers bKash's page and keeps its paymentID", async () => {
    routes["/tokenized/checkout/create"] = () => ({
      bkashURL: "https://sandbox.bka.sh/pay/P1",
      paymentID: "P1",
      statusCode: "0000",
    });
    const { next, payment } = await client().create(order);
    assert.deepEqual(next, {
      kind: "redirect",
      url: "https://sandbox.bka.sh/pay/P1",
    });
    assert.equal(payment.providerData?.paymentID, "P1");
    const sent = calls[0]?.body;
    assert.equal(sent?.amount, "499.00");
    assert.equal(sent?.merchantInvoiceNumber, payment.id);
    assert.equal(
      sent?.callbackURL,
      `http://localhost:4000/payment/callback/bkash/return/${payment.id}`
    );
  });

  it("refuses a currency other than BDT and fails the row", async () => {
    await assert.rejects(client().create({ ...order, currency: "USD" }), {
      code: "invalid_request",
    });
    assert.equal([...rows.values()][0]?.status, "failed");
  });

  it("maps a create refusal onto a PaymentError with the raw code", async () => {
    routes["/tokenized/checkout/create"] = () => ({ statusCode: "2001" });
    await assert.rejects(client().create(order), {
      code: "invalid_request",
      providerCode: "2001",
    });
  });
});

describe("payment-bkash: the browser return", () => {
  it("executes a success and settles the payment from bKash's answer", async () => {
    const payment = await created();
    routes["/tokenized/checkout/execute"] = completed(payment);
    const reply = await returning(payment, "paymentID=P1&status=success");
    assert.deepEqual(reply, { kind: "redirect", url: order.returnUrl });
    const row = rows.get(payment.id);
    assert.equal(row?.status, "successful");
    assert.equal(row?.settledAmount, 49_900);
    assert.equal(row?.transactionId, "abc123");
    assert.equal(row?.transactionIdNormalized, "ABC123");
  });

  it("falls through to payment/status when execute says already completed", async () => {
    const payment = await created();
    routes["/tokenized/checkout/execute"] = () => ({ statusCode: "2062" });
    routes["/tokenized/checkout/payment/status"] = completed(payment);
    await returning(payment, "paymentID=P1&status=success");
    assert.equal(rows.get(payment.id)?.status, "successful");
  });

  it("refuses an underpayment and leaves the payment pending", async () => {
    const payment = await created();
    routes["/tokenized/checkout/execute"] = completed(payment, {
      amount: "4.99",
    });
    await assert.rejects(returning(payment, "paymentID=P1&status=success"), {
      code: "provider_error",
      providerCode: "mismatch",
    });
    assert.equal(rows.get(payment.id)?.status, "pending");
  });

  it("a cancelled checkout leaves the payment cancelled, after a status re-read", async () => {
    const payment = await created();
    routes["/tokenized/checkout/payment/status"] = () => ({
      paymentID: "P1",
      statusCode: "0000",
      transactionStatus: "Initiated",
    });
    await returning(payment, "paymentID=P1&status=cancel");
    assert.equal(rows.get(payment.id)?.status, "cancelled");
    assert.deepEqual(
      calls.map((c) => c.path),
      ["/tokenized/checkout/create", "/tokenized/checkout/payment/status"]
    );
  });

  it("a cancel that bKash reports completed settles instead", async () => {
    const payment = await created();
    routes["/tokenized/checkout/payment/status"] = completed(payment);
    await returning(payment, "paymentID=P1&status=cancel");
    assert.equal(rows.get(payment.id)?.status, "successful");
  });

  it("a failure return marks the payment failed", async () => {
    const payment = await created();
    routes["/tokenized/checkout/payment/status"] = () => ({
      statusCode: "0000",
      transactionStatus: "Initiated",
    });
    await returning(payment, "paymentID=P1&status=failure");
    assert.equal(rows.get(payment.id)?.status, "failed");
  });

  it("refuses a return whose paymentID the payment was not created with", async () => {
    const payment = await created();
    await assert.rejects(returning(payment, "paymentID=OTHER&status=cancel"), {
      code: "callback_invalid",
    });
    assert.equal(rows.get(payment.id)?.status, "pending");
  });
});

describe("payment-bkash: the webhook", () => {
  const notify = (body: unknown) =>
    client().handleCallback(
      "bkash",
      new Request("http://localhost:4000/payment/callback/bkash/webhook", {
        body: JSON.stringify(body),
        method: "POST",
      }),
      "webhook"
    );

  it("settles from a status re-read, finding the row by the echoed invoice", async () => {
    const payment = await created();
    routes["/tokenized/checkout/payment/status"] = completed(payment);
    const reply = await notify({
      Message: JSON.stringify({ paymentID: "P1" }),
    });
    assert.deepEqual(reply, { kind: "event" });
    assert.equal(rows.get(payment.id)?.status, "successful");
  });

  it("ignores a notification bKash does not recognise", async () => {
    await created();
    routes["/tokenized/checkout/payment/status"] = () => ({
      statusCode: "2056",
    });
    assert.deepEqual(await notify({ paymentID: "FORGED" }), {
      kind: "ignored",
    });
  });

  it("never fetches a SubscribeURL off a bKash host", async () => {
    const reply = await notify({
      SubscribeURL: "https://evil.example/confirm",
      Type: "SubscriptionConfirmation",
    });
    assert.deepEqual(reply, { kind: "ignored" });
    assert.equal(calls.length, 0);
  });
});

describe("payment-bkash: refunds", () => {
  it("refunds through the refund API and records bKash's refundTrxID", async () => {
    const payment = await created();
    routes["/tokenized/checkout/execute"] = completed(payment);
    await returning(payment, "paymentID=P1&status=success");
    routes["/tokenized/checkout/payment/refund"] = () => ({
      refundTrxID: "R1",
      transactionStatus: "Completed",
    });
    const { refund } = await client().refund(payment.id, {
      amount: 10_000,
      note: "damaged",
    });
    assert.equal(refund.providerRefundId, "R1");
    const sent = calls.at(-1)?.body;
    assert.deepEqual(sent, {
      amount: "100.00",
      paymentID: "P1",
      reason: "damaged",
      sku: "order",
      trxID: "abc123",
    });
  });

  it("maps a refused refund and releases the reservation", async () => {
    const payment = await created();
    routes["/tokenized/checkout/execute"] = completed(payment);
    await returning(payment, "paymentID=P1&status=success");
    routes["/tokenized/checkout/payment/refund"] = () => ({
      statusCode: "2071",
      statusMessage: "Refund failed",
    });
    await assert.rejects(client().refund(payment.id, { amount: 10_000 }), {
      code: "provider_error",
      providerCode: "2071",
    });
  });
});

describe("payment-bkash: the token job", () => {
  const now = new Date("2026-10-25T00:00:00Z");
  const stored = (msFromNow: number) =>
    kvData.set("payment:bkash:token", {
      expiresAt: now.getTime() + msFromNow,
      idToken: "old",
      refreshToken: "ref",
      refreshedAt: now.getTime(),
    });
  const granted = () => ({
    expires_in: 3600,
    id_token: "new",
    refresh_token: "ref2",
    statusCode: "0000",
  });

  it("registers a quarter-hour schedule for its own job", () => {
    assert.deepEqual(bkashTokenSchedule(), {
      cron: "*/15 * * * *",
      job: BKASH_TOKEN_JOB,
      name: "payment.bkash.token.quarter-hour",
      payload: {},
    });
    assert.equal(bkashTokenJob(deps).name, BKASH_TOKEN_JOB);
  });

  it("does nothing while the token has more than 20 minutes left", async () => {
    stored(30 * 60_000);
    assert.equal(await runBkashToken(fakeKv(), ENV, now), "none");
    assert.equal(calls.length, 0);
  });

  it("refreshes inside the 20-minute window", async () => {
    stored(10 * 60_000);
    routes["/tokenized/checkout/token/refresh"] = granted;
    assert.equal(await runBkashToken(fakeKv(), ENV, now), "refreshed");
    assert.equal(
      (kvData.get("payment:bkash:token") as { idToken: string }).idToken,
      "new"
    );
  });

  it("falls a refused refresh through to a grant", async () => {
    stored(-1);
    routes["/tokenized/checkout/token/refresh"] = () => ({
      statusCode: "2079",
    });
    routes["/tokenized/checkout/token/grant"] = granted;
    assert.equal(await runBkashToken(fakeKv(), ENV, now), "granted");
  });

  it("skips when the provider is not configured", async () => {
    assert.equal(
      await runBkashToken(fakeKv(), { KV_PROVIDER: "memory" }, now),
      "skipped"
    );
  });

  it("the registered job reads env through the provider env port", async () => {
    kvData.clear();
    routes["/tokenized/checkout/token/grant"] = granted;
    setPaymentProviderEnv(ENV);
    await bkashTokenJob(deps).run({}, {});
    assert.equal(
      (kvData.get("payment:bkash:token") as { idToken: string }).idToken,
      "new"
    );
  });

  it("a cold start grants once and a concurrent one is told to retry", async () => {
    kvData.clear();
    routes["/tokenized/checkout/token/grant"] = granted;
    routes["/tokenized/checkout/create"] = () => ({
      bkashURL: "https://sandbox.bka.sh/pay/P1",
      paymentID: "P1",
      statusCode: "0000",
    });
    kvData.set("payment:bkash:token:granting", Date.now());
    await assert.rejects(client().create(order), {
      providerCode: "token_pending",
      retryable: true,
    });
    kvData.delete("payment:bkash:token:granting");
    await client().create(order);
    assert.equal(
      calls.filter((c) => c.path === "/tokenized/checkout/token/grant").length,
      1
    );
  });
});
