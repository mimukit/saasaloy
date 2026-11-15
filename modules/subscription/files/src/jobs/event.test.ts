// Tests for the `subscription.event` consumer: the scope it reads its store out of, the date
// revival a queue message needs, and the replay guarantee the whole design rests on.
// Repo-only, like ./../subscription.test.ts, and it runs on `node:test` via
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  BillableSubject,
  Subscription,
  SubscriptionInput,
} from "../provider.ts";
import { setSubscriptionStoreResolver } from "../store.ts";
import type {
  SubscriptionEventRecord,
  SubscriptionStore,
  SubscriptionPatch,
} from "../subscription.ts";
import { subscriptionEventJob } from "./event.ts";
import { handleSubscriptionEvent, reviveEvent } from "./event-handler.ts";
import type { SubscriptionEventPayload } from "./event-handler.ts";

const SUBJECT: BillableSubject = {
  customerType: "user",
  referenceId: "user_1",
};

// Stands in for the AsyncLocalStorage `apps/api/src/subscription-store.ts` registers. The core
// holds a resolver, not a scope, so a test supplies its own reader and needs no
// `node:async_hooks`.
let scoped: SubscriptionStore | undefined;
setSubscriptionStoreResolver(() => scoped);

async function withSubscriptionStore<T>(
  store: SubscriptionStore,
  body: () => Promise<T>
): Promise<T> {
  scoped = store;
  try {
    return await body();
  } finally {
    scoped = undefined;
  }
}

function fakeStore() {
  const rows: Subscription[] = [];
  const events = new Set<string>();
  const calls = { record: 0, upsert: 0 };

  const store: SubscriptionStore = {
    latestSubscription(subject) {
      const matching = rows.filter(
        (row) =>
          row.referenceId === subject.referenceId &&
          row.customerType === subject.customerType
      );
      return Promise.resolve(matching.at(-1));
    },
    markEventProcessed() {
      return Promise.resolve();
    },
    pastDueSince() {
      return Promise.resolve([]);
    },
    recipientFor() {
      return Promise.resolve({
        email: "subscription@example.com",
        name: "Ada",
      });
    },
    patchSubscription(id: string, patch: SubscriptionPatch) {
      const at = rows.findIndex((row) => row.id === id);
      if (at !== -1) {
        rows[at] = { ...(rows[at] as Subscription), ...patch };
      }
      return Promise.resolve();
    },
    recordEvent(record: SubscriptionEventRecord) {
      calls.record += 1;
      const key = `${record.provider}:${record.providerEventId}`;
      if (events.has(key)) {
        return Promise.resolve(false);
      }
      events.add(key);
      return Promise.resolve(true);
    },
    upsertSubscription(subject: BillableSubject, input: SubscriptionInput) {
      calls.upsert += 1;
      const existing = rows.find(
        (row) => row.providerSubscriptionId === input.providerSubscriptionId
      );
      const row: Subscription = {
        ...(existing ?? {
          createdAt: new Date(),
          customerType: subject.customerType,
          id: `sub_${String(rows.length + 1)}`,
          referenceId: subject.referenceId,
        }),
        ...input,
        updatedAt: new Date(),
      } as Subscription;
      if (existing) {
        rows[rows.indexOf(existing)] = row;
      } else {
        rows.push(row);
      }
      return Promise.resolve(row);
    },
  };

  return { calls, rows, store };
}

function payload(overrides: Partial<SubscriptionEventPayload> = {}) {
  return {
    occurredAt: "2026-09-08T12:00:00.000Z",
    provider: "console",
    providerEventId: "evt_1",
    subject: SUBJECT,
    subscription: {
      plan: "pro",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "psub_1",
      status: "active" as const,
      trialEnd: "2026-09-22T00:00:00.000Z",
    },
    type: "subscription.changed",
    ...overrides,
  } satisfies SubscriptionEventPayload;
}

describe("reviveEvent", () => {
  it("turns the ISO strings a queue message carries back into dates", () => {
    const event = reviveEvent(payload());

    assert.ok(event.occurredAt instanceof Date);
    assert.equal(event.occurredAt.toISOString(), "2026-09-08T12:00:00.000Z");
    assert.ok(event.subscription?.trialEnd instanceof Date);
    assert.equal(event.subscription?.cancelAt, null);
  });

  it("defaults a missing occurredAt rather than minting an Invalid Date", () => {
    const event = reviveEvent(payload({ occurredAt: undefined }));

    assert.ok(!Number.isNaN(event.occurredAt.getTime()));
  });
});

describe("handleSubscriptionEvent", () => {
  it("refuses to run outside a store scope, and says what to wrap it in", async () => {
    await assert.rejects(() => handleSubscriptionEvent(payload()), {
      message: /No SubscriptionStore is in scope/,
    });
  });

  it("writes the projection from a delivered event", async () => {
    const { rows, store } = fakeStore();

    const result = await withSubscriptionStore(store, () =>
      handleSubscriptionEvent(payload())
    );

    assert.equal(result.applied, true);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.plan, "pro");
    assert.equal(rows[0]?.status, "active");
  });

  it("is a no-op on a redelivered event", async () => {
    const { calls, rows, store } = fakeStore();

    const first = await withSubscriptionStore(store, () =>
      handleSubscriptionEvent(payload())
    );
    const second = await withSubscriptionStore(store, () =>
      handleSubscriptionEvent(payload({ subscription: undefined }))
    );

    assert.equal(first.duplicate, false);
    assert.equal(second.applied, false);
    assert.equal(second.duplicate, true);
    // The row write sits inside the guarded body, so the second delivery never reached it.
    assert.equal(calls.record, 2);
    assert.equal(calls.upsert, 1);
    assert.equal(rows.length, 1);
  });
});

describe("subscriptionEventJob", () => {
  it("registers under the name the routes enqueue", () => {
    assert.equal(subscriptionEventJob().name, "subscription.event");
    assert.equal(subscriptionEventJob().durable, false);
  });

  it("runs the handler through the queue's Job shape", async () => {
    const { rows, store } = fakeStore();
    const job = subscriptionEventJob();

    await withSubscriptionStore(store, async () => {
      await job.run(await job.parse(payload()), {});
    });

    assert.equal(rows.length, 1);
  });
});
