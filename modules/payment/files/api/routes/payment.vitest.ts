import { testDatabase } from "@repo/db/testing";
import { createPayment } from "@repo/payment";
import type { PaymentEnv } from "@repo/payment";
import { env as workerEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../index";
import { createPaymentStore, withPaymentStore } from "../payment-store";

// The route test for `/payment/callback/:provider/*`, run under `payment-console`. It runs
// against the test database the database driver prepares, seeded from
// `packages/db/src/seed/slices/`, so it needs no vendor account and no network.
//
// A callback carries no session: the provider that receives it verifies it, so the route
// has no `401` or `403` case. This file covers the success path (the console checkout's
// Pay button settles the payment and redirects to the return URL), `404` for a provider
// that is not listed, and `400` for a callback with no form.

const database = testDatabase();

const APP = "http://localhost:3002";

/** The Worker's environment, this file's database, and the console provider. */
function env(): PaymentEnv & Record<string, unknown> {
  return {
    ...(workerEnv as object),
    ...database.env,
    PAYMENT_APP_URL: APP,
    PAYMENT_PROVIDER: "console",
  };
}

/** Start a console card payment through the core, the way a feature route would. */
function startPayment() {
  return withPaymentStore(createPaymentStore(database.db), () =>
    createPayment(env()).create({
      amount: 1500,
      currency: "USD",
      method: "card",
      referenceId: "order_1",
      referenceType: "order",
      returnUrl: `${APP}/orders/order_1`,
    })
  );
}

/** Read one payment back through the core. */
function paymentById(id: string) {
  return withPaymentStore(createPaymentStore(database.db), () =>
    createPayment(env()).get(id)
  );
}

function complete(form?: Record<string, string>) {
  return app.request(
    "/payment/callback/console/complete",
    form === undefined
      ? { method: "POST" }
      : { body: new URLSearchParams(form), method: "POST" },
    env()
  );
}

describe("/payment/callback", () => {
  it("settles a paid console checkout and redirects to the return URL", async () => {
    const { payment } = await startPayment();

    const res = await complete({ action: "pay", paymentId: payment.id });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${APP}/orders/order_1`);
    await expect(paymentById(payment.id)).resolves.toMatchObject({
      status: "successful",
    });
  });

  it("answers 404 for a provider that is not listed", async () => {
    const res = await app.request(
      "/payment/callback/nowhere/complete",
      { method: "POST" },
      env()
    );

    expect(res.status).toBe(404);
  });

  it("answers 400 for a console callback with no form", async () => {
    const res = await complete();

    expect(res.status).toBe(400);
  });
});
