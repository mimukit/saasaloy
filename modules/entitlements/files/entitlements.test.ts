// Tests for the entitlement rules, driven end to end over `queue-memory` and
// `billing-console` — the two local modules that exist so this can be proved with no vendor
// account and no network. Repo-only, and it runs on `node:test` via `pnpm test:modules`.
//
// The path under test is the real one: `consoleBilling().createCheckout` mints a normalized
// event, the route would enqueue it, the memory provider runs `billingEventJob()` inline,
// `applyEvent` writes the projection, and only then does `currentPlan` read it back. Nothing
// here writes a row by hand, so a change that broke the event path would fail these tests
// rather than passing against a fixture.
//
// `./index.ts` beside this file is a resolution shim, not a shipped file — see its header.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consoleBilling } from "../../billing-console/files/console.ts";
import { billingEventJob, plans } from "../../billing/files/src/index.ts";
import { applyEvent } from "../../billing/files/src/subscription.ts";
import { setBillingStoreResolver } from "../../billing/files/src/store.ts";
import type {
  BillableSubject,
  BillingEnv,
  BillingEvent,
  HostContext,
  Subscription,
  SubscriptionInput,
} from "../../billing/files/src/provider.ts";
import type {
  BillingStore,
  SubscriptionPatch,
} from "../../billing/files/src/subscription.ts";
import { defineQueue } from "../../queue/files/src/define.ts";
import { memory } from "../../queue-memory/files/memory.ts";
import {
  createEntitlementCache,
  currentPlan,
  hasFeature,
  limit,
  withinLimit,
} from "./entitlements.ts";

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
 */
function fakeQueue(store: BillingStore) {
  setBillingStoreResolver(() => store);
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
  assert.ok(result.event, "the console provider mints its own event");
  await enqueue(result.event);
}

describe("entitlements with no subscription", () => {
  it("resolves a subject with no row at all to the default plan", async () => {
    const { store } = fakeStore();

    const plan = await currentPlan(store, SUBJECT);

    assert.equal(plan.id, "free");
    assert.equal(plan.isDefault, true);
  });

  it("answers the default plan's own features and limits", async () => {
    const { store } = fakeStore();

    assert.equal(await hasFeature(store, SUBJECT, "export"), false);
    assert.equal(await limit(store, SUBJECT, "projects"), 1);
  });

  it("needs no payment provider installed to answer", async () => {
    // `BILLING_PROVIDER` is never read on this path: entitlements resolve from `plans.ts`
    // and the projection, which is why `entitlements` is a module of its own and works in a
    // project that takes no money yet.
    const { store } = fakeStore();

    assert.equal((await currentPlan(store, SUBJECT)).id, "free");
  });

  it("denies an unknown feature and allows nothing of an unknown limit", async () => {
    const { store } = fakeStore();

    assert.equal(await hasFeature(store, SUBJECT, "teleport"), false);
    assert.equal(await limit(store, SUBJECT, "teleport"), 0);
  });
});

describe("entitlements after a console checkout", () => {
  it("resolves the bought plan and its features", async () => {
    const { rows, store } = fakeStore();

    await checkout(store, "pro");

    assert.equal(rows.length, 1);
    assert.equal((await currentPlan(store, SUBJECT)).id, "pro");
    assert.equal(await hasFeature(store, SUBJECT, "export"), true);
    assert.equal(await limit(store, SUBJECT, "projects"), -1);
  });

  it("treats -1 as unmetered in withinLimit", async () => {
    const { store } = fakeStore();

    await checkout(store, "pro");

    assert.equal(await withinLimit(store, SUBJECT, "projects", 9999), true);
    assert.equal(await withinLimit(store, SUBJECT, "seats", 10), false);
    assert.equal(await withinLimit(store, SUBJECT, "seats", 9), true);
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

    assert.equal((await currentPlan(store, SUBJECT)).id, "free");
    assert.equal(await hasFeature(store, SUBJECT, "export"), false);
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

    assert.equal((await currentPlan(store, SUBJECT)).id, "free");
    assert.equal(await hasFeature(store, SUBJECT, "export"), false);
  });

  it("keeps the paid plan while a row is only past_due", async () => {
    const { rows, store } = fakeStore();
    await checkout(store, "pro");
    rows[0] = { ...(rows[0] as Subscription), status: "past_due" };

    assert.equal((await currentPlan(store, SUBJECT)).id, "pro");
  });

  it("falls back to the default plan when the row names a dropped tier", async () => {
    const { rows, store } = fakeStore();
    await checkout(store, "pro");
    rows[0] = { ...(rows[0] as Subscription), plan: "enterprise" };

    assert.ok(!plans.some((plan) => plan.id === "enterprise"));
    assert.equal((await currentPlan(store, SUBJECT)).id, "free");
  });
});

describe("the per-request memo", () => {
  it("reads the projection once however many checks a request makes", async () => {
    const { calls, store } = fakeStore();
    const cache = createEntitlementCache();

    await hasFeature(store, SUBJECT, "export", cache);
    await limit(store, SUBJECT, "projects", cache);
    await currentPlan(store, SUBJECT, cache);

    assert.equal(calls.latest, 1);
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
    assert.equal(calls.latest, 1);
  });

  it("does not leak one subject's plan into another's, because the memo is per call site", async () => {
    const { calls, store } = fakeStore();

    await currentPlan(store, SUBJECT);
    await currentPlan(store, { customerType: "user", referenceId: "user_2" });

    assert.equal(calls.latest, 2);
  });
});
