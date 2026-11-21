import { paymentEvents, payments } from "@repo/db/schema/payment";
import type { Db } from "@repo/db/client";
import { testDatabase } from "@repo/db/testing";
import { createPayment } from "@repo/payment";
import type { PaymentEnv } from "@repo/payment";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPaymentStore, withPaymentStore } from "./payment-store";

// The `PaymentStore` port over real Postgres, driven through the core client. It proves
// that a status change and its `payment_events` row commit together. A failed event insert
// must leave the payment where it was, not in a new status with no history row.
//
// The payment goes through the `console` provider's hosted checkout: `create` opens it,
// and the "Pay" form post moves it to `successful` outside any staff route. The failure
// comes from a trigger made inside the test's own transaction, so it rolls back with the
// test.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

/**
 * The store over the test's transaction. A transaction has the client's whole query API and
 * lacks only `$client`, so it stands in for `Db` the same way `transaction()` hands one out.
 */
function store() {
  return createPaymentStore(database.db as unknown as Db);
}

const ENV = {
  BETTER_AUTH_URL: "http://localhost:8787",
  PAYMENT_PROVIDER: "console",
} as PaymentEnv;

/** Open a console payment, then post the checkout form's "Pay". */
function payThroughConsole() {
  return withPaymentStore(store(), async () => {
    const client = createPayment(ENV);
    const { payment } = await client.create({
      amount: 125_000,
      currency: "BDT",
      method: "card",
      referenceId: "order_372",
      referenceType: "order",
    });
    const form = new FormData();
    form.set("paymentId", payment.id);
    form.set("action", "pay");
    const pay = () =>
      client.handleCallback(
        "console",
        new Request("http://localhost:8787/payment/callback/console/complete", {
          body: form,
          method: "POST",
        }),
        "complete"
      );
    return { id: payment.id, pay };
  });
}

function eventsOf(id: string) {
  return database.db
    .select({
      fromStatus: paymentEvents.fromStatus,
      toStatus: paymentEvents.toStatus,
    })
    .from(paymentEvents)
    .where(eq(paymentEvents.paymentId, id))
    .orderBy(asc(paymentEvents.createdAt));
}

async function statusOf(id: string) {
  const [row] = await database.db
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.id, id));
  return row?.status;
}

describe("a payment status change over the Postgres store", () => {
  it("writes the status and its event row together", async () => {
    const { id, pay } = await payThroughConsole();

    await withPaymentStore(store(), pay);

    await expect(statusOf(id)).resolves.toBe("successful");
    await expect(eventsOf(id)).resolves.toStrictEqual([
      { fromStatus: null, toStatus: "pending" },
      { fromStatus: "pending", toStatus: "successful" },
    ]);
  });

  it("leaves the status unchanged when the event insert fails", async () => {
    const { id, pay } = await payThroughConsole();
    await database.db.execute(sql`
      create function payment_test_fail_events() returns trigger language plpgsql as $$
      begin
        raise exception 'the payment event insert failed';
      end;
      $$
    `);
    await database.db.execute(sql`
      create trigger payment_test_fail_events before insert on payment_events
      for each row execute function payment_test_fail_events()
    `);

    await expect(withPaymentStore(store(), pay)).rejects.toThrow(
      /insert into "payment_events"/u
    );

    await expect(
      statusOf(id),
      "the failed event insert keeps the old status"
    ).resolves.toBe("pending");
    await expect(eventsOf(id)).resolves.toStrictEqual([
      { fromStatus: null, toStatus: "pending" },
    ]);
  });
});
