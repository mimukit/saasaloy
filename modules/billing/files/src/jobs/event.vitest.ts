// Tests for the `billing.event` consumer: the scope it reads its store out of, the date
// revival a queue message needs, and the replay guarantee the whole design rests on.
// It ships as `event.test.ts` when testing is on, and `pnpm test:modules` runs it in
// place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import type {
  BillableSubject,
  Subscription,
  SubscriptionInput,
} from "../provider";
import { setBillingStoreResolver } from "../store";
import type {
  BillingEventRecord,
  BillingStore,
  SubscriptionPatch,
} from "../subscription";
import { billingEventJob } from "./event";
import { handleBillingEvent, reviveEvent } from "./event-handler";
import type { BillingEventPayload } from "./event-handler";

const SUBJECT: BillableSubject = {
  customerType: "user",
  referenceId: "user_1",
};

// Stands in for the AsyncLocalStorage `apps/api/src/billing-store.ts` registers. The core
// holds a resolver, not a scope, so a test supplies its own reader and needs no
// `node:async_hooks`.
let scoped: BillingStore | undefined;
setBillingStoreResolver(() => scoped);

async function withBillingStore<T>(
  store: BillingStore,
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

  const store: BillingStore = {
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
      return Promise.resolve({ email: "billing@example.com", name: "Ada" });
    },
    patchSubscription(id: string, patch: SubscriptionPatch) {
      const at = rows.findIndex((row) => row.id === id);
      if (at !== -1) {
        rows[at] = { ...(rows[at] as Subscription), ...patch };
      }
      return Promise.resolve();
    },
    recordEvent(record: BillingEventRecord) {
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

function payload(overrides: Partial<BillingEventPayload> = {}) {
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
  } satisfies BillingEventPayload;
}

describe(reviveEvent, () => {
  it("turns the ISO strings a queue message carries back into dates", () => {
    const event = reviveEvent(payload());

    expect(event.occurredAt instanceof Date).toBeTruthy();
    expect(event.occurredAt.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(event.subscription?.trialEnd instanceof Date).toBeTruthy();
    expect(event.subscription?.cancelAt).toBeNull();
  });

  it("defaults a missing occurredAt rather than minting an Invalid Date", () => {
    const event = reviveEvent(payload({ occurredAt: undefined }));

    expect(!Number.isNaN(event.occurredAt.getTime())).toBeTruthy();
  });
});

describe(handleBillingEvent, () => {
  it("refuses to run outside a store scope, and says what to wrap it in", async () => {
    await expect(() => handleBillingEvent(payload())).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/No BillingStore is in scope/),
      })
    );
  });

  it("writes the projection from a delivered event", async () => {
    const { rows, store } = fakeStore();

    const result = await withBillingStore(store, () =>
      handleBillingEvent(payload())
    );

    expect(result.applied).toBeTruthy();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.plan).toBe("pro");
    expect(rows[0]?.status).toBe("active");
  });

  it("is a no-op on a redelivered event", async () => {
    const { calls, rows, store } = fakeStore();

    const first = await withBillingStore(store, () =>
      handleBillingEvent(payload())
    );
    const second = await withBillingStore(store, () =>
      handleBillingEvent(payload({ subscription: undefined }))
    );

    expect(first.duplicate).toBeFalsy();
    expect(second.applied).toBeFalsy();
    expect(second.duplicate).toBeTruthy();
    // The row write sits inside the guarded body, so the second delivery never reached it.
    expect(calls).toMatchObject({ record: 2, upsert: 1 });
    expect(rows).toHaveLength(1);
  });
});

describe(billingEventJob, () => {
  it("registers under the name the routes enqueue", () => {
    expect(billingEventJob().name).toBe("billing.event");
    expect(billingEventJob().durable).toBeFalsy();
  });

  it("runs the handler through the queue's Job shape", async () => {
    const { rows, store } = fakeStore();
    const job = billingEventJob();

    await withBillingStore(store, async () => {
      await job.run(await job.parse(payload()), {});
    });

    expect(rows).toHaveLength(1);
  });
});
