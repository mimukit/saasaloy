// Tests for the vendor-blind half of packages/billing: provider selection, the wrapping
// that keeps one error shape at the boundary, and the plan table's own rules. Like the
// queue's define.test.ts this file is repo-only — it is not in the descriptor's scaffold
// list — and it runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPlan, defineBilling, definePlans, findPlan } from "./define.ts";
import { BillingError } from "./provider.ts";
import type {
  BillingProvider,
  CheckoutResult,
  HostContext,
  Invoice,
} from "./provider.ts";

const ctx: HostContext = { auth: null, headers: new Headers() };
const subject = { customerType: "user", referenceId: "user_1" };
const checkoutInput = {
  cancelUrl: "https://example.test/cancel",
  interval: "monthly" as const,
  planId: "pro",
  subject,
  successUrl: "https://example.test/ok",
};

/** A provider that answers every method, so a test can override just the one it cares about. */
function stub(
  name = "console",
  overrides: Partial<BillingProvider> = {}
): BillingProvider {
  return {
    cancel: () => Promise.resolve({ url: "https://example.test/subscription" }),
    changePlan: () => Promise.resolve({ url: "https://example.test/change" }),
    createCheckout: (): Promise<CheckoutResult> =>
      Promise.resolve({ url: "https://example.test/checkout" }),
    createPortal: () => Promise.resolve({ url: "https://example.test/portal" }),
    listInvoices: (): Promise<Invoice[]> => Promise.resolve([]),
    name,
    restore: () =>
      Promise.resolve({ url: "https://example.test/subscription" }),
    setQuantity: () => Promise.resolve(),
    ...overrides,
  };
}

describe("createBilling — provider selection", () => {
  it("selects the provider BILLING_PROVIDER names", () => {
    const billing = defineBilling({
      providers: [stub("console"), stub("stripe")],
    });

    assert.equal(
      billing.create({ BILLING_PROVIDER: "stripe" }).provider,
      "stripe"
    );
  });

  it("throws when BILLING_PROVIDER is unset, rather than falling back to the only one", () => {
    const billing = defineBilling({ providers: [stub()] });

    assert.throws(
      () => billing.create({}),
      /BILLING_PROVIDER is not set\..*Registered providers: console\./s
    );
  });

  it("throws when BILLING_PROVIDER names a provider that is not registered", () => {
    const billing = defineBilling({ providers: [stub()] });

    assert.throws(
      () => billing.create({ BILLING_PROVIDER: "polar" }),
      /BILLING_PROVIDER is "polar", which is not registered\..*Registered providers: console\./s
    );
  });

  it("names the install command when nothing is registered at all", () => {
    const billing = defineBilling({ providers: [] });

    assert.throws(() => billing.create({}), /saasaloy add billing-console/);
  });
});

