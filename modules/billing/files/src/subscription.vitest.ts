// Tests for the projection rules: what counts as a live subscription, and what one
// normalized event does to the table. It ships as `subscription.test.ts` when testing is
// on, and `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.
//
// The store is faked rather than mocked. `applyEvent` takes a five-method port instead of a
// Drizzle client (see subscription.ts), so the fake below is the whole database: an array
// of rows, a set of event keys, and a counter per method so a test can assert that a
// duplicate event touched nothing.

import { describe, expect, it } from "vitest";
import { setBillingNotifier } from "./notify";
import type { BillingNotification, BillingRecipient } from "./notify";
import type {
  BillableSubject,
  BillingEvent,
  BillingEventType,
  Subscription,
  SubscriptionInput,
} from "./provider";
import { applyEvent, currentSubscription } from "./subscription";
import type {
  BillingEventRecord,
  BillingStore,
  SubscriptionPatch,
} from "./subscription";

const SUBJECT: BillableSubject = {
  customerType: "user",
  referenceId: "user_1",
};
const NOW = new Date("2026-09-08T12:00:00.000Z");

// Every billing email goes through the notifier port, so the fake below is the whole
// mail system: a list the assertions read back. Registered once for the file; each
// `fakeStore` clears it.
const sent: BillingNotification[] = [];
setBillingNotifier((notification) => {
  sent.push(notification);
  return Promise.resolve();
});

function fakeStore(seed: Subscription[] = []) {
  const rows = [...seed];
  const events = new Map<string, BillingEventRecord & { processedAt?: Date }>();
  const calls = { patch: 0, processed: 0, record: 0, upsert: 0 };
  let recipient: BillingRecipient | undefined = {
    email: "ada@example.com",
    name: "Ada",
  };

  const store: BillingStore = {
    pastDueSince(before: Date) {
      return Promise.resolve(
        rows.filter(
          (row) =>
            row.status === "past_due" &&
            !row.lockedAt &&
            row.updatedAt.getTime() < before.getTime()
        )
      );
    },
    recipientFor() {
      return Promise.resolve(recipient);
    },
    latestSubscription(subject) {
      const matching = rows.filter(
        (row) =>
          row.referenceId === subject.referenceId &&
          row.customerType === subject.customerType
      );
      return Promise.resolve(matching.at(-1));
    },
    markEventProcessed(provider, providerEventId, at) {
      calls.processed += 1;
      const key = `${provider}:${providerEventId}`;
      const event = events.get(key);
      if (event) {
        events.set(key, { ...event, processedAt: at });
      }
      return Promise.resolve();
    },
    patchSubscription(id, patch: SubscriptionPatch) {
      calls.patch += 1;
      const at = rows.findIndex((row) => row.id === id);
      if (at !== -1) {
        rows[at] = { ...(rows[at] as Subscription), ...patch };
      }
      return Promise.resolve();
    },
    recordEvent(record) {
      calls.record += 1;
      const key = `${record.provider}:${record.providerEventId}`;
      if (events.has(key)) {
        return Promise.resolve(false);
      }
      events.set(key, record);
      return Promise.resolve(true);
    },
    upsertSubscription(subject, input: SubscriptionInput) {
      calls.upsert += 1;
      const at = rows.findIndex(
        (row) => row.providerSubscriptionId === input.providerSubscriptionId
      );
      const base = at === -1 ? undefined : (rows[at] as Subscription);
      const row: Subscription = {
        createdAt: base?.createdAt ?? NOW,
        customerType: subject.customerType,
        id: base?.id ?? `sub_row_${rows.length + 1}`,
        lockedAt: base?.lockedAt ?? null,
        referenceId: subject.referenceId,
        reminderSentAt: base?.reminderSentAt ?? null,
        updatedAt: NOW,
        ...input,
      };
      if (at === -1) {
        rows.push(row);
      } else {
        rows[at] = row;
      }
      return Promise.resolve(row);
    },
  };

  sent.length = 0;

  return {
    calls,
    events,
    rows,
    /** Drop the address, so a test can drive the "nobody to write to" path. */
    forgetRecipient() {
      recipient = undefined;
    },
    sent,
    store,
  };
}

