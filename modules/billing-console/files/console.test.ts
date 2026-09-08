// Tests for the local provider: checkout, portal, change-plan, cancel and restore, plus
// the event each one mints and what `applyEvent` makes of it. Like the core's tests this
// file is repo-only — the descriptor ships `console.ts` and nothing else — and it runs on
// `node:test` via `pnpm test:modules`.
//
// Nothing is stubbed except the database. `../index` resolves through the shim beside this
// module to the real `packages/billing` barrel, so every assertion goes through the same
// provider selection, error normalization and dedupe rule a deployed Worker uses. The
// `BillingStore` is a fake because the port exists precisely so the core's rules can be
// tested without an ORM.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { consoleBilling } from "./console.ts";
import {
  applyEvent,
  billing,
  createBilling,
  currentSubscription,
} from "../index.ts";
import type {
  BillableSubject,
  BillingEvent,
  BillingStore,
  HostContext,
  Subscription,
  SubscriptionInput,
  SubscriptionPatch,
} from "../index.ts";
import { BillingError } from "../provider.ts";

const ENV = { BILLING_PROVIDER: "console" };
const HOST: HostContext = { auth: null, headers: new Headers() };
const SUBJECT: BillableSubject = { customerType: "user", referenceId: "u_1" };

/** The projection, in memory. Same rules as `apps/api/src/billing-store.ts`, no SQL. */
function fakeStore(): BillingStore & { rows: Subscription[] } {
  const events = new Set<string>();
  const rows: Subscription[] = [];

  return {
    latestSubscription(subject: BillableSubject) {
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
    patchSubscription(id: string, patch: SubscriptionPatch) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) {
        Object.assign(row, patch);
      }
      return Promise.resolve();
    },
    recordEvent(record) {
      const key = `${record.provider}:${record.providerEventId}`;
      if (events.has(key)) {
        return Promise.resolve(false);
      }
      events.add(key);
      return Promise.resolve(true);
    },
    rows,
    upsertSubscription(subject: BillableSubject, input: SubscriptionInput) {
      const existing = rows.find(
        (row) => row.providerSubscriptionId === input.providerSubscriptionId
      );
      if (existing) {
        Object.assign(existing, input, { updatedAt: new Date() });
        return Promise.resolve(existing);
      }
      const row: Subscription = {
        ...input,
        createdAt: new Date(),
        customerType: subject.customerType,
        id: `row_${rows.length + 1}`,
        referenceId: subject.referenceId,
        updatedAt: new Date(),
      };
      rows.push(row);
      return Promise.resolve(row);
    },
  };
}

/** What `apps/api/src/routes/billing.ts` does with a `CheckoutResult.event`. */
async function deliver(
  store: BillingStore,
  event: BillingEvent | undefined
): Promise<void> {
  if (event) {
    await applyEvent(store, event);
  }
}

