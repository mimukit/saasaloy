import { billingSubscriptions } from "@repo/db/schema/billing";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { env as workerEnv } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for `/billing`, run end to end under `billing-console` and
// `queue-memory`: the checkout mints a normalized event, the memory queue runs the event
// job inline, and the subscription the next request reads is the projection that job
// wrote. It runs against the test database the database driver prepares, seeded from
// `packages/db/src/seed/slices/`, so it needs no vendor account and no network.
//
// It covers the success path, `401` with no session, and `400` for a checkout with no
// plan. Billing has no `403` case: the subject a route bills is always the signed-in
// caller, so a request cannot name someone else's subscription.

const database = testDatabase();

const APP = "http://localhost:3002";
const ORIGIN = { origin: APP };

/** The Worker's environment, this file's database, and the two local providers. */
function env(): object {
  return {
    ...(workerEnv as object),
    ...database.env,
    BILLING_APP_URL: APP,
    BILLING_PROVIDER: "console",
    QUEUE_PROVIDER: "memory",
  };
}

/** Sign a seeded user in as a client and return the session cookie pair. */
async function signIn(email: string): Promise<string> {
  const res = await app.request(
    "/auth/sign-in/email",
    {
      body: JSON.stringify({ email, password: "saasaloy-dev-password" }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    env()
  );
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith("client.session_token="));
  return (line ?? "").split(";")[0] ?? "";
}

function call(path: string, cookie: string, body?: unknown) {
  return app.request(
    path,
    body === undefined
      ? { headers: { cookie, ...ORIGIN } }
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", cookie, ...ORIGIN },
          method: "POST",
        },
    env()
  );
}

const CHECKOUT = {
  cancelUrl: `${APP}/billing`,
  interval: "monthly",
  planId: "pro",
  successUrl: `${APP}/billing?checkout=done`,
};

describe("/billing", () => {
  it("subscribes the caller through checkout, and the subscription reads it back", async () => {
    // The seed gives `member` a past-due subscription, and checkout refuses a second live
    // one, so the test starts this user with none.
    await database.db
      .delete(billingSubscriptions)
      .where(eq(billingSubscriptions.referenceId, seedId("users", "member")));
    const cookie = await signIn("member@example.test");

    const checkout = await call("/billing/checkout", cookie, CHECKOUT);

    expect(checkout.status).toBe(200);
    const read = await call("/billing/subscription", cookie);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      plan: { id: string };
      subscription: { plan: string } | null;
    };
    expect(body.plan.id).toBe("pro");
    expect(body.subscription?.plan).toBe("pro");
  });

  it("answers 401 with no session", async () => {
    const res = await call("/billing/checkout", "", CHECKOUT);

    expect(res.status).toBe(401);
  });

  it("answers 400 for a checkout that names no plan", async () => {
    const cookie = await signIn("member@example.test");

    const res = await call("/billing/checkout", cookie, {
      ...CHECKOUT,
      planId: "",
    });

    expect(res.status).toBe(400);
  });
});
