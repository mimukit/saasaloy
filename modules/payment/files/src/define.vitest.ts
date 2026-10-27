// Tests for the vendor-blind half of packages/payment: provider selection from a comma
// list, the status machine and its conditional writes, the refund bound, error
// normalization, the listeners, and the returnUrl origin check. It ships as
// `src/define.test.ts` when testing is on, and `pnpm test:modules` runs it in place in
// the saasaloy repo.
//
// The database is the one fake. `memoryStore` keeps the rules `apps/api/src/payment-store.ts`
// gets from SQL: a conditional update on status, the partial unique index on
// `(provider, transaction_id_normalized)`, and the refund bound as one conditional write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkReturnUrl, definePayment } from "./define";
import { PaymentError } from "./provider";
import type {
  Payment,
  PaymentChange,
  PaymentEnv,
  PaymentListener,
  PaymentProvider,
  PaymentStatus,
} from "./provider";
import { setPaymentStoreResolver } from "./store";
import type { PaymentEventRecord, PaymentRefund, PaymentStore } from "./store";

/** A store miss. `Promise.resolve()` is `Promise<void>`, which the store's return types refuse. */
function miss(): Promise<undefined> {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- the explicit value is what types it
  return Promise.resolve(undefined);
}

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
        return miss();
      }
      row.refundedAmount += amount;
      return Promise.resolve({ ...row });
    },
    rows,
    transition(id, from, to, patch) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) {
        return miss();
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
        return miss();
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

describe("payment core", () => {
  beforeEach(() => {
    store = memoryStore();
    setPaymentStoreResolver(() => store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("provider selection", () => {
    const manual = provider("manual", { bkash: true, card: false });
    const gateway = provider("gateway", { bkash: true, card: true });
    const registry = definePayment({
      listeners: [],
      providers: [manual, gateway],
    });

    it("throws at construction when PAYMENT_PROVIDER is unset or empty", () => {
      expect(() => registry.create({})).toThrow(/PAYMENT_PROVIDER is not set/);
      expect(() => registry.create({ PAYMENT_PROVIDER: " , " })).toThrow(
        /PAYMENT_PROVIDER is not set/
      );
    });

    it("throws at construction when a listed name is not registered", () => {
      expect(() =>
        registry.create({ PAYMENT_PROVIDER: "manual,stripe" })
      ).toThrow(/names "stripe", which is not registered/);
    });

    it("picks the first listed provider that has the method available, and stores it", async () => {
      const client = registry.create({ PAYMENT_PROVIDER: "manual, gateway" });
      expect(client.providers).toStrictEqual(["manual", "gateway"]);

      const bkash = await client.create(order("bkash"));
      expect(bkash.payment.provider).toBe("manual");

      // `manual` knows `card` but has it switched off, so `gateway` takes it.
      const card = await client.create(order("card"));
      expect(card.payment.provider).toBe("gateway");
      expect(store.rows.get(card.payment.id)?.provider).toBe("gateway");
    });

    it("follows the list order, not the registration order", async () => {
      const client = registry.create({ PAYMENT_PROVIDER: "gateway,manual" });
      const { payment } = await client.create(order("bkash"));
      expect(payment.provider).toBe("gateway");
    });

    it("answers method_unavailable when no listed provider takes the method", async () => {
      const client = registry.create({ PAYMENT_PROVIDER: "manual" });
      await expect(client.create(order("card"))).rejects.toThrow(
        expect.objectContaining({
          code: "method_unavailable",
        })
      );
      expect(store.rows.size).toBe(0);
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
      expect(submittedTo).toBe("first");
    });

    it("keeps a manual provider's instructions on the row for the staff queue", async () => {
      const client = registry.create({ PAYMENT_PROVIDER: "manual" });
      const { next, payment } = await client.create(order());
      expect(next.kind).toBe("instructions");
      expect(
        (payment.providerData?.instructions as { account: unknown } | undefined)
          ?.account
      ).toStrictEqual({ label: "bKash personal", number: "01700000000" });
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
      expect(
        store.events.map((e) => [e.fromStatus, e.toStatus, e.actorUserId])
      ).toStrictEqual([
        [null, "pending", null],
        ["pending", "submitted", null],
        ["submitted", "successful", "staff_1"],
      ]);
      const row = store.rows.get(payment.id);
      expect(row?.status).toBe("successful");
      expect(row?.settledAmount).toBe(125_000);
      expect(row?.claimedAmount).toBe(125_000);
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
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      const reason: unknown = lost[0]?.reason;
      expect(reason).toBeInstanceOf(PaymentError);
      expect(reason).toHaveProperty("code", "conflict");
      // One history row for the one write that landed.
      expect(
        store.events.filter((e) => e.toStatus === "successful")
      ).toHaveLength(1);
    });

    it("refuses to confirm a payment that is not submitted", async () => {
      const { payment } = await client().create(order());
      await expect(client().confirm(payment.id)).rejects.toThrow(
        expect.objectContaining({ code: "conflict" })
      );
    });

    it("answers duplicate_transaction while the transaction id is live, and frees it on reject", async () => {
      const first = await submitted("8N7A6D5E4F");
      const { payment: second } = await client().create(order());

      // Normalization makes the lower-case copy the same claim.
      await expect(
        client().submit(second.id, { transactionId: "8n7a6d5e4f " })
      ).rejects.toThrow(
        expect.objectContaining({ code: "duplicate_transaction" })
      );
      expect(store.rows.get(second.id)?.status).toBe("pending");

      await client().reject(first.id, {
        actorUserId: "staff_1",
        note: "Not on our statement.",
        reason: "not_found",
      });
      const event = store.events.at(-1);
      expect(event?.reason).toBe("not_found");
      expect(event?.note).toBe("Not on our statement.");

      const resubmitted = await client().submit(second.id, {
        transactionId: "8n7a6d5e4f",
      });
      expect(resubmitted.status).toBe("submitted");
    });

    it("requires a known reject reason", async () => {
      const payment = await submitted();
      await expect(
        client().reject(payment.id, { reason: "because" as "other" })
      ).rejects.toThrow(expect.objectContaining({ code: "invalid_request" }));
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
      await expect(
        c.submit(payment.id, { transactionId: "x" })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
    });

    it("answers not_found for an unknown payment id", async () => {
      await expect(client().confirm("nope")).rejects.toThrow(
        expect.objectContaining({ code: "not_found" })
      );
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
      await expect(
        client().refund(payment.id, { amount: 100 })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
    });

    it("keeps the sum of refunds at or below the amount", async () => {
      const payment = await successful();
      await client().refund(payment.id, { amount: 100_000 });
      await expect(
        client().refund(payment.id, { amount: 25_001 })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
      const { payment: after } = await client().refund(payment.id, {
        amount: 25_000,
      });
      expect(after.refundedAmount).toBe(125_000);
      expect(after.status).toBe("successful");
      expect(store.refunds).toHaveLength(2);
    });

    it("stamps settledAt on success, and a refund leaves it alone", async () => {
      const payment = await successful();
      const settledAt = store.rows.get(payment.id)?.settledAt;
      expect(settledAt instanceof Date).toBeTruthy();
      const { payment: after } = await client().refund(payment.id, {
        amount: 100,
      });
      expect(after.settledAt).toBe(settledAt);
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
      await expect(c.refund(payment.id, { amount: 1000 })).rejects.toThrow(
        expect.objectContaining({
          code: "provider_error",
        })
      );
      expect(store.rows.get(payment.id)?.refundedAmount).toBe(0);
      expect(store.refunds).toHaveLength(0);
    });

    it("refuses an amount that is not a positive whole number", async () => {
      const payment = await successful();
      await expect(
        client().refund(payment.id, { amount: 1.5 })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
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
      expect(thrown).toBeInstanceOf(PaymentError);
      expect(thrown).toMatchObject({
        code: "provider_error",
        retryable: false,
      });
      expect(thrown).toHaveProperty("cause", cause);
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
      const c = definePayment({ listeners: [], providers: [declining] }).create(
        {
          PAYMENT_PROVIDER: "declining",
        }
      );
      await expect(c.create(order("card"))).rejects.toThrow(
        expect.toSatisfy((error) => error === own)
      );
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
      await expect(c.create(order("card"))).rejects.toThrow(
        "broken: create failed"
      );
      const [row] = [...store.rows.values()];
      expect(row?.status).toBe("failed");
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
      expect(seen).toStrictEqual([
        "first:none->pending",
        "second:none->pending",
        "first:pending->submitted",
        "second:pending->submitted",
      ]);
    });

    it("logs a throwing listener with the payment id, and the call still succeeds", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {
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

      expect(submitted.status).toBe("submitted");
      expect(store.rows.get(payment.id)?.status).toBe("submitted");
      expect(errors).toHaveBeenCalledTimes(2);
      expect(String(errors.mock.calls[0]?.[0])).toMatch(new RegExp(payment.id));
      // The listener after the broken one still ran.
      expect(changes.map((change) => change.to)).toStrictEqual([
        "pending",
        "submitted",
      ]);
    });
  });

  describe("returnUrl origin check", () => {
    it("accepts only http://localhost while PAYMENT_APP_URL is unset", () => {
      expect(checkReturnUrl({}, "http://localhost:3000/orders/1")).toBe(
        "http://localhost:3000/orders/1"
      );
      for (const url of [
        "https://localhost/orders/1",
        "http://evil.test/orders/1",
        "http://localhost.evil.test/",
      ]) {
        expect(() => checkReturnUrl({}, url)).toThrow(
          expect.objectContaining({ code: "invalid_request" })
        );
      }
    });

    it("accepts only PAYMENT_APP_URL's origin when it is set", () => {
      const env = { PAYMENT_APP_URL: "https://shop.example.com/account" };
      expect(checkReturnUrl(env, "https://shop.example.com/orders/1")).toBe(
        "https://shop.example.com/orders/1"
      );
      expect(() => checkReturnUrl(env, "http://localhost:3000/")).toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
      expect(() =>
        checkReturnUrl(env, "https://shop.example.com.evil.test/")
      ).toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
    });

    it("refuses create with a foreign returnUrl before writing a row", async () => {
      const c = definePayment({
        listeners: [],
        providers: [provider("manual", { bkash: true })],
      }).create({ PAYMENT_PROVIDER: "manual" });
      await expect(
        c.create({ ...order(), returnUrl: "https://evil.test/" })
      ).rejects.toThrow(expect.objectContaining({ code: "invalid_request" }));
      expect(store.rows.size).toBe(0);
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
      expect(next).toStrictEqual({
        kind: "redirect",
        url: `http://localhost:4000/payment/callback/hosted/go/${payment.id}`,
      });

      const request = new Request(`http://localhost:4000/x?id=${payment.id}`, {
        method: "POST",
      });
      await expect(
        c.handleCallback("hosted", request, "ipn")
      ).resolves.toStrictEqual({
        kind: "event",
      });
      // A replay changes nothing and appends no second event.
      await c.handleCallback("hosted", request, "ipn");
      expect(store.rows.get(payment.id)?.status).toBe("successful");
      expect(store.rows.get(payment.id)?.settledAmount).toBe(125_000);
      expect(store.events).toHaveLength(2);
    });

    it("answers not_found for a provider that is not listed", async () => {
      const c = definePayment({
        listeners: [],
        providers: [redirecting()],
      }).create(env);
      await expect(
        c.handleCallback("other", new Request("http://localhost/"), "")
      ).rejects.toThrow(expect.objectContaining({ code: "not_found" }));
    });

    it("answers callback_invalid when a provider reports on a payment it does not own", async () => {
      const reg = definePayment({
        listeners: [],
        providers: [redirecting(), provider("manual", { bkash: true })],
      });
      const c = reg.create({ ...env, PAYMENT_PROVIDER: "hosted,manual" });
      const { payment } = await c.create(order("bkash"));
      await expect(
        c.handleCallback(
          "hosted",
          new Request(`http://localhost/x?id=${payment.id}`),
          ""
        )
      ).rejects.toThrow(expect.objectContaining({ code: "callback_invalid" }));
    });
  });
});
