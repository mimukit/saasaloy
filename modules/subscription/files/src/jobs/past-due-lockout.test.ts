// Tests for the daily dunning sweep: which rows it locks, which it leaves, and what it
// sends. Repo-only, like ../subscription.test.ts, and it runs on `node:test` via
// `pnpm test:modules`.
//
// The clock is a parameter (`runPastDueLockout(db, now, days)`), so the boundary is driven
// rather than waited for. That is the whole reason the sweep's body is a plain function and
// the job is a four-line wrapper around it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { subscriptionConfig, setSubscriptionConfig } from "../config.ts";
import { setSubscriptionNotifier } from "../notify.ts";
import type {
  SubscriptionNotification,
  SubscriptionRecipient,
} from "../notify.ts";
import type { BillableSubject, Subscription } from "../provider.ts";
import { setSubscriptionStoreResolver } from "../store.ts";
import type { SubscriptionStore, SubscriptionPatch } from "../subscription.ts";
import {
  SUBSCRIPTION_PAST_DUE_LOCKOUT_CRON,
  SUBSCRIPTION_PAST_DUE_LOCKOUT_JOB,
  pastDueLockoutJob,
  pastDueLockoutSchedule,
  runPastDueLockout,
} from "./past-due-lockout.ts";

const SUBJECT: BillableSubject = {
  customerType: "user",
  referenceId: "user_1",
};
const DAY = 24 * 60 * 60 * 1000;
// The real clock, not a fixed date. Most cases drive `runPastDueLockout(db, now, days)` with
// `NOW` directly, but the job wrapper calls `new Date()` for itself — so a fixture in the
// future would put every row *ahead* of the job's own cutoff and nothing would ever lock.
const NOW = new Date();

const sent: SubscriptionNotification[] = [];
setSubscriptionNotifier((notification) => {
  sent.push(notification);
  return Promise.resolve();
});

function row(overrides: Partial<Subscription> = {}): Subscription {
  return {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    customerType: SUBJECT.customerType,
    id: "sub_row_1",
    plan: "pro",
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    referenceId: SUBJECT.referenceId,
    status: "past_due",
    // 20 days before NOW, so it is past a 14-day window and inside a 30-day one.
    updatedAt: new Date(NOW.getTime() - 20 * DAY),
    ...overrides,
  };
}

function fakeStore(seed: Subscription[] = []) {
  const rows = [...seed];
  let recipient: SubscriptionRecipient | undefined = {
    email: "ada@example.com",
  };

  const store: SubscriptionStore = {
    latestSubscription() {
      return Promise.resolve(rows.at(-1));
    },
    markEventProcessed() {
      return Promise.resolve();
    },
    // The same rule the Drizzle implementation writes as SQL: still `past_due`, not locked
    // yet, and last touched before the cutoff.
    pastDueSince(before: Date) {
      return Promise.resolve(
        rows.filter(
          (candidate) =>
            candidate.status === "past_due" &&
            !candidate.lockedAt &&
            candidate.updatedAt.getTime() < before.getTime()
        )
      );
    },
    patchSubscription(id: string, patch: SubscriptionPatch) {
      const at = rows.findIndex((candidate) => candidate.id === id);
      if (at !== -1) {
        rows[at] = { ...(rows[at] as Subscription), ...patch };
      }
      return Promise.resolve();
    },
    recipientFor() {
      return Promise.resolve(recipient);
    },
    recordEvent() {
      return Promise.resolve(true);
    },
    upsertSubscription() {
      return Promise.resolve(rows[0] as Subscription);
    },
  };

  sent.length = 0;

  return {
    forgetRecipient() {
      recipient = undefined;
    },
    rows,
    sent,
    store,
  };
}

describe("runPastDueLockout", () => {
  it("locks a past_due row older than the window and sends the locked email", async () => {
    const { rows, sent: mail, store } = fakeStore([row()]);

    const result = await runPastDueLockout(store, NOW, 14);

    assert.equal(result.locked, 1);
    assert.equal(result.notified, 1);
    assert.deepEqual(rows[0]?.lockedAt, NOW);
    assert.equal(mail[0]?.kind, "account.locked");
    assert.equal(mail[0]?.to.email, "ada@example.com");
    // The notification carries the row as it now stands, so the template can say the lock
    // happened rather than reading a row that still looks unlocked.
    assert.deepEqual(mail[0]?.subscription.lockedAt, NOW);
  });

  it("leaves a row still inside the window alone", async () => {
    const { rows, sent: mail, store } = fakeStore([row()]);

    const result = await runPastDueLockout(store, NOW, 30);

    assert.equal(result.locked, 0);
    assert.equal(rows[0]?.lockedAt, undefined);
    assert.equal(mail.length, 0);
  });

  it("leaves an active row alone however old it is", async () => {
    const { rows, store } = fakeStore([
      row({
        status: "active",
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ]);

    const result = await runPastDueLockout(store, NOW, 14);

    assert.equal(result.locked, 0);
    assert.equal(rows[0]?.lockedAt, undefined);
  });

  it("locks nothing twice, so a second tick the same day sends no second email", async () => {
    const { sent: mail, store } = fakeStore([row()]);

    await runPastDueLockout(store, NOW, 14);
    const second = await runPastDueLockout(store, NOW, 14);

    assert.equal(second.locked, 0);
    assert.equal(mail.length, 1);
  });

  it("still locks the row when the subject has no address to write to", async () => {
    const { forgetRecipient, rows, sent: mail, store } = fakeStore([row()]);
    forgetRecipient();

    const result = await runPastDueLockout(store, NOW, 14);

    assert.equal(result.locked, 1);
    assert.equal(result.notified, 0);
    assert.deepEqual(rows[0]?.lockedAt, NOW);
    assert.equal(mail.length, 0);
  });

  it("sweeps every matching row, not just the first", async () => {
    const { store } = fakeStore([
      row(),
      row({ id: "sub_row_2", providerSubscriptionId: "sub_2" }),
      row({ id: "sub_row_3", providerSubscriptionId: "sub_3" }),
    ]);

    const result = await runPastDueLockout(store, NOW, 14);

    assert.equal(result.locked, 3);
  });
});

describe("pastDueLockoutJob", () => {
  it("registers under a name the schedule enqueues", () => {
    assert.equal(pastDueLockoutJob().name, SUBSCRIPTION_PAST_DUE_LOCKOUT_JOB);
    assert.equal(
      pastDueLockoutSchedule().job,
      SUBSCRIPTION_PAST_DUE_LOCKOUT_JOB
    );
    assert.equal(
      pastDueLockoutSchedule().cron,
      SUBSCRIPTION_PAST_DUE_LOCKOUT_CRON
    );
    // A distinct name, because `defineSchedule` requires one and a trace reads it.
    assert.notEqual(
      pastDueLockoutSchedule().name,
      SUBSCRIPTION_PAST_DUE_LOCKOUT_JOB
    );
  });

  it("reads the window from the registered config", async () => {
    const { rows, store } = fakeStore([row()]);
    setSubscriptionStoreResolver(() => store);
    setSubscriptionConfig({ lockoutDays: 90 });

    const job = pastDueLockoutJob();
    await job.run(await job.parse({}), {});

    // 90 days of grace, and the row is 20 days past due, so nothing is locked.
    assert.equal(rows[0]?.lockedAt, undefined);
    assert.equal(subscriptionConfig().lockoutDays, 90);

    setSubscriptionConfig({ lockoutDays: 1 });
    await job.run(await job.parse({}), {});

    assert.ok(rows[0]?.lockedAt instanceof Date);
    setSubscriptionConfig({ lockoutDays: 14 });
  });
});
