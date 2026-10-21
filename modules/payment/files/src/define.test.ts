// Tests for the vendor-blind half of packages/payment: provider selection from a comma
// list, the status machine and its conditional writes, the refund bound, error
// normalization, the listeners, and the returnUrl origin check. Repo-only: the descriptor
// does not ship this file. It runs on `node:test` via `pnpm test:modules`.
//
// The database is the one fake. `memoryStore` keeps the rules `apps/api/src/payment-store.ts`
// gets from SQL: a conditional update on status, the partial unique index on
// `(provider, transaction_id_normalized)`, and the refund bound as one conditional write.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { checkReturnUrl, definePayment } from "./define.ts";
import { PaymentError } from "./provider.ts";
import type {
  Payment,
  PaymentChange,
  PaymentEnv,
  PaymentListener,
  PaymentProvider,
  PaymentStatus,
} from "./provider.ts";
import { setPaymentStoreResolver } from "./store.ts";
import type {
  PaymentEventRecord,
  PaymentRefund,
  PaymentStore,
} from "./store.ts";

interface MemoryStore extends PaymentStore {
  rows: Map<string, Payment>;
  events: PaymentEventRecord[];
  refunds: PaymentRefund[];
}

function memoryStore(): MemoryStore {
  const rows = new Map<string, Payment>();
  const events: PaymentEventRecord[] = [];
  const refunds: PaymentRefund[] = [];

  const claimed = (name: string, normalized: string, except: string) =>
    [...rows.values()].some(
      (row) =>
        row.id !== except &&
        row.provider === name &&
        row.transactionIdNormalized === normalized &&
        row.status !== "failed" &&
        row.status !== "cancelled"
    );

  return {
    appendEvent(record) {
      events.push(record);
      return Promise.resolve();
    },
    events,
    findPayment(id) {
      const row = rows.get(id);
      return Promise.resolve(row ? { ...row } : undefined);
    },
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
      return Promise.resolve({ ...payment });
    },
    insertRefund(record) {
      const refund = {
        ...record,
        createdAt: new Date(),
        id: `r_${refunds.length}`,
      };
      refunds.push(refund);
      return Promise.resolve(refund);
    },
    refunds,
    releaseRefund(id, amount) {
      const row = rows.get(id);
      if (row) {
        row.refundedAmount -= amount;
      }
      return Promise.resolve();
    },
    reserveRefund(id, amount) {
      const row = rows.get(id);
      if (
        !row ||
        row.status !== "successful" ||
        row.refundedAmount + amount > row.amount
      ) {
        return Promise.resolve();
      }
      row.refundedAmount += amount;
      return Promise.resolve({ ...row });
    },
    rows,
    transition(id, from, to, patch) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) {
        return Promise.resolve();
      }
      const next = { ...row, ...patch, status: to };
      if (
        next.transactionIdNormalized &&
        to !== "failed" &&
        to !== "cancelled" &&
        claimed(next.provider, next.transactionIdNormalized, id)
      ) {
        return Promise.reject(
          new PaymentError("duplicate_transaction", "already claimed")
        );
      }
      rows.set(id, next);
      return Promise.resolve({ ...next });
    },
    updatePayment(id, patch) {
      const row = rows.get(id);
      if (!row) {
        return Promise.resolve();
      }
      Object.assign(row, patch);
      return Promise.resolve({ ...row });
    },
  };
}

/** A provider that answers every method; a test overrides the ones it cares about. */
function provider(
  name: string,
  methods: Record<string, boolean>,
  overrides: Partial<PaymentProvider> = {}
): PaymentProvider {
  return {
    create: () =>
      Promise.resolve({
        instructions: {
          account: { label: "bKash personal", number: "01700000000" },
          fields: [{ id: "transactionId", label: "Transaction ID" }],
        },
        kind: "instructions",
      }),
    methods: () =>
      Object.entries(methods).map(([id, available]) => ({
        available,
        id,
        label: id,
      })),
    name,
    refund: () => Promise.resolve({ providerRefundId: null }),
    submit: (_env, _payment, input) =>
      Promise.resolve({
        claimedAmount: input.amount ?? null,
        senderAccount: input.senderAccount ?? null,
        transactionId: input.transactionId ?? "",
        transactionIdNormalized: (input.transactionId ?? "")
          .trim()
          .toUpperCase(),
      }),
    ...overrides,
  };
}

