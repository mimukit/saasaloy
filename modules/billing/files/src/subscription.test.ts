// Tests for the projection rules: what counts as a live subscription, and what one
// normalized event does to the table. Repo-only, like ./define.test.ts, and it runs on
// `node:test` via `pnpm test:modules`.
//
// The store is faked rather than mocked. `applyEvent` takes a five-method port instead of a
// Drizzle client (see subscription.ts), so the fake below is the whole database: an array
// of rows, a set of event keys, and a counter per method so a test can assert that a
// duplicate event touched nothing.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  BillableSubject,
  BillingEvent,
  BillingEventType,
  Subscription,
  SubscriptionInput,
} from "./provider.ts";
import { applyEvent, currentSubscription } from "./subscription.ts";
import type {
  BillingEventRecord,
  BillingStore,
  SubscriptionPatch,
} from "./subscription.ts";

const SUBJECT: BillableSubject = {
  customerType: "user",
  referenceId: "user_1",
};
const NOW = new Date("2026-09-08T12:00:00.000Z");

function fakeStore(seed: Subscription[] = []) {
  const rows = [...seed];
  const events = new Map<string, BillingEventRecord & { processedAt?: Date }>();
  const calls = { patch: 0, processed: 0, record: 0, upsert: 0 };

  const store: BillingStore = {
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

  return { calls, events, rows, store };
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

describe("currentSubscription", () => {
  it("returns nothing for a subject with no row at all", async () => {
    const { store } = fakeStore();

    assert.equal(await currentSubscription(store, SUBJECT), undefined);
  });

  it("returns the row for every live status", async () => {
    for (const status of ["trialing", "active", "past_due"] as const) {
      const { store } = fakeStore([makeRow({ status })]);

      assert.equal((await currentSubscription(store, SUBJECT))?.status, status);
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

      assert.equal(await currentSubscription(store, SUBJECT), undefined);
    }
  });

  it("treats a locked row as not live, whatever its status says", async () => {
    const { store } = fakeStore([
      makeRow({ lockedAt: NOW, status: "past_due" }),
    ]);

    assert.equal(await currentSubscription(store, SUBJECT), undefined);
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

    assert.equal((await currentSubscription(store, SUBJECT))?.id, "new");
  });

  it("does not answer for another subject's rows", async () => {
    const { store } = fakeStore([makeRow()]);

    assert.equal(
      await currentSubscription(store, {
        customerType: "user",
        referenceId: "user_2",
      }),
      undefined
    );
  });
});

describe("applyEvent", () => {
  it("writes the row and stamps the event for subscription.changed", async () => {
    const { calls, events, rows, store } = fakeStore();

    const result = await applyEvent(
      store,
      makeEvent("subscription.changed"),
      NOW
    );

    assert.equal(result.applied, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.subscription?.plan, "pro");
    assert.equal(rows.length, 1);
    assert.equal(calls.upsert, 1);
    assert.equal(
      events.get("console:evt_subscription.changed")?.processedAt?.getTime(),
      NOW.getTime()
    );
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

    assert.equal(result.subscription?.status, "canceled");
    assert.equal(result.subscription?.endedAt?.getTime(), NOW.getTime());
    assert.equal(result.subscription?.canceledAt?.getTime(), NOW.getTime());
    assert.equal(await currentSubscription(store, SUBJECT), undefined);
    assert.equal(rows.length, 1);
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

    assert.equal(result.applied, true);
    assert.equal(result.subscription?.status, "trialing");
    assert.equal(result.subscription?.reminderSentAt, null);
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

    assert.equal(result.subscription?.status, "past_due");
    assert.equal((await currentSubscription(store, SUBJECT))?.plan, "pro");
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

    assert.equal(result.subscription?.lockedAt, null);
    assert.equal(calls.patch, 1);
    assert.equal((await currentSubscription(store, SUBJECT))?.plan, "pro");
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

    assert.equal(calls.patch, 0);
  });

  it("is a no-op on a replayed event, and touches nothing below the insert", async () => {
    const { calls, rows, store } = fakeStore();
    const delivered = makeEvent("subscription.changed");

    const first = await applyEvent(store, delivered, NOW);
    const second = await applyEvent(store, delivered, NOW);

    assert.deepEqual(
      [first.applied, first.duplicate],
      [true, false],
      "the first delivery applies"
    );
    assert.deepEqual(
      [second.applied, second.duplicate],
      [false, true],
      "the second is recognised as a replay"
    );
    assert.equal(second.subscription, undefined);
    assert.equal(rows.length, 1);
    assert.equal(calls.record, 2, "both deliveries attempt the insert");
    assert.equal(calls.upsert, 1, "only the first one writes the row");
    assert.equal(calls.processed, 1, "only the first one stamps processedAt");
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

    assert.equal(other.applied, true);
    assert.equal(calls.upsert, 2);
  });

  it("applies an event carrying no subscription state", async () => {
    const { calls, store } = fakeStore();

    const result = await applyEvent(
      store,
      { ...makeEvent("payment.succeeded"), subscription: undefined },
      NOW
    );

    assert.equal(result.applied, true);
    assert.equal(result.subscription, undefined);
    assert.equal(calls.upsert, 0);
    assert.equal(calls.processed, 1);
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

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "past_due");
  });
});
