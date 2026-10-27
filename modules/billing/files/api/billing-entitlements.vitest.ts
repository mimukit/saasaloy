// Tests for the entitlement rules, driven end to end over `queue-memory` and
// `billing-console` — the two local modules that exist so this can be proved with no vendor
// account and no network. It ships as `apps/api/src/billing-entitlements.test.ts` when
// testing is on and both of those modules are installed, and `pnpm test:modules` runs it in
// place on Vitest in the saasaloy repo. It lives in the api, not in `packages/billing`,
// because it needs `@repo/queue`, and `packages/queue` already depends on `@repo/billing`.
//
// The path under test is the real one: `consoleBilling().createCheckout` mints a normalized
// event, the route would enqueue it, the memory provider runs `billingEventJob()` inline,
// `applyEvent` writes the projection, and only then does `currentPlan` read it back. Nothing
// here writes a row by hand, so a change that broke the event path would fail these tests
// rather than passing against a fixture.

import { assert, describe, expect, it } from "vitest";
import { defineQueue } from "@repo/queue";
import { memory } from "@repo/queue/providers/memory";
import {
  createEntitlementCache,
  currentPlan,
  hasFeature,
  limit,
  withinLimit,
} from "@repo/billing/entitlements";
import {
  applyEvent,
  billingEventJob,
  plans,
  requireBillingStore,
  setBillingStoreResolver,
  setBillingStoreRunner,
} from "@repo/billing";
import type {
  BillableSubject,
  BillingEnv,
  BillingEvent,
  HostContext,
  Subscription,
  SubscriptionInput,
  BillingStore,
  SubscriptionPatch,
} from "@repo/billing";
import { consoleBilling } from "@repo/billing/providers/console";

const SUBJECT: BillableSubject = {
  customerType: "user",
  referenceId: "user_1",
};
const ENV: BillingEnv = { BILLING_PROVIDER: "console" };
const HOST: HostContext = { auth: undefined, headers: new Headers() };
const NOW = new Date("2026-09-08T12:00:00.000Z");