const order = (method = "bkash") => ({
  amount: 125_000,
  currency: "bdt",
  method,
  referenceId: "o_1",
  referenceType: "order",
  userId: "u_1",
});

let store: MemoryStore;

beforeEach(() => {
  store = memoryStore();
  setPaymentStoreResolver(() => store);
});

afterEach(() => {
  mock.restoreAll();
});

describe("provider selection", () => {
  const manual = provider("manual", { bkash: true, card: false });
  const gateway = provider("gateway", { bkash: true, card: true });
  const registry = definePayment({
    listeners: [],
    providers: [manual, gateway],
  });

  it("throws at construction when PAYMENT_PROVIDER is unset or empty", () => {
    assert.throws(() => registry.create({}), /PAYMENT_PROVIDER is not set/);
    assert.throws(
      () => registry.create({ PAYMENT_PROVIDER: " , " }),
      /PAYMENT_PROVIDER is not set/
    );
  });

  it("throws at construction when a listed name is not registered", () => {
    assert.throws(
      () => registry.create({ PAYMENT_PROVIDER: "manual,stripe" }),
      /names "stripe", which is not registered/
    );
  });

  it("picks the first listed provider that has the method available, and stores it", async () => {
    const client = registry.create({ PAYMENT_PROVIDER: "manual, gateway" });
    assert.deepEqual(client.providers, ["manual", "gateway"]);

    const bkash = await client.create(order("bkash"));
    assert.equal(bkash.payment.provider, "manual");

    // `manual` knows `card` but has it switched off, so `gateway` takes it.
    const card = await client.create(order("card"));
    assert.equal(card.payment.provider, "gateway");
    assert.equal(store.rows.get(card.payment.id)?.provider, "gateway");
  });

  it("follows the list order, not the registration order", async () => {
    const client = registry.create({ PAYMENT_PROVIDER: "gateway,manual" });
    const { payment } = await client.create(order("bkash"));
    assert.equal(payment.provider, "gateway");
  });

  it("answers method_unavailable when no listed provider takes the method", async () => {
    const client = registry.create({ PAYMENT_PROVIDER: "manual" });
    await assert.rejects(client.create(order("card")), {
      code: "method_unavailable",
    });
    assert.equal(store.rows.size, 0);
  });

  it("sends every later call to the stored provider", async () => {
    let submittedTo = "";
    const first = provider(
      "first",
      { bkash: true },
      {
        submit: (_e, _p, input) => {
          submittedTo = "first";
          return Promise.resolve({
            transactionId: input.transactionId ?? "",
            transactionIdNormalized: "X1",
          });
        },
      }
    );
    const second = provider(
      "second",
      { bkash: true },
      {
        submit: () => {
          submittedTo = "second";
          return Promise.resolve({
            transactionId: "",
            transactionIdNormalized: "X2",
          });
        },
      }
    );
    const reg = definePayment({ listeners: [], providers: [first, second] });
    const { payment } = await reg
      .create({ PAYMENT_PROVIDER: "first,second" })
      .create(order());

    // The list order flips, and the payment still goes to the provider that took it.
    await reg
      .create({ PAYMENT_PROVIDER: "second,first" })
      .submit(payment.id, { transactionId: "x1" });
    assert.equal(submittedTo, "first");
  });

  it("keeps a manual provider's instructions on the row for the staff queue", async () => {
    const client = registry.create({ PAYMENT_PROVIDER: "manual" });
    const { next, payment } = await client.create(order());
    assert.equal(next.kind, "instructions");
    assert.deepEqual(
      (payment.providerData?.instructions as { account: unknown } | undefined)
        ?.account,
      { label: "bKash personal", number: "01700000000" }
    );
  });
});