describe("BillingError wrapping", () => {
  it("hands the provider the whole env, the host context and the input", async () => {
    const seen: unknown[] = [];
    const billing = defineBilling({
      providers: [
        stub("console", {
          createCheckout: (env, hostCtx, input) => {
            seen.push({ env, hostCtx, input });
            return Promise.resolve({ url: "https://example.test/checkout" });
          },
        }),
      ],
    });

    const env = { BILLING_PROVIDER: "console", STRIPE_SECRET_KEY: "sk_test" };
    const result = await billing.create(env).createCheckout(ctx, checkoutInput);

    assert.equal(result.url, "https://example.test/checkout");
    assert.deepEqual(seen, [{ env, hostCtx: ctx, input: checkoutInput }]);
  });

  it("wraps a raw throw as provider_error, keeping the cause", async () => {
    const raw = new TypeError("fetch failed");
    const billing = defineBilling({
      providers: [
        stub("console", { createCheckout: () => Promise.reject(raw) }),
      ],
    });

    await assert.rejects(
      () =>
        billing
          .create({ BILLING_PROVIDER: "console" })
          .createCheckout(ctx, checkoutInput),
      (error: unknown) =>
        error instanceof BillingError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.cause === raw &&
        /console: createCheckout failed/.test(error.message)
    );
  });

  it("wraps a synchronous throw too, not only a rejected promise", async () => {
    const billing = defineBilling({
      providers: [
        stub("console", {
          createPortal: () => {
            throw new Error("boom");
          },
        }),
      ],
    });

    await assert.rejects(
      () =>
        billing
          .create({ BILLING_PROVIDER: "console" })
          .createPortal(ctx, { returnUrl: "https://example.test", subject }),
      (error: unknown) =>
        error instanceof BillingError && error.code === "provider_error"
    );
  });

  it("re-throws a BillingError the provider raised, untouched", async () => {
    const mapped = new BillingError("card_declined", "card declined", {
      providerCode: "card_declined",
      retryable: false,
    });
    const billing = defineBilling({
      providers: [
        stub("console", { createCheckout: () => Promise.reject(mapped) }),
      ],
    });

    await assert.rejects(
      () =>
        billing
          .create({ BILLING_PROVIDER: "console" })
          .createCheckout(ctx, checkoutInput),
      (error: unknown) => error === mapped
    );
  });

  it("wraps every contract method, not only checkout", async () => {
    const raw = new Error("down");
    const failing = (): Promise<never> => Promise.reject(raw);
    const billing = defineBilling({
      providers: [
        stub("console", {
          cancel: failing,
          changePlan: failing,
          listInvoices: failing,
          restore: failing,
          setQuantity: failing,
        }),
      ],
    });
    const client = billing.create({ BILLING_PROVIDER: "console" });

    const calls: (() => Promise<unknown>)[] = [
      () => client.cancel(ctx, { subject }),
      () => client.restore(ctx, { subject }),
      () => client.changePlan(ctx, { ...checkoutInput }),
      () => client.setQuantity(ctx, { seats: 3, subject }),
      () => client.listInvoices(ctx, { subject }),
    ];

    for (const call of calls) {
      await assert.rejects(
        call,
        (error: unknown) =>
          error instanceof BillingError && error.code === "provider_error"
      );
    }
  });
});

describe("the callback surface", () => {
  const event = {
    occurredAt: new Date("2026-09-21T00:00:00.000Z"),
    provider: "gateway",
    providerEventId: "val_1",
    subject,
    type: "payment.succeeded" as const,
  };

  it("reports no callback surface for a provider that declares none", () => {
    const client = defineBilling({ providers: [stub("console")] }).create({
      BILLING_PROVIDER: "console",
    });

    assert.equal(client.handlesCallbacks, false);
  });

  it("throws not_found rather than crashing when the provider has no handler", async () => {
    const client = defineBilling({ providers: [stub("console")] }).create({
      BILLING_PROVIDER: "console",
    });

    await assert.rejects(
      () => client.handleCallback(new Request("https://api.test/ipn"), "ipn"),
      (error: unknown) =>
        error instanceof BillingError &&
        error.code === "not_found" &&
        /no callback surface/.test(error.message)
    );
  });

  it("passes the request and the path through, and answers with the event", async () => {
    const seen: { path: string; method: string }[] = [];
    const client = defineBilling({
      providers: [
        stub("gateway", {
          handleCallback: (_env, request, path) => {
            seen.push({ method: request.method, path });
            return Promise.resolve({ event, kind: "event" as const });
          },
        }),
      ],
    }).create({ BILLING_PROVIDER: "gateway" });

    const result = await client.handleCallback(
      new Request("https://api.test/billing/callback/gateway/ipn", {
        method: "POST",
      }),
      "ipn"
    );

    assert.deepEqual(seen, [{ method: "POST", path: "ipn" }]);
    assert.equal(result.kind, "event");
    assert.equal(client.handlesCallbacks, true);
  });

  it("passes a redirect result through untouched", async () => {
    const client = defineBilling({
      providers: [
        stub("gateway", {
          handleCallback: () =>
            Promise.resolve({
              event,
              kind: "redirect" as const,
              url: "https://example.test/ok",
            }),
        }),
      ],
    }).create({ BILLING_PROVIDER: "gateway" });

    const result = await client.handleCallback(
      new Request("https://api.test/x"),
      "return/success"
    );

    assert.equal(result.kind, "redirect");
    assert.equal(
      result.kind === "redirect" ? result.url : "",
      "https://example.test/ok"
    );
  });

  it("wraps a raw throw from a callback handler as a BillingError", async () => {
    const client = defineBilling({
      providers: [
        stub("gateway", {
          handleCallback: () => Promise.reject(new TypeError("fetch failed")),
        }),
      ],
    }).create({ BILLING_PROVIDER: "gateway" });

    await assert.rejects(
      () => client.handleCallback(new Request("https://api.test/x"), "ipn"),
      (error: unknown) =>
        error instanceof BillingError && error.code === "provider_error"
    );
  });
});

