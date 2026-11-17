// Tests for the SSLCOMMERZ provider: the session `create` opens, the IPN and browser
// returns `handleCallback` verifies against the gateway, and the refund API. Repo-only: the
// descriptor ships `sslcommerz.ts` and `env.ts` and nothing else. It runs on `node:test`
// via `pnpm test:modules`.
//
// `../index` resolves through the shim beside this module to the real `packages/payment`
// barrel, so the selection, the conditional update and the event rows are the ones a
// deployed Worker runs. The database is a fake, and `fetch` answers as the gateway would.
//
// The routing case loads `payment-manual` too, which imports `@repo/validators/phone`. That
// package is not installed in this repo, so the hook below maps it onto the real file in
// `modules/validators`, the way `manual.test.ts` does.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sslcommerz } from "./sslcommerz.ts";
import { definePayment, setPaymentStoreResolver } from "../index.ts";
import type {
  Payment,
  PaymentEventRecord,
  PaymentRefund,
  PaymentStore,
} from "../index.ts";

const PHONE = new URL("../../validators/files/src/phone.ts", import.meta.url)
  .href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@repo/validators/phone") {
      return { shortCircuit: true, url: PHONE };
    }
    return nextResolve(specifier, context);
  },
});

const { manual } = await import("../../payment-manual/files/manual.ts");

const ENV = {
  BETTER_AUTH_URL: "http://localhost:4000",
  PAYMENT_PROVIDER: "sslcommerz",
  SSLCOMMERZ_RECEIPT_EMAIL: "payments@example.com",
  SSLCOMMERZ_STORE_ID: "teststore",
  SSLCOMMERZ_STORE_PASSWORD: "secret",
};

const SANDBOX = "https://sandbox.sslcommerz.com";

let rows: Map<string, Payment>;
let events: PaymentEventRecord[];
let refunds: PaymentRefund[];
let calls: { url: string; init: RequestInit | undefined }[];
let gateway: (url: URL, init: RequestInit | undefined) => unknown;
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
        status: "pending",
        submittedAt: null,
        settledAt: null,
        transactionId: null,
        transactionIdNormalized: null,
        updatedAt: now,
      };
      rows.set(row.id, payment);
      return Promise.resolve(payment);
    },
    insertRefund(record) {
      const refund = { ...record, createdAt: new Date(), id: "r_1" };
      refunds.push(refund);
      return Promise.resolve(refund);
    },
    releaseRefund: () => Promise.resolve(),
    reserveRefund: (id) => Promise.resolve(rows.get(id)),
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

const client = (env: Record<string, unknown> = ENV) =>
  definePayment({ listeners: [], providers: [sslcommerz()] }).create(env);

const order = {
  amount: 125_000,
  currency: "BDT",
  method: "card",
  referenceId: "o_1",
  referenceType: "order",
  returnUrl: "http://localhost:3000/orders/o_1",
};

/** The validator's answer for a payment that went through, as the gateway writes it. */
function validAnswer(payment: Payment, overrides: Record<string, string> = {}) {
  return {
    amount: "1250.00",
    bank_tran_id: "BANK123",
    currency_amount: "1250.00",
    currency_type: "BDT",
    risk_level: "0",
    status: "VALID",
    store_amount: "1218.75",
    tran_id: payment.id,
    val_id: "VAL1",
    ...overrides,
  };
}

/** A gateway that opens every session and validates `VAL1` as `answer`. */
function gatewayWith(answer: (payment: Payment) => unknown) {
  gateway = (url) => {
    if (url.pathname === "/gwprocess/v4/api.php") {
      return {
        GatewayPageURL: `${SANDBOX}/EasyCheckOut/abc`,
        sessionkey: "abc",
        status: "SUCCESS",
      };
    }
    if (url.pathname === "/validator/api/validationserverAPI.php") {
      const payment = [...rows.values()][0];
      return url.searchParams.get("val_id") === "VAL1" && payment
        ? answer(payment)
        : { status: "INVALID_TRANSACTION" };
    }
    throw new Error(`unexpected gateway call ${url.toString()}`);
  };
}

function post(path: string, fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.set(key, value);
  }
  return new Request(
    `http://localhost:4000/payment/callback/sslcommerz/${path}`,
    { body, method: "POST" }
  );
}

/** Post an IPN the gateway's answer contradicts, and expect the payment left alone. */
async function tampered(
  fields: Record<string, string>,
  answer: Record<string, string> | undefined
): Promise<void> {
  const { payment } = await client().create(order);
  if (answer) {
    gatewayWith((p) => validAnswer(p, answer));
  }
  await assert.rejects(
    client().handleCallback(
      "sslcommerz",
      post("ipn", { status: "VALID", tran_id: payment.id, ...fields }),
      "ipn"
    ),
    { code: "callback_invalid" }
  );
  assert.equal(rows.get(payment.id)?.status, "pending");
}