describe("the status machine", () => {
  const manual = provider("manual", { bkash: true });
  const env: PaymentEnv = { PAYMENT_PROVIDER: "manual" };
  const client = () =>
    definePayment({ listeners: [], providers: [manual] }).create(env);

  const submitted = async (transactionId = "8n7a6d5e4f") => {
    const { payment } = await client().create(order());
    return client().submit(payment.id, {
      amount: 125_000,
      senderAccount: "01811111111",
      transactionId,
    });
  };

  it("records an event for the creation and for every status change", async () => {
    const payment = await submitted();
    await client().confirm(payment.id, { actorUserId: "staff_1" });
    assert.deepEqual(
      store.events.map((e) => [e.fromStatus, e.toStatus, e.actorUserId]),
      [
        [null, "pending", null],
        ["pending", "submitted", null],
        ["submitted", "successful", "staff_1"],
      ]
    );
    const row = store.rows.get(payment.id);
    assert.equal(row?.status, "successful");
    assert.equal(row?.settledAmount, 125_000);
    assert.equal(row?.claimedAmount, 125_000);
  });

  it("gives two racing confirms one success and one conflict", async () => {
    const payment = await submitted();
    const results = await Promise.allSettled([
      client().confirm(payment.id, { actorUserId: "staff_1" }),
      client().confirm(payment.id, { actorUserId: "staff_2" }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    const reason: unknown = lost[0]?.reason;
    assert.ok(reason instanceof PaymentError);
    assert.equal(reason.code, "conflict");
    // One history row for the one write that landed.
    assert.equal(
      store.events.filter((e) => e.toStatus === "successful").length,
      1
    );
  });

  it("refuses to confirm a payment that is not submitted", async () => {
    const { payment } = await client().create(order());
    await assert.rejects(client().confirm(payment.id), { code: "conflict" });
  });

  it("answers duplicate_transaction while the transaction id is live, and frees it on reject", async () => {
    const first = await submitted("8N7A6D5E4F");
    const { payment: second } = await client().create(order());

    // Normalization makes the lower-case copy the same claim.
    await assert.rejects(
      client().submit(second.id, { transactionId: "8n7a6d5e4f " }),
      { code: "duplicate_transaction" }
    );
    assert.equal(store.rows.get(second.id)?.status, "pending");

    await client().reject(first.id, {
      actorUserId: "staff_1",
      note: "Not on our statement.",
      reason: "not_found",
    });
    const event = store.events.at(-1);
    assert.equal(event?.reason, "not_found");
    assert.equal(event?.note, "Not on our statement.");

    const resubmitted = await client().submit(second.id, {
      transactionId: "8n7a6d5e4f",
    });
    assert.equal(resubmitted.status, "submitted");
  });

  it("requires a known reject reason", async () => {
    const payment = await submitted();
    await assert.rejects(
      client().reject(payment.id, { reason: "because" as "other" }),
      { code: "invalid_request" }
    );
  });

  it("answers invalid_request for submit on a provider without submit", async () => {
    const { submit: _drop, ...rest } = provider("gateway", { card: true });
    const gateway: PaymentProvider = {
      ...rest,
      create: () =>
        Promise.resolve({ kind: "redirect", url: "https://pay.test/x" }),
    };
    const c = definePayment({ listeners: [], providers: [gateway] }).create({
      PAYMENT_PROVIDER: "gateway",
    });
    const { payment } = await c.create(order("card"));
    await assert.rejects(c.submit(payment.id, { transactionId: "x" }), {
      code: "invalid_request",
    });
  });

  it("answers not_found for an unknown payment id", async () => {
    await assert.rejects(client().confirm("nope"), { code: "not_found" });
  });
});

describe("refunds", () => {
  const manual = provider("manual", { bkash: true });
  const client = () =>
    definePayment({ listeners: [], providers: [manual] }).create({
      PAYMENT_PROVIDER: "manual",
    });

  const successful = async () => {
    const { payment } = await client().create(order());
    await client().submit(payment.id, { transactionId: `t-${payment.id}` });
    return client().confirm(payment.id);
  };

  it("refuses a refund on a payment that is not successful", async () => {
    const { payment } = await client().create(order());
    await assert.rejects(client().refund(payment.id, { amount: 100 }), {
      code: "invalid_request",
    });
  });

  it("keeps the sum of refunds at or below the amount", async () => {
    const payment = await successful();
    await client().refund(payment.id, { amount: 100_000 });
    await assert.rejects(client().refund(payment.id, { amount: 25_001 }), {
      code: "invalid_request",
    });
    const { payment: after } = await client().refund(payment.id, {
      amount: 25_000,
    });
    assert.equal(after.refundedAmount, 125_000);
    assert.equal(after.status, "successful");
    assert.equal(store.refunds.length, 2);
  });

  it("stamps settledAt on success, and a refund leaves it alone", async () => {
    const payment = await successful();
    const settledAt = store.rows.get(payment.id)?.settledAt;
    assert.ok(settledAt instanceof Date);
    const { payment: after } = await client().refund(payment.id, {
      amount: 100,
    });
    assert.equal(after.settledAt, settledAt);
  });

  it("releases the reservation when the provider refuses the refund", async () => {
    const refusing = provider(
      "manual",
      { bkash: true },
      {
        refund: () => Promise.reject(new Error("socket hang up")),
      }
    );
    const payment = await successful();
    const c = definePayment({ listeners: [], providers: [refusing] }).create({
      PAYMENT_PROVIDER: "manual",
    });
    await assert.rejects(c.refund(payment.id, { amount: 1000 }), {
      code: "provider_error",
    });
    assert.equal(store.rows.get(payment.id)?.refundedAmount, 0);
    assert.equal(store.refunds.length, 0);
  });

  it("refuses an amount that is not a positive whole number", async () => {
    const payment = await successful();
    await assert.rejects(client().refund(payment.id, { amount: 1.5 }), {
      code: "invalid_request",
    });
  });
});

describe("error normalization", () => {
  it("wraps a raw provider throw as provider_error, not retryable, cause kept", async () => {
    const cause = new TypeError("fetch failed");
    const broken = provider(
      "broken",
      { card: true },
      {
        create: () => Promise.reject(cause),
      }
    );
    const c = definePayment({ listeners: [], providers: [broken] }).create({
      PAYMENT_PROVIDER: "broken",
    });
    const thrown = await c
      .create(order("card"))
      .catch((error: unknown) => error);
    assert.ok(thrown instanceof PaymentError);
    assert.equal(thrown.code, "provider_error");
    assert.equal(thrown.retryable, false);
    assert.equal(thrown.cause, cause);
  });

  it("re-throws a provider's own PaymentError untouched", async () => {
    const own = new PaymentError("declined", "card declined", {
      providerCode: "do_not_honor",
    });
    const declining = provider(
      "declining",
      { card: true },
      {
        create: () => Promise.reject(own),
      }
    );
    const c = definePayment({ listeners: [], providers: [declining] }).create({
      PAYMENT_PROVIDER: "declining",
    });
    await assert.rejects(c.create(order("card")), (error) => error === own);
  });

  it("closes the row as failed when the provider's create throws", async () => {
    const broken = provider(
      "broken",
      { card: true },
      {
        create: () => Promise.reject(new Error("down")),
      }
    );
    const c = definePayment({ listeners: [], providers: [broken] }).create({
      PAYMENT_PROVIDER: "broken",
    });
    await assert.rejects(c.create(order("card")));
    const [row] = [...store.rows.values()];
    assert.equal(row?.status, "failed");
  });
});

describe("listeners", () => {
  it("awaits every listener in order with the change", async () => {
    const seen: string[] = [];
    const first: PaymentListener = async (_env, change) => {
      await Promise.resolve();
      seen.push(`first:${change.from ?? "none"}->${change.to}`);
    };
    const second: PaymentListener = (_env, change) => {
      seen.push(`second:${change.from ?? "none"}->${change.to}`);
    };
    const c = definePayment({
      listeners: [first, second],
      providers: [provider("manual", { bkash: true })],
    }).create({ PAYMENT_PROVIDER: "manual" });
    const { payment } = await c.create(order());
    await c.submit(payment.id, { transactionId: "abc" });
    assert.deepEqual(seen, [
      "first:none->pending",
      "second:none->pending",
      "first:pending->submitted",
      "second:pending->submitted",
    ]);
  });

  it("logs a throwing listener with the payment id, and the call still succeeds", async () => {
    const errors = mock.method(console, "error", () => {
      // Silenced: the assertion below reads the call.
    });
    const changes: PaymentChange[] = [];
    const c = definePayment({
      listeners: [
        () => {
          throw new Error("mailer down");
        },
        (_env, change) => {
          changes.push(change);
        },
      ],
      providers: [provider("manual", { bkash: true })],
    }).create({ PAYMENT_PROVIDER: "manual" });

    const { payment } = await c.create(order());
    const submitted = await c.submit(payment.id, { transactionId: "abc" });

    assert.equal(submitted.status, "submitted");
    assert.equal(store.rows.get(payment.id)?.status, "submitted");
    assert.equal(errors.mock.callCount(), 2);
    assert.match(
      String(errors.mock.calls[0]?.arguments[0]),
      new RegExp(payment.id)
    );
    // The listener after the broken one still ran.
    assert.deepEqual(
      changes.map((change) => change.to),
      ["pending", "submitted"]
    );
  });
});

describe("returnUrl origin check", () => {
  it("accepts only http://localhost while PAYMENT_APP_URL is unset", () => {
    assert.equal(
      checkReturnUrl({}, "http://localhost:3000/orders/1"),
      "http://localhost:3000/orders/1"
    );
    for (const url of [
      "https://localhost/orders/1",
      "http://evil.test/orders/1",
      "http://localhost.evil.test/",
    ]) {
      assert.throws(() => checkReturnUrl({}, url), { code: "invalid_request" });
    }
  });

  it("accepts only PAYMENT_APP_URL's origin when it is set", () => {
    const env = { PAYMENT_APP_URL: "https://shop.example.com/account" };
    assert.equal(
      checkReturnUrl(env, "https://shop.example.com/orders/1"),
      "https://shop.example.com/orders/1"
    );
    assert.throws(() => checkReturnUrl(env, "http://localhost:3000/"), {
      code: "invalid_request",
    });
    assert.throws(
      () => checkReturnUrl(env, "https://shop.example.com.evil.test/"),
      {
        code: "invalid_request",
      }
    );
  });

  it("refuses create with a foreign returnUrl before writing a row", async () => {
    const c = definePayment({
      listeners: [],
      providers: [provider("manual", { bkash: true })],
    }).create({ PAYMENT_PROVIDER: "manual" });
    await assert.rejects(
      c.create({ ...order(), returnUrl: "https://evil.test/" }),
      { code: "invalid_request" }
    );
    assert.equal(store.rows.size, 0);
  });
});

describe("callbacks", () => {
  const redirecting = (status: PaymentStatus = "successful") =>
    provider(
      "hosted",
      { card: true },
      {
        create: (_env, input) =>
          Promise.resolve({
            kind: "redirect",
            url: input.callbackUrl(`go/${input.payment.id}`),
          }),
        handleCallback: (_env, request) => {
          const id = new URL(request.url).searchParams.get("id") ?? "";
          return Promise.resolve({
            kind: "event",
            outcome: {
              paymentId: id,
              settledAmount: 125_000,
              status: status as "successful",
            },
          });
        },
      }
    );

  const env = {
    BETTER_AUTH_URL: "http://localhost:4000",
    PAYMENT_PROVIDER: "hosted",
  };

  it("builds the redirect on the api origin and applies a verdict once", async () => {
    const c = definePayment({
      listeners: [],
      providers: [redirecting()],
    }).create(env);
    const { next, payment } = await c.create(order("card"));
    assert.deepEqual(next, {
      kind: "redirect",
      url: `http://localhost:4000/payment/callback/hosted/go/${payment.id}`,
    });

    const request = new Request(`http://localhost:4000/x?id=${payment.id}`, {
      method: "POST",
    });
    assert.deepEqual(await c.handleCallback("hosted", request, "ipn"), {
      kind: "event",
    });
    // A replay changes nothing and appends no second event.
    await c.handleCallback("hosted", request, "ipn");
    assert.equal(store.rows.get(payment.id)?.status, "successful");
    assert.equal(store.rows.get(payment.id)?.settledAmount, 125_000);
    assert.equal(store.events.length, 2);
  });

  it("answers not_found for a provider that is not listed", async () => {
    const c = definePayment({
      listeners: [],
      providers: [redirecting()],
    }).create(env);
    await assert.rejects(
      c.handleCallback("other", new Request("http://localhost/"), ""),
      { code: "not_found" }
    );
  });

  it("answers callback_invalid when a provider reports on a payment it does not own", async () => {
    const reg = definePayment({
      listeners: [],
      providers: [redirecting(), provider("manual", { bkash: true })],
    });
    const c = reg.create({ ...env, PAYMENT_PROVIDER: "hosted,manual" });
    const { payment } = await c.create(order("bkash"));
    await assert.rejects(
      c.handleCallback(
        "hosted",
        new Request(`http://localhost/x?id=${payment.id}`),
        ""
      ),
      { code: "callback_invalid" }
    );
  });
});