describe("the renewal mode", () => {
  it("is `vendor` unless the provider says otherwise", () => {
    const client = defineBilling({ providers: [stub("stripe")] }).create({
      BILLING_PROVIDER: "stripe",
    });

    assert.equal(client.renewal, "vendor");
  });

  it("is `manual` when the provider declares it", () => {
    const client = defineBilling({
      providers: [stub("gateway", { renewal: "manual" })],
    }).create({ BILLING_PROVIDER: "gateway" });

    assert.equal(client.renewal, "manual");
  });
});

describe("definePlans", () => {
  it("fills the maps and marks the plan with no providerIds as the default", () => {
    const plans = definePlans([
      { id: "free", name: "Free" },
      {
        id: "pro",
        limits: { seats: 10 },
        name: "Pro",
        providerIds: { stripe: { monthly: "price_1" } },
        trialDays: 14,
      },
    ]);

    assert.deepEqual(
      plans.map((plan) => [plan.id, plan.isDefault]),
      [
        ["free", true],
        ["pro", false],
      ]
    );
    assert.deepEqual(plans[0]?.features, {});
    assert.deepEqual(plans[0]?.limits, {});
    assert.equal(plans[1]?.trialDays, 14);
    assert.equal(defaultPlan(plans).id, "free");
  });

  it("refuses a list with no default plan", () => {
    assert.throws(
      () =>
        definePlans([
          {
            id: "pro",
            name: "Pro",
            providerIds: { stripe: { monthly: "price_1" } },
          },
        ]),
      (error: unknown) =>
        error instanceof BillingError &&
        error.code === "invalid_request" &&
        /No default plan/.test(error.message)
    );
  });

  it("refuses a list with two default plans", () => {
    assert.throws(
      () =>
        definePlans([
          { id: "free", name: "Free" },
          { id: "starter", name: "Starter" },
        ]),
      (error: unknown) =>
        error instanceof BillingError &&
        /More than one default/.test(error.message)
    );
  });

  it("refuses two plans sharing an id", () => {
    assert.throws(
      () =>
        definePlans([
          { id: "free", name: "Free" },
          {
            id: "free",
            name: "Free again",
            providerIds: { stripe: { monthly: "price_1" } },
          },
        ]),
      (error: unknown) =>
        error instanceof BillingError &&
        /share the id "free"/.test(error.message)
    );
  });

  it("counts a plan priced with `price` as a paid plan, not as the default", () => {
    const plans = definePlans([
      { id: "free", name: "Free" },
      {
        id: "pro",
        name: "Pro",
        price: {
          monthly: { amount: 49_900, currency: "BDT" },
          yearly: { amount: 499_000, currency: "BDT" },
        },
      },
    ]);

    assert.equal(plans[1]?.isDefault, false);
    assert.equal(defaultPlan(plans).id, "free");
    assert.deepEqual(plans[1]?.price.monthly, {
      amount: 49_900,
      currency: "BDT",
    });
    // A plan that names no price at all still carries the empty map, so a provider reading
    // `plan.price[interval]` gets `undefined` rather than a throw.
    assert.deepEqual(plans[0]?.price, {});
  });

  it("refuses a list where every plan is priced, through either field", () => {
    assert.throws(
      () =>
        definePlans([
          {
            id: "pro",
            name: "Pro",
            price: { monthly: { amount: 49_900, currency: "BDT" } },
          },
          {
            id: "team",
            name: "Team",
            providerIds: { stripe: { monthly: "price_1" } },
          },
        ]),
      (error: unknown) =>
        error instanceof BillingError && /No default plan/.test(error.message)
    );
  });

  it("findPlan names the registered ids when the id is unknown", () => {
    const plans = definePlans([{ id: "free", name: "Free" }]);

    assert.equal(findPlan(plans, "free").name, "Free");
    assert.throws(
      () => findPlan(plans, "enterprise"),
      (error: unknown) =>
        error instanceof BillingError &&
        error.code === "not_found" &&
        /Registered plans: free\./.test(error.message)
    );
  });
});