function subscriptionInput(
  overrides: Partial<SubscriptionInput> = {}
): SubscriptionInput {
  return {
    plan: "pro",
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    status: "active",
    ...overrides,
  };
}

function makeEvent(
  type: BillingEventType,
  overrides: Partial<BillingEvent> = {}
): BillingEvent {
  return {
    occurredAt: NOW,
    provider: "console",
    providerEventId: `evt_${type}`,
    subject: SUBJECT,
    subscription: subscriptionInput(),
    type,
    ...overrides,
  };
}

function makeRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    createdAt: NOW,
    customerType: SUBJECT.customerType,
    id: "sub_row_1",
    plan: "pro",
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    referenceId: SUBJECT.referenceId,
    status: "active",
    updatedAt: NOW,
    ...overrides,
  };
}

describe(currentSubscription, () => {
  it("returns nothing for a subject with no row at all", async () => {
    const { store } = fakeStore();

    await expect(currentSubscription(store, SUBJECT)).resolves.toBeUndefined();
  });

  it("returns the row for every live status", async () => {
    for (const status of ["trialing", "active", "past_due"] as const) {
      const { store } = fakeStore([makeRow({ status })]);

      await expect(currentSubscription(store, SUBJECT)).resolves.toHaveProperty(
        "status",
        status
      );
    }
  });

  it("returns nothing for a terminal status", async () => {
    for (const status of [
      "canceled",
      "unpaid",
      "incomplete",
      "paused",
    ] as const) {
      const { store } = fakeStore([makeRow({ status })]);

      await expect(
        currentSubscription(store, SUBJECT)
      ).resolves.toBeUndefined();
    }
  });

  it("treats a locked row as not live, whatever its status says", async () => {
    const { store } = fakeStore([
      makeRow({ lockedAt: NOW, status: "past_due" }),
    ]);

    await expect(currentSubscription(store, SUBJECT)).resolves.toBeUndefined();
  });

  it("reads the latest row, so a resubscribe wins over the history", async () => {
    const { store } = fakeStore([
      makeRow({
        id: "old",
        providerSubscriptionId: "sub_0",
        status: "canceled",
      }),
      makeRow({ id: "new", plan: "pro", status: "active" }),
    ]);

    await expect(currentSubscription(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "new"
    );
  });

  it("does not answer for another subject's rows", async () => {
    const { store } = fakeStore([makeRow()]);

    await expect(
      currentSubscription(store, {
        customerType: "user",
        referenceId: "user_2",
      })
    ).resolves.toBeUndefined();
  });
});

describe(applyEvent, () => {
  it("writes the row and stamps the event for subscription.changed", async () => {
    const { calls, events, rows, store } = fakeStore();

    const result = await applyEvent(
      store,
      makeEvent("subscription.changed"),
      NOW
    );

    expect(result).toMatchObject({
      applied: true,
      duplicate: false,
      subscription: { plan: "pro" },
    });
    expect(rows).toHaveLength(1);
    expect(calls.upsert).toBe(1);
    expect(
      events.get("console:evt_subscription.changed")?.processedAt?.getTime()
    ).toBe(NOW.getTime());
  });

  it("forces canceled plus endedAt for subscription.deleted, whatever the vendor sent", async () => {
    const { rows, store } = fakeStore();

    const result = await applyEvent(
      store,
      makeEvent("subscription.deleted", {
        subscription: subscriptionInput({ status: "active" }),
      }),
      NOW
    );

    expect(result.subscription?.status).toBe("canceled");
    expect(result.subscription?.endedAt?.getTime()).toBe(NOW.getTime());
    expect(result.subscription?.canceledAt?.getTime()).toBe(NOW.getTime());
    await expect(currentSubscription(store, SUBJECT)).resolves.toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it("records trial.ending without changing the status", async () => {
    const { store } = fakeStore();

    const result = await applyEvent(
      store,
      makeEvent("trial.ending", {
        subscription: subscriptionInput({ status: "trialing" }),
      }),
      NOW
    );

    expect(result.applied).toBeTruthy();
    expect(result.subscription?.status).toBe("trialing");
    // The reminder is the event's whole point, so `reminderSentAt` is stamped here and the
    // status is left exactly as the vendor sent it. See "applyEvent side effects" below.
    expect(result.subscription?.reminderSentAt).toStrictEqual(NOW);
  });

  it("keeps the plan on payment.failed, so past_due still entitles it", async () => {
    const { store } = fakeStore();

    const result = await applyEvent(
      store,
      makeEvent("payment.failed", {
        subscription: subscriptionInput({ status: "past_due" }),
      }),
      NOW
    );

    expect(result.subscription?.status).toBe("past_due");
    await expect(currentSubscription(store, SUBJECT)).resolves.toHaveProperty(
      "plan",
      "pro"
    );
  });

  it("clears lockedAt on payment.succeeded", async () => {
    const { calls, store } = fakeStore([
      makeRow({
        lockedAt: new Date("2026-09-01T00:00:00.000Z"),
        status: "past_due",
      }),
    ]);

    const result = await applyEvent(
      store,
      makeEvent("payment.succeeded", {
        subscription: subscriptionInput({ status: "active" }),
      }),
      NOW
    );

    expect(result.subscription?.lockedAt).toBeNull();
    expect(calls.patch).toBe(1);
    await expect(currentSubscription(store, SUBJECT)).resolves.toHaveProperty(
      "plan",
      "pro"
    );
  });

  it("leaves lockedAt alone on payment.succeeded when nothing was locked", async () => {
    const { calls, store } = fakeStore();

    await applyEvent(
      store,
      makeEvent("payment.succeeded", {
        subscription: subscriptionInput({ status: "active" }),
      }),
      NOW
    );

    expect(calls.patch).toBe(0);
  });

  it("is a no-op on a replayed event, and touches nothing below the insert", async () => {
    const { calls, rows, store } = fakeStore();
    const delivered = makeEvent("subscription.changed");

    const first = await applyEvent(store, delivered, NOW);
    const second = await applyEvent(store, delivered, NOW);

    // The first delivery applies; the second is recognised as a replay.
    expect([first.applied, first.duplicate]).toStrictEqual([true, false]);
    expect([second.applied, second.duplicate]).toStrictEqual([false, true]);
    expect(second.subscription).toBeUndefined();
    expect(rows).toHaveLength(1);
    // Both deliveries attempt the insert; only the first writes the row and stamps
    // processedAt.
    expect(calls).toMatchObject({ processed: 1, record: 2, upsert: 1 });
  });

  it("dedupes per provider, so two vendors may share an event id", async () => {
    const { calls, store } = fakeStore();

    await applyEvent(store, makeEvent("subscription.changed"), NOW);
    const other = await applyEvent(
      store,
      makeEvent("subscription.changed", {
        provider: "stripe",
        subscription: subscriptionInput({ providerSubscriptionId: "sub_2" }),
      }),
      NOW
    );

    expect(other.applied).toBeTruthy();
    expect(calls.upsert).toBe(2);
  });

  it("applies an event carrying no subscription state", async () => {
    const { calls, store } = fakeStore();

    const result = await applyEvent(
      store,
      { ...makeEvent("payment.succeeded"), subscription: undefined },
      NOW
    );

    expect(result.applied).toBeTruthy();
    expect(result.subscription).toBeUndefined();
    expect(calls.upsert).toBe(0);
    expect(calls.processed).toBe(1);
  });

  it("converges on one row when the same subscription id arrives twice", async () => {
    const { rows, store } = fakeStore();

    await applyEvent(store, makeEvent("subscription.changed"), NOW);
    await applyEvent(
      store,
      makeEvent("subscription.changed", {
        providerEventId: "evt_2",
        subscription: subscriptionInput({ plan: "pro", status: "past_due" }),
      }),
      NOW
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("past_due");
  });
});

describe("applyEvent side effects", () => {
  it("clears lockedAt on a payment.succeeded that carries no subscription", async () => {
    // Stripe's `invoice.paid` is exactly this shape: an invoice, no subscription state, so
    // the provider enqueues the event with no projected row. Reading the current row back
    // is the only way the one event that ends a lockout can end one.
    const { calls, rows, store } = fakeStore([
      makeRow({
        lockedAt: new Date("2026-09-01T00:00:00.000Z"),
        status: "past_due",
      }),
    ]);

    const result = await applyEvent(
      store,
      { ...makeEvent("payment.succeeded"), subscription: undefined },
      NOW
    );

    expect(result.applied).toBeTruthy();
    expect(result.subscription?.lockedAt).toBeNull();
    expect(rows[0]?.lockedAt).toBeNull();
    // The row was read, not rewritten: no provider state came with the event.
    expect(calls.upsert).toBe(0);
    expect(calls.patch).toBe(1);
  });

  it("sends one trial reminder per subscription and stamps reminderSentAt", async () => {
    const { rows, sent: mail, store } = fakeStore();

    const first = await applyEvent(store, makeEvent("trial.ending"), NOW);

    expect(first.notified).toBe("trial.ending");
    expect(mail).toHaveLength(1);
    expect(mail[0]?.to.email).toBe("ada@example.com");
    expect(mail[0]?.subscription.plan).toBe("pro");
    expect(rows[0]?.reminderSentAt).toStrictEqual(NOW);
  });

  it("sends no second reminder when the vendor sends trial_will_end twice", async () => {
    const { sent: mail, store } = fakeStore();

    await applyEvent(store, makeEvent("trial.ending"), NOW);
    // A different event id, so `billing_events` does not stop it. `reminderSentAt` does.
    await applyEvent(
      store,
      makeEvent("trial.ending", { providerEventId: "evt_trial_2" }),
      NOW
    );

    expect(mail).toHaveLength(1);
  });

  it("sends the payment-failed email on every distinct failure", async () => {
    const { sent: mail, store } = fakeStore();

    await applyEvent(
      store,
      makeEvent("payment.failed", {
        subscription: subscriptionInput({ status: "past_due" }),
      }),
      NOW
    );
    await applyEvent(
      store,
      makeEvent("payment.failed", {
        providerEventId: "evt_failed_2",
        subscription: subscriptionInput({ status: "past_due" }),
      }),
      NOW
    );

    expect(mail).toHaveLength(2);
    expect(mail[0]?.kind).toBe("payment.failed");
  });

  it("sends the payment-failed email for an invoice event carrying no row", async () => {
    const { sent: mail, store } = fakeStore([makeRow({ status: "past_due" })]);

    const result = await applyEvent(
      store,
      { ...makeEvent("payment.failed"), subscription: undefined },
      NOW
    );

    expect(result.notified).toBe("payment.failed");
    expect(mail).toHaveLength(1);
  });

  it("sends nothing on a replayed event, because the guard is above the send", async () => {
    const { sent: mail, store } = fakeStore();

    await applyEvent(store, makeEvent("payment.failed"), NOW);
    await applyEvent(store, makeEvent("payment.failed"), NOW);

    expect(mail).toHaveLength(1);
  });

  it("skips the send, and does not throw, when the subject has no address", async () => {
    const { forgetRecipient, rows, sent: mail, store } = fakeStore();
    forgetRecipient();

    const result = await applyEvent(store, makeEvent("trial.ending"), NOW);

    expect(result.applied).toBeTruthy();
    expect(result.notified).toBeUndefined();
    expect(mail).toHaveLength(0);
    // No email went, so nothing claims one did. A later delivery may still find an address.
    expect(rows[0]?.reminderSentAt).toBeNull();
  });

  it("sends no email for a plain subscription.changed", async () => {
    const { sent: mail, store } = fakeStore();

    await applyEvent(store, makeEvent("subscription.changed"), NOW);

    expect(mail).toHaveLength(0);
  });
});