beforeEach(() => {
  rows = new Map();
  events = [];
  refunds = [];
  calls = [];
  gatewayWith((payment) => validAnswer(payment));
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ init, url: url.toString() });
    try {
      return Promise.resolve(Response.json(gateway(url, init)));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  setPaymentStoreResolver(fakeStore);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("payment-sslcommerz", () => {
  it("offers card, and only when the store is configured", () => {
    assert.deepEqual(
      sslcommerz()
        .methods(ENV)
        .map((m) => [m.id, m.available]),
      [["card", true]]
    );
    assert.deepEqual(
      sslcommerz()
        .methods({})
        .map((m) => [m.id, m.available]),
      [["card", false]]
    );
  });

  it("opens a sandbox session with the payment id as tran_id and redirects to it", async () => {
    const { next, payment } = await client().create(order);
    assert.deepEqual(next, {
      kind: "redirect",
      url: `${SANDBOX}/EasyCheckOut/abc`,
    });
    const session = calls[0];
    assert.equal(session?.url, `${SANDBOX}/gwprocess/v4/api.php`);
    const form = new URLSearchParams(String(session?.init?.body));
    assert.equal(form.get("tran_id"), payment.id);
    assert.equal(form.get("total_amount"), "1250.00");
    assert.equal(form.get("currency"), "BDT");
    assert.equal(form.get("store_id"), "teststore");
    assert.equal(
      form.get("ipn_url"),
      "http://localhost:4000/payment/callback/sslcommerz/ipn"
    );
    assert.equal(
      form.get("success_url"),
      "http://localhost:4000/payment/callback/sslcommerz/return/success"
    );
    assert.equal(rows.get(payment.id)?.providerData?.sessionKey, "abc");
  });

  it("uses the live host when SSLCOMMERZ_MODE is live", async () => {
    gateway = () => ({ GatewayPageURL: "https://x/y", status: "SUCCESS" });
    await client({ ...ENV, SSLCOMMERZ_MODE: "live" }).create(order);
    assert.equal(
      calls[0]?.url,
      "https://securepay.sslcommerz.com/gwprocess/v4/api.php"
    );
  });

  it("refuses a non-BDT payment and closes the row", async () => {
    await assert.rejects(client().create({ ...order, currency: "USD" }), {
      code: "invalid_request",
    });
    assert.equal(calls.length, 0);
    assert.equal([...rows.values()][0]?.status, "failed");
  });

  it("maps a refused session onto provider_error with the gateway's reason", async () => {
    gateway = () => ({
      failedreason: "Store Credential Error",
      status: "FAILED",
    });
    await assert.rejects(client().create(order), {
      code: "provider_error",
      message: /Store Credential Error/,
      providerCode: "FAILED",
    });
  });

  it("a validated IPN moves the payment to successful with settled_amount set", async () => {
    const { payment } = await client().create(order);
    const reply = await client().handleCallback(
      "sslcommerz",
      post("ipn", { status: "VALID", tran_id: payment.id, val_id: "VAL1" }),
      "ipn"
    );
    assert.deepEqual(reply, { kind: "event" });
    const row = rows.get(payment.id);
    assert.equal(row?.status, "successful");
    assert.equal(row?.settledAmount, 125_000);
    assert.equal(row?.transactionId, "BANK123");
    assert.equal(row?.providerData?.bankTranId, "BANK123");
    assert.equal(row?.providerData?.storeAmount, "1218.75");
    const validation = new URL(calls.at(-1)?.url ?? "");
    assert.equal(validation.pathname, "/validator/api/validationserverAPI.php");
    assert.equal(validation.searchParams.get("val_id"), "VAL1");
  });

  it("ignores a replayed IPN: no second status change, no second event", async () => {
    const { payment } = await client().create(order);
    const ipn = () =>
      post("ipn", { status: "VALID", tran_id: payment.id, val_id: "VAL1" });
    await client().handleCallback("sslcommerz", ipn(), "ipn");
    gatewayWith((p) => validAnswer(p, { status: "VALIDATED" }));
    await client().handleCallback("sslcommerz", ipn(), "ipn");
    assert.equal(rows.get(payment.id)?.status, "successful");
    assert.deepEqual(
      events.map((e) => [e.fromStatus, e.toStatus]),
      [
        [null, "pending"],
        ["pending", "successful"],
      ]
    );
  });

  for (const [name, fields, answer] of [
    ["a val_id the gateway never issued", { val_id: "FORGED" }, undefined],
    [
      "an amount short of the payment",
      { val_id: "VAL1" },
      { currency_amount: "1249.99" },
    ],
    [
      "a currency other than the payment's",
      { val_id: "VAL1" },
      { currency_type: "USD" },
    ],
    [
      "a tran_id other than the validated one",
      { val_id: "VAL1" },
      { tran_id: "other" },
    ],
  ] as const) {
    it(`fails a tampered IPN with callback_invalid: ${name}`, () =>
      tampered(fields, answer));
  }

  it("fails an IPN naming a payment that is not an sslcommerz one", async () => {
    await assert.rejects(
      client().handleCallback(
        "sslcommerz",
        post("ipn", { tran_id: "nope", val_id: "VAL1" }),
        "ipn"
      ),
      { code: "callback_invalid" }
    );
  });

  it("keeps the payment pending when the validator is unreachable, and says retry", async () => {
    const { payment } = await client().create(order);
    gateway = () => {
      throw new TypeError("network down");
    };
    await assert.rejects(
      client().handleCallback(
        "sslcommerz",
        post("ipn", { tran_id: payment.id, val_id: "VAL1" }),
        "ipn"
      ),
      { code: "provider_error", retryable: true }
    );
    assert.equal(rows.get(payment.id)?.status, "pending");
  });

  it("asks the transaction query on a cancel return, then sends the browser back", async () => {
    const { payment } = await client().create(order);
    gateway = (url) => {
      assert.equal(url.searchParams.get("tran_id"), payment.id);
      return {
        APIConnect: "DONE",
        element: [{ status: "CANCELLED", tran_id: payment.id }],
      };
    };
    const reply = await client().handleCallback(
      "sslcommerz",
      post("return/cancel", { status: "CANCELLED", tran_id: payment.id }),
      "return/cancel"
    );
    assert.deepEqual(reply, { kind: "redirect", url: order.returnUrl });
    assert.equal(rows.get(payment.id)?.status, "cancelled");
  });

  it("does not believe a FAILED IPN the gateway contradicts", async () => {
    const { payment } = await client().create(order);
    gateway = () => ({
      APIConnect: "DONE",
      element: [validAnswer(payment)],
    });
    await client().handleCallback(
      "sslcommerz",
      post("ipn", { status: "FAILED", tran_id: payment.id }),
      "ipn"
    );
    assert.equal(rows.get(payment.id)?.status, "successful");
  });

  it("records a refund through the refund API with the stored bank_tran_id", async () => {
    const { payment } = await client().create(order);
    await client().handleCallback(
      "sslcommerz",
      post("ipn", { tran_id: payment.id, val_id: "VAL1" }),
      "ipn"
    );
    gateway = (url) => {
      assert.equal(
        url.pathname,
        "/validator/api/merchantTransIDvalidationAPI.php"
      );
      assert.equal(url.searchParams.get("bank_tran_id"), "BANK123");
      assert.equal(url.searchParams.get("refund_amount"), "500.00");
      return {
        APIConnect: "DONE",
        bank_tran_id: "BANK123",
        refund_ref_id: "REF9",
        status: "success",
      };
    };
    const { refund } = await client().refund(payment.id, {
      amount: 50_000,
      note: "damaged",
    });
    assert.equal(refund.providerRefundId, "REF9");
    assert.equal(refunds.length, 1);
  });

  it("maps a refused refund onto declined and records nothing", async () => {
    const { payment } = await client().create(order);
    await client().handleCallback(
      "sslcommerz",
      post("ipn", { tran_id: payment.id, val_id: "VAL1" }),
      "ipn"
    );
    gateway = () => ({
      APIConnect: "DONE",
      errorReason: "Already refunded",
      status: "failed",
    });
    await assert.rejects(client().refund(payment.id, { amount: 50_000 }), {
      code: "declined",
      message: /Already refunded/,
    });
    assert.equal(refunds.length, 0);
  });

  it("with PAYMENT_PROVIDER=manual,sslcommerz, card goes to sslcommerz and bkash to manual", async () => {
    const both = definePayment({
      listeners: [],
      providers: [
        manual({
          methods: { bkash: { account: "01712345678", kind: "personal" } },
        }),
        sslcommerz(),
      ],
    }).create({ ...ENV, PAYMENT_PROVIDER: "manual,sslcommerz" });

    const card = await both.create(order);
    assert.equal(card.payment.provider, "sslcommerz");
    assert.equal(card.next.kind, "redirect");

    const bkash = await both.create({
      ...order,
      method: "bkash",
      referenceId: "o_2",
    });
    assert.equal(bkash.payment.provider, "manual");
    assert.equal(bkash.next.kind, "instructions");
  });
});