describe("billing-console", () => {
  let store: ReturnType<typeof fakeStore>;

  beforeEach(() => {
    store = fakeStore();
    // Register the provider the way the `plugin-array` patch does at install time, so the
    // selection under test is the real `BILLING_PROVIDER` lookup rather than a direct call.
    billing.providers.length = 0;
    billing.providers.push(consoleBilling());
  });

  it("is selected by BILLING_PROVIDER=console", () => {
    assert.equal(createBilling(ENV).provider, "console");
  });

  it("still refuses an unset BILLING_PROVIDER, with one provider installed", () => {
    assert.throws(() => createBilling({}), /BILLING_PROVIDER is not set/u);
  });

  it("completes a checkout with no network and returns the success url", async () => {
    const client = createBilling(ENV);
    const result = await client.createCheckout(HOST, {
      cancelUrl: "https://app.test/cancel",
      interval: "monthly",
      planId: "pro",
      subject: SUBJECT,
      successUrl: "https://app.test/done",
    });

    assert.equal(result.url, "https://app.test/done");
    assert.ok(
      result.event,
      "a provider with no webhook has to mint the event itself"
    );

    await deliver(store, result.event);

    const live = await currentSubscription(store, SUBJECT);
    assert.equal(live?.plan, "pro");
    // `pro` carries trialDays, so the row opens in trial rather than active.
    assert.equal(live?.status, "trialing");
    assert.match(live?.providerSubscriptionId ?? "", /^console_sub_/u);
    assert.match(live?.providerCustomerId ?? "", /^console_cus_/u);
    assert.equal(live?.billingInterval, "month");
  });

  it("refuses a plan the project does not have", async () => {
    await assert.rejects(
      createBilling(ENV).createCheckout(HOST, {
        cancelUrl: "https://app.test/cancel",
        interval: "monthly",
        planId: "enterprise",
        subject: SUBJECT,
        successUrl: "https://app.test/done",
      }),
      (error: unknown) =>
        error instanceof BillingError && error.code === "not_found"
    );
  });

  it("sends the portal caller back where it came from", async () => {
    const { url } = await createBilling(ENV).createPortal(HOST, {
      returnUrl: "https://app.test/billing",
      subject: SUBJECT,
    });
    assert.equal(url, "https://app.test/billing");
  });

  it("cancels the live row rather than a guess at it", async () => {
    const client = createBilling(ENV);
    await deliver(
      store,
      (
        await client.createCheckout(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "yearly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      ).event
    );

    const current = await currentSubscription(store, SUBJECT);
    const result = await client.cancel(HOST, { current, subject: SUBJECT });
    await deliver(store, result?.event);

    const after = await currentSubscription(store, SUBJECT);
    assert.equal(after?.cancelAtPeriodEnd, true);
    // The plan survives the cancel. This is the assertion the whole `current` field exists
    // for: without it the provider would have to invent a plan and write it over this one.
    assert.equal(after?.plan, "pro");
    assert.equal(after?.billingInterval, "year");
    assert.equal(
      store.rows.length,
      1,
      "cancel updates the row, never stacks a second"
    );
  });

  it("restores a pending cancellation", async () => {
    const client = createBilling(ENV);
    await deliver(
      store,
      (
        await client.createCheckout(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "monthly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      ).event
    );
    await deliver(
      store,
      (
        await client.cancel(HOST, {
          current: await currentSubscription(store, SUBJECT),
          subject: SUBJECT,
        })
      )?.event
    );
    await deliver(
      store,
      (
        await client.restore(HOST, {
          current: await currentSubscription(store, SUBJECT),
          subject: SUBJECT,
        })
      )?.event
    );

    const after = await currentSubscription(store, SUBJECT);
    assert.equal(after?.cancelAtPeriodEnd, false);
    assert.equal(after?.cancelAt, null);
  });

  it("refuses a cancel with no live subscription, as a not_found", async () => {
    await assert.rejects(
      createBilling(ENV).cancel(HOST, { subject: SUBJECT }),
      (error: unknown) =>
        error instanceof BillingError &&
        error.code === "not_found" &&
        error.providerCode === "no_subscription"
    );
  });

  it("moves a live subscription to another plan on the same row", async () => {
    const client = createBilling(ENV);
    await deliver(
      store,
      (
        await client.createCheckout(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "monthly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      ).event
    );
    await deliver(
      store,
      (
        await client.changePlan(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "yearly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      ).event
    );

    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0]?.billingInterval, "year");
  });

  it("lists no invoices, because it has no vendor to list them from", async () => {
    assert.deepEqual(
      await createBilling(ENV).listInvoices(HOST, { subject: SUBJECT }),
      []
    );
  });

  it("rejects a seat count below one, as a normalized BillingError", async () => {
    await assert.rejects(
      createBilling(ENV).setQuantity(HOST, { seats: 0, subject: SUBJECT }),
      (error: unknown) =>
        error instanceof BillingError &&
        error.code === "invalid_request" &&
        error.providerCode === "invalid_seats"
    );
  });

  it("applies a redelivered event exactly once", async () => {
    const result = await createBilling(ENV).createCheckout(HOST, {
      cancelUrl: "https://app.test/cancel",
      interval: "monthly",
      planId: "pro",
      subject: SUBJECT,
      successUrl: "https://app.test/done",
    });

    const first = await applyEvent(store, result.event as BillingEvent);
    const second = await applyEvent(store, result.event as BillingEvent);

    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.duplicate, true);
    assert.equal(store.rows.length, 1);
  });
});
