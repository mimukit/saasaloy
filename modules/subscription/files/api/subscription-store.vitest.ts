import {
  subscriptionEvents,
  subscriptions,
} from "@repo/db/schema/subscription";
import { seedId } from "@repo/db/seed/id";
import type { Db } from "@repo/db/client";
import { testDatabase } from "@repo/db/testing";
import { applyEvent } from "@repo/subscription";
import type { SubscriptionEvent } from "@repo/subscription";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSubscriptionStore } from "./subscription-store";

// The `SubscriptionStore` port over real Postgres, driven through `applyEvent`. It proves
// the one promise the core makes about a failure: the dedupe row and the projection commit
// together. A failed upsert must leave no `subscription_events` row, or the vendor's
// redelivery of the same event reads as a duplicate and the projection never gets it.
//
// The failure comes from a trigger made inside the test's own transaction, so it rolls
// back with the test.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

/**
 * The store over the test's transaction. A transaction has the client's whole query API and
 * lacks only `$client`, so it stands in for `Db` the same way `transaction()` hands one out.
 */
function store() {
  return createSubscriptionStore(database.db as unknown as Db);
}

const MEMBER = seedId("users", "member");

function changed(providerEventId: string): SubscriptionEvent {
  return {
    occurredAt: new Date("2026-11-21T09:00:00.000Z"),
    provider: "console",
    providerEventId,
    subject: { customerType: "user", referenceId: MEMBER },
    subscription: {
      plan: "pro",
      providerCustomerId: "cus_test_372",
      providerSubscriptionId: "sub_test_372",
      status: "active",
    },
    type: "subscription.changed",
  };
}

function eventRows(providerEventId: string) {
  return database.db
    .select({ processedAt: subscriptionEvents.processedAt })
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.providerEventId, providerEventId));
}

describe("applyEvent over the Postgres store", () => {
  it("records the event and projects the row together", async () => {
    const result = await applyEvent(store(), changed("evt_test_ok"));

    expect(result).toMatchObject({ applied: true, duplicate: false });
    const rows = await eventRows("evt_test_ok");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processedAt).toBeInstanceOf(Date);
  });

  it("keeps no event row when the upsert fails, so the redelivery applies", async () => {
    await database.db.execute(sql`
      create function subscription_test_fail_upsert() returns trigger language plpgsql as $$
      begin
        raise exception 'the subscription upsert failed';
      end;
      $$
    `);
    await database.db.execute(sql`
      create trigger subscription_test_fail_upsert before insert on subscriptions
      for each row execute function subscription_test_fail_upsert()
    `);
    const event = changed("evt_test_redelivered");

    await expect(applyEvent(store(), event)).rejects.toThrow(
      /insert into "subscriptions"/u
    );

    await expect(
      eventRows(event.providerEventId),
      "the failed delivery leaves no dedupe row"
    ).resolves.toStrictEqual([]);

    // The vendor redelivers once the fault is gone, and the event applies this time.
    await database.db.execute(
      sql`drop trigger subscription_test_fail_upsert on subscriptions`
    );
    const redelivered = await applyEvent(store(), event);

    expect(redelivered).toMatchObject({ applied: true, duplicate: false });
    const [row] = await database.db
      .select({ plan: subscriptions.plan, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, "sub_test_372"));
    expect(row).toStrictEqual({ plan: "pro", status: "active" });
  });
});
