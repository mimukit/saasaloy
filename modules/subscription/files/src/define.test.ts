// Tests for the vendor-blind half of packages/subscription: provider selection, the wrapping
// that keeps one error shape at the boundary, and the plan table's own rules. Like the
// queue's define.test.ts this file is repo-only — it is not in the descriptor's scaffold
// list — and it runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultPlan,
  defineSubscription,
  definePlans,
  findPlan,
} from "./define.ts";
import { SubscriptionError } from "./provider.ts";
import type {
  SubscriptionProvider,
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
  overrides: Partial<SubscriptionProvider> = {}
): SubscriptionProvider {
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

describe("createSubscription — provider selection", () => {
  it("selects the provider SUBSCRIPTION_PROVIDER names", () => {
    const subscription = defineSubscription({
      providers: [stub("console"), stub("stripe")],
    });

    assert.equal(
      subscription.create({ SUBSCRIPTION_PROVIDER: "stripe" }).provider,
      "stripe"
    );
  });

  it("throws when SUBSCRIPTION_PROVIDER is unset, rather than falling back to the only one", () => {
    const subscription = defineSubscription({ providers: [stub()] });

    assert.throws(
      () => subscription.create({}),
      /SUBSCRIPTION_PROVIDER is not set\..*Registered providers: console\./s
    );
  });

  it("throws when SUBSCRIPTION_PROVIDER names a provider that is not registered", () => {
    const subscription = defineSubscription({ providers: [stub()] });

    assert.throws(
      () => subscription.create({ SUBSCRIPTION_PROVIDER: "polar" }),
      /SUBSCRIPTION_PROVIDER is "polar", which is not registered\..*Registered providers: console\./s
    );
  });

  it("names the install command when nothing is registered at all", () => {
    const subscription = defineSubscription({ providers: [] });

    assert.throws(
      () => subscription.create({}),
      /saasaloy add subscription-console/
    );
  });
});

describe("SubscriptionError wrapping", () => {
  it("hands the provider the whole env, the host context and the input", async () => {
    const seen: unknown[] = [];
    const subscription = defineSubscription({
      providers: [
        stub("console", {
          createCheckout: (env, hostCtx, input) => {
            seen.push({ env, hostCtx, input });
            return Promise.resolve({ url: "https://example.test/checkout" });
          },
        }),
      ],
    });

    const env = {
      SUBSCRIPTION_PROVIDER: "console",
      STRIPE_SECRET_KEY: "sk_test",
    };
    const result = await subscription
      .create(env)
      .createCheckout(ctx, checkoutInput);

    assert.equal(result.url, "https://example.test/checkout");
    assert.deepEqual(seen, [{ env, hostCtx: ctx, input: checkoutInput }]);
  });

  it("wraps a raw throw as provider_error, keeping the cause", async () => {
    const raw = new TypeError("fetch failed");
    const subscription = defineSubscription({
      providers: [
        stub("console", { createCheckout: () => Promise.reject(raw) }),
      ],
    });

    await assert.rejects(
      () =>
        subscription
          .create({ SUBSCRIPTION_PROVIDER: "console" })
          .createCheckout(ctx, checkoutInput),
      (error: unknown) =>
        error instanceof SubscriptionError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.cause === raw &&
        /console: createCheckout failed/.test(error.message)
    );
  });

  it("wraps a synchronous throw too, not only a rejected promise", async () => {
    const subscription = defineSubscription({
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
        subscription
          .create({ SUBSCRIPTION_PROVIDER: "console" })
          .createPortal(ctx, { returnUrl: "https://example.test", subject }),
      (error: unknown) =>
        error instanceof SubscriptionError && error.code === "provider_error"
    );
  });

  it("re-throws a SubscriptionError the provider raised, untouched", async () => {
    const mapped = new SubscriptionError("card_declined", "card declined", {
      providerCode: "card_declined",
      retryable: false,
    });
    const subscription = defineSubscription({
      providers: [
        stub("console", { createCheckout: () => Promise.reject(mapped) }),
      ],
    });

    await assert.rejects(
      () =>
        subscription
          .create({ SUBSCRIPTION_PROVIDER: "console" })
          .createCheckout(ctx, checkoutInput),
      (error: unknown) => error === mapped
    );
  });

  it("wraps every contract method, not only checkout", async () => {
    const raw = new Error("down");
    const failing = (): Promise<never> => Promise.reject(raw);
    const subscription = defineSubscription({
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
    const client = subscription.create({ SUBSCRIPTION_PROVIDER: "console" });

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
          error instanceof SubscriptionError && error.code === "provider_error"
      );
    }
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
        error instanceof SubscriptionError &&
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
        error instanceof SubscriptionError &&
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
        error instanceof SubscriptionError &&
        /share the id "free"/.test(error.message)
    );
  });

  it("findPlan names the registered ids when the id is unknown", () => {
    const plans = definePlans([{ id: "free", name: "Free" }]);

    assert.equal(findPlan(plans, "free").name, "Free");
    assert.throws(
      () => findPlan(plans, "enterprise"),
      (error: unknown) =>
        error instanceof SubscriptionError &&
        error.code === "not_found" &&
        /Registered plans: free\./.test(error.message)
    );
  });
});