function fakeStore(seed: Subscription[] = []) {
  const rows = [...seed];
  const events = new Set<string>();
  const calls = { latest: 0 };

  const store: BillingStore = {
    latestSubscription(subject) {
      calls.latest += 1;
      return Promise.resolve(
        rows.findLast(
          (row) =>
            row.referenceId === subject.referenceId &&
            row.customerType === subject.customerType
        )
      );
    },
    markEventProcessed() {
      return Promise.resolve();
    },
    pastDueSince() {
      return Promise.resolve([]);
    },
    patchSubscription(id: string, patch: SubscriptionPatch) {
      const at = rows.findIndex((row) => row.id === id);
      if (at !== -1) {
        rows[at] = { ...(rows[at] as Subscription), ...patch };
      }
      return Promise.resolve();
    },
    recipientFor() {
      return Promise.resolve({ email: "ada@example.com" });
    },
    recordEvent(record) {
      const key = `${record.provider}:${record.providerEventId}`;
      if (events.has(key)) {
        return Promise.resolve(false);
      }
      events.add(key);
      return Promise.resolve(true);
    },
    upsertSubscription(subject: BillableSubject, input: SubscriptionInput) {
      const at = rows.findIndex(
        (row) => row.providerSubscriptionId === input.providerSubscriptionId
      );
      const base = at === -1 ? undefined : (rows[at] as Subscription);
      const row: Subscription = {
        createdAt: base?.createdAt ?? NOW,
        customerType: subject.customerType,
        id: base?.id ?? `sub_row_${String(rows.length + 1)}`,
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

  return { calls, rows, store };
}

/**
 * The queue a project gets, built here rather than imported: the barrel's own tables are the
 * patch point a real install writes into, and a test may not depend on what a previous
 * `saasaloy add` left there.
 *
 * The store is registered as a **runner**, not as a standing resolver, which is what makes
 * these tests run the path a deployed Worker runs. Nothing is in scope when `enqueue` is
 * called here — no billing route, no request — so the job has to open the scope for itself
 * through `inBillingStore`, exactly as it does under `queue-cloudflare`'s consumer, on the
 * cron tick and on a vendor webhook. A resolver that answered from the start would hide
 * that: the scope would already be open and every one of these tests would pass whether or
 * not the job could open one.
 */
function fakeQueue(store: BillingStore) {
  let scoped: BillingStore | undefined;
  setBillingStoreResolver(() => scoped);
  setBillingStoreRunner(async (body) => {
    scoped = store;
    try {
      return await body();
    } finally {
      scoped = undefined;
    }
  });
  const provider = memory({ rethrow: true });
  const queue = defineQueue({
    jobs: [billingEventJob()],
    providers: [provider],
    schedules: [],
  });
  return {
    enqueue: (event: BillingEvent) =>
      queue
        .create({ QUEUE_PROVIDER: "memory" })
        .enqueue("billing.event", event),
    provider,
  };
}

/** Buy `planId` the way the admin page does, through the console provider and the queue. */
async function checkout(store: BillingStore, planId: string) {
  const { enqueue } = fakeQueue(store);
  const result = await consoleBilling().createCheckout(ENV, HOST, {
    cancelUrl: "https://app.example.com/billing",
    interval: "monthly",
    planId,
    subject: SUBJECT,
    successUrl: "https://app.example.com/billing?ok=1",
  });
  assert(result.event, "the console provider mints its own event");
  await enqueue(result.event);
}

describe("entitlements with no subscription", () => {
  it("resolves a subject with no row at all to the default plan", async () => {
    const { store } = fakeStore();

    const plan = await currentPlan(store, SUBJECT);

    expect(plan.id).toBe("free");
    expect(plan.isDefault).toBeTruthy();
  });

  it("answers the default plan's own features and limits", async () => {
    const { store } = fakeStore();

    await expect(hasFeature(store, SUBJECT, "export")).resolves.toBeFalsy();
    await expect(limit(store, SUBJECT, "projects")).resolves.toBe(1);
  });

  it("needs no payment provider installed to answer", async () => {
    // `BILLING_PROVIDER` is never read on this path: entitlements resolve from `plans.ts`
    // and the projection only, so the resolver works in a project that has `billing` with no
    // provider registered and takes no money yet.
    const { store } = fakeStore();

    await expect(currentPlan(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "free"
    );
  });

  it("denies an unknown feature and allows nothing of an unknown limit", async () => {
    const { store } = fakeStore();

    await expect(hasFeature(store, SUBJECT, "teleport")).resolves.toBeFalsy();
    await expect(limit(store, SUBJECT, "teleport")).resolves.toBe(0);
  });
});

describe("the event path outside a request", () => {
  it("opens its own store scope, so a consumer needs no route around it", async () => {
    const { rows, store } = fakeStore();

    // The state a queue consumer, the cron tick and a vendor webhook are all in: no billing
    // route has run, so nothing has put a store in scope. Asserted before the checkout so a
    // regression here reads as "the scope was already open", not as a missing row.
    expect(() => requireBillingStore()).toThrow(/No BillingStore is in scope/u);

    await checkout(store, "pro");

    expect(rows).toHaveLength(1);
    await expect(currentPlan(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "pro"
    );
    // And the scope closed again with the job, rather than leaking into whatever runs next.
    expect(() => requireBillingStore()).toThrow(/No BillingStore is in scope/u);
  });
});

describe("entitlements after a console checkout", () => {
  it("resolves the bought plan and its features", async () => {
    const { rows, store } = fakeStore();

    await checkout(store, "pro");

    expect(rows).toHaveLength(1);
    await expect(currentPlan(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "pro"
    );
    await expect(hasFeature(store, SUBJECT, "export")).resolves.toBeTruthy();
    await expect(limit(store, SUBJECT, "projects")).resolves.toBe(-1);
  });

  it("treats -1 as unmetered in withinLimit", async () => {
    const { store } = fakeStore();

    await checkout(store, "pro");

    await expect(
      withinLimit(store, SUBJECT, "projects", 9999)
    ).resolves.toBeTruthy();
    await expect(withinLimit(store, SUBJECT, "seats", 10)).resolves.toBeFalsy();
    await expect(withinLimit(store, SUBJECT, "seats", 9)).resolves.toBeTruthy();
  });

  it("falls back to the default plan once the subscription is deleted", async () => {
    const { rows, store } = fakeStore();
    await checkout(store, "pro");
    const bought = rows[0] as Subscription;

    await applyEvent(
      store,
      {
        occurredAt: NOW,
        provider: "console",
        providerEventId: "evt_deleted",
        subject: SUBJECT,
        subscription: {
          plan: bought.plan,
          providerCustomerId: bought.providerCustomerId,
          providerSubscriptionId: bought.providerSubscriptionId,
          status: "canceled",
        },
        type: "subscription.deleted",
      },
      NOW
    );

    await expect(currentPlan(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "free"
    );
    await expect(hasFeature(store, SUBJECT, "export")).resolves.toBeFalsy();
  });

  it("falls back to the default plan for a locked subject", async () => {
    const { rows, store } = fakeStore();
    await checkout(store, "pro");
    // What the daily dunning sweep does. The status still says `trialing`; `lockedAt` is
    // what takes the plan away.
    rows[0] = {
      ...(rows[0] as Subscription),
      lockedAt: NOW,
      status: "past_due",
    };

    await expect(currentPlan(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "free"
    );
    await expect(hasFeature(store, SUBJECT, "export")).resolves.toBeFalsy();
  });

  it("keeps the paid plan while a row is only past_due", async () => {
    const { rows, store } = fakeStore();
    await checkout(store, "pro");
    rows[0] = { ...(rows[0] as Subscription), status: "past_due" };

    await expect(currentPlan(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "pro"
    );
  });

  it("falls back to the default plan when the row names a dropped tier", async () => {
    const { rows, store } = fakeStore();
    await checkout(store, "pro");
    rows[0] = { ...(rows[0] as Subscription), plan: "enterprise" };

    expect(!plans.some((plan) => plan.id === "enterprise")).toBeTruthy();
    await expect(currentPlan(store, SUBJECT)).resolves.toHaveProperty(
      "id",
      "free"
    );
  });
});

describe("the per-request memo", () => {
  it("reads the projection once however many checks a request makes", async () => {
    const { calls, store } = fakeStore();
    const cache = createEntitlementCache();

    await hasFeature(store, SUBJECT, "export", cache);
    await limit(store, SUBJECT, "projects", cache);
    await currentPlan(store, SUBJECT, cache);

    expect(calls.latest).toBe(1);
  });

  it("shares one read between checks that start together", async () => {
    const { calls, store } = fakeStore();
    const cache = createEntitlementCache();

    await Promise.all([
      hasFeature(store, SUBJECT, "export", cache),
      hasFeature(store, SUBJECT, "prioritySupport", cache),
    ]);

    // The promise is memoized, not the resolved value, so the second call joins the first
    // read instead of racing a second one.
    expect(calls.latest).toBe(1);
  });

  it("does not leak one subject's plan into another's, because the memo is per call site", async () => {
    const { calls, store } = fakeStore();

    await currentPlan(store, SUBJECT);
    await currentPlan(store, { customerType: "user", referenceId: "user_2" });

    expect(calls.latest).toBe(2);
  });
});
