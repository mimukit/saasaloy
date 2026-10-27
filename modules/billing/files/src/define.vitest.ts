// Tests for the vendor-blind half of packages/billing: provider selection, the wrapping
// that keeps one error shape at the boundary, and the plan table's own rules. It ships as
// `define.test.ts` when testing is on, and `pnpm test:modules` runs it in place on Vitest
// in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { defaultPlan, defineBilling, definePlans, findPlan } from "./define";
import { BillingError } from "./provider";
import type {
  BillingProvider,
  CheckoutResult,
  HostContext,
  Invoice,
} from "./provider";

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

    expect(billing.create({ BILLING_PROVIDER: "stripe" }).provider).toBe(
      "stripe"
    );
  });

  it("throws when BILLING_PROVIDER is unset, rather than falling back to the only one", () => {
    const billing = defineBilling({ providers: [stub()] });

    expect(() => billing.create({})).toThrow(
      /BILLING_PROVIDER is not set\..*Registered providers: console\./s
    );
  });

  it("throws when BILLING_PROVIDER names a provider that is not registered", () => {
    const billing = defineBilling({ providers: [stub()] });

    expect(() => billing.create({ BILLING_PROVIDER: "polar" })).toThrow(
      /BILLING_PROVIDER is "polar", which is not registered\..*Registered providers: console\./s
    );
  });

  it("names the install command when nothing is registered at all", () => {
    const billing = defineBilling({ providers: [] });

    expect(() => billing.create({})).toThrow(/saasaloy add billing-console/);
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

    expect(result.url).toBe("https://example.test/checkout");
    expect(seen).toStrictEqual([{ env, hostCtx: ctx, input: checkoutInput }]);
  });

  it("wraps a raw throw as provider_error, keeping the cause", async () => {
    const raw = new TypeError("fetch failed");
    const billing = defineBilling({
      providers: [
        stub("console", { createCheckout: () => Promise.reject(raw) }),
      ],
    });

    await expect(() =>
      billing
        .create({ BILLING_PROVIDER: "console" })
        .createCheckout(ctx, checkoutInput)
    ).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError &&
          error.code === "provider_error" &&
          error.retryable === false &&
          error.cause === raw &&
          /console: createCheckout failed/.test(error.message)
      )
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

    await expect(() =>
      billing
        .create({ BILLING_PROVIDER: "console" })
        .createPortal(ctx, { returnUrl: "https://example.test", subject })
    ).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError && error.code === "provider_error"
      )
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

    await expect(() =>
      billing
        .create({ BILLING_PROVIDER: "console" })
        .createCheckout(ctx, checkoutInput)
    ).rejects.toThrow(expect.toSatisfy((error: unknown) => error === mapped));
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
      await expect(call).rejects.toThrow(
        expect.toSatisfy(
          (error: unknown) =>
            error instanceof BillingError && error.code === "provider_error"
        )
      );
    }
  });
});

describe(definePlans, () => {
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

    expect(plans.map((plan) => [plan.id, plan.isDefault])).toStrictEqual([
      ["free", true],
      ["pro", false],
    ]);
    expect(plans[0]?.features).toStrictEqual({});
    expect(plans[0]?.limits).toStrictEqual({});
    expect(plans[1]?.trialDays).toBe(14);
    expect(defaultPlan(plans).id).toBe("free");
  });

  it("refuses a list with no default plan", () => {
    expect(() =>
      definePlans([
        {
          id: "pro",
          name: "Pro",
          providerIds: { stripe: { monthly: "price_1" } },
        },
      ])
    ).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError &&
          error.code === "invalid_request" &&
          /No default plan/.test(error.message)
      )
    );
  });

  it("refuses a list with two default plans", () => {
    expect(() =>
      definePlans([
        { id: "free", name: "Free" },
        { id: "starter", name: "Starter" },
      ])
    ).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError &&
          /More than one default/.test(error.message)
      )
    );
  });

  it("refuses two plans sharing an id", () => {
    expect(() =>
      definePlans([
        { id: "free", name: "Free" },
        {
          id: "free",
          name: "Free again",
          providerIds: { stripe: { monthly: "price_1" } },
        },
      ])
    ).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError &&
          /share the id "free"/.test(error.message)
      )
    );
  });

  it("findPlan names the registered ids when the id is unknown", () => {
    const plans = definePlans([{ id: "free", name: "Free" }]);

    expect(findPlan(plans, "free").name).toBe("Free");
    expect(() => findPlan(plans, "enterprise")).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError &&
          error.code === "not_found" &&
          /Registered plans: free\./.test(error.message)
      )
    );
  });
});
