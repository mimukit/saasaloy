// Tests for the daily renewal sweep: which rows it marks, which it leaves, and how many
// emails one row is worth. Repo-only, like ./past-due-lockout.test.ts, and it runs on
// `node:test` via `pnpm test:modules`.
//
// The clock and the provider set are both parameters of `runRenewalDue(db, now, providers)`,
// so a period boundary is driven rather than waited for and no provider has to be registered
// to test the filter.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setBillingNotifier } from "../notify.ts";
import type { BillingNotification } from "../notify.ts";
import type { BillableSubject, Subscription } from "../provider.ts";
import type { BillingStore, SubscriptionPatch } from "../subscription.ts";
import {
  BILLING_RENEWAL_DUE_CRON,
  BILLING_RENEWAL_DUE_JOB,
  renewalDueJob,
  renewalDueSchedule,
  runRenewalDue,
} from "./renewal-due.ts";

const SUBJECT: BillableSubject = {
  customerType: "user",
  referenceId: "user_1",
};
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-21T02:00:00.000Z");

const sent: BillingNotification[] = [];
setBillingNotifier((notification) => {
  sent.push(notification);
  return Promise.resolve();
});

function row(overrides: Partial<Subscription> = {}): Subscription {
  return {
    createdAt: new Date(NOW.getTime() - 40 * DAY),
    customerType: SUBJECT.customerType,
    id: "sub_row_1",
    // Ended yesterday, so the sweep's first tick after the period is the one that catches it.
    periodEnd: new Date(NOW.getTime() - DAY),
    plan: "pro",
    provider: "sslcommerz",
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    referenceId: SUBJECT.referenceId,
    status: "active",
    updatedAt: new Date(NOW.getTime() - 30 * DAY),
    ...overrides,
  };
}

function fakeStore(seed: Subscription[] = []) {
  const rows = [...seed];
  let recipient = { email: "ada@example.com" } as { email: string } | undefined;

  // The same rule the Drizzle implementation writes as SQL. Kept here rather than assumed,
  // because the provider filter is the whole point of the column this plan added.
  const store: BillingStore = {
    latestSubscription() {
      return Promise.resolve(rows.at(-1));
    },
    markEventProcessed() {
      return Promise.resolve();
    },
    pastDueSince() {
      return Promise.resolve([]);
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
    renewalDue(at: Date, providers: string[]) {
      return Promise.resolve(
        rows.filter(
          (candidate) =>
            providers.includes(candidate.provider ?? "") &&
            !candidate.lockedAt &&
            ((candidate.status === "active" &&
              (candidate.periodEnd?.getTime() ?? Infinity) < at.getTime()) ||
              (candidate.status === "trialing" &&
                (candidate.trialEnd?.getTime() ?? Infinity) < at.getTime()))
        )
      );
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

describe("runRenewalDue", () => {
  it("marks an active row whose period ended and sends one renewal-due email", async () => {
    const { rows, sent: mail, store } = fakeStore([row()]);

    const result = await runRenewalDue(store, NOW, ["sslcommerz"]);

    assert.deepEqual(result, { due: 1, notified: 1 });
    assert.equal(rows[0]?.status, "past_due");
    assert.deepEqual(rows[0]?.reminderSentAt, NOW);
    assert.equal(mail.length, 1);
    assert.equal(mail[0]?.kind, "renewal.due");
    assert.equal(mail[0]?.subscription.status, "past_due");
    // The write moved `updatedAt` forward, which is what the lockout date is counted off.
    assert.deepEqual(mail[0]?.subscription.updatedAt, NOW);
  });

  it("marks a trialing row whose trial ended", async () => {
    const { rows, store } = fakeStore([
      row({
        periodEnd: new Date(NOW.getTime() + 10 * DAY),
        status: "trialing",
        trialEnd: new Date(NOW.getTime() - DAY),
      }),
    ]);

    const result = await runRenewalDue(store, NOW, ["sslcommerz"]);

    assert.equal(result.due, 1);
    assert.equal(rows[0]?.status, "past_due");
  });

  it("leaves a row whose period is still running", async () => {
    const {
      rows,
      sent: mail,
      store,
    } = fakeStore([row({ periodEnd: new Date(NOW.getTime() + DAY) })]);

    const result = await runRenewalDue(store, NOW, ["sslcommerz"]);

    assert.deepEqual(result, { due: 0, notified: 0 });
    assert.equal(rows[0]?.status, "active");
    assert.equal(mail.length, 0);
  });

  it("leaves a row owned by a provider that renews at the vendor", async () => {
    const { rows, store } = fakeStore([row({ provider: "stripe" })]);

    const result = await runRenewalDue(store, NOW, ["sslcommerz"]);

    assert.equal(result.due, 0);
    assert.equal(rows[0]?.status, "active");
  });

  it("leaves every row when nothing installed renews manually", async () => {
    const { rows, store } = fakeStore([row()]);

    const result = await runRenewalDue(store, NOW, []);

    assert.deepEqual(result, { due: 0, notified: 0 });
    assert.equal(rows[0]?.status, "active");
  });

  it("leaves a row the lockout job already locked", async () => {
    const { rows, store } = fakeStore([row({ lockedAt: NOW })]);

    const result = await runRenewalDue(store, NOW, ["sslcommerz"]);

    assert.equal(result.due, 0);
    assert.equal(rows[0]?.status, "active");
  });

  it("sends no second email to a row that already carries reminderSentAt", async () => {
    const {
      rows,
      sent: mail,
      store,
    } = fakeStore([
      row({ reminderSentAt: new Date(NOW.getTime() - 10 * DAY) }),
    ]);

    const result = await runRenewalDue(store, NOW, ["sslcommerz"]);

    // Still marked: the status write is what the lockout job counts from, and it is owed
    // whether or not the subject can be emailed.
    assert.equal(result.due, 1);
    assert.equal(result.notified, 0);
    assert.equal(rows[0]?.status, "past_due");
    assert.equal(mail.length, 0);
  });

  it("marks the row even when the subject has no resolvable address", async () => {
    const seeded = fakeStore([row()]);
    seeded.forgetRecipient();

    const result = await runRenewalDue(seeded.store, NOW, ["sslcommerz"]);

    assert.deepEqual(result, { due: 1, notified: 0 });
    assert.equal(seeded.rows[0]?.status, "past_due");
    assert.equal(seeded.sent.length, 0);
  });
});

describe("renewalDueJob / renewalDueSchedule", () => {
  it("registers under the name the schedule names", () => {
    assert.equal(renewalDueJob().name, BILLING_RENEWAL_DUE_JOB);
    assert.equal(renewalDueSchedule().job, BILLING_RENEWAL_DUE_JOB);
    assert.equal(renewalDueJob().durable, false);
  });

  it("runs an hour before the lockout sweep, so a window opens the day it should", () => {
    assert.equal(BILLING_RENEWAL_DUE_CRON, "0 2 * * *");
    assert.equal(renewalDueSchedule().cron, BILLING_RENEWAL_DUE_CRON);
  });
});
