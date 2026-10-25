// Tests for the local provider: checkout, portal, change-plan, cancel and restore, plus
// the event each one mints and what `applyEvent` makes of it. `add billing-console` ships this
// file as `console.test.ts` when the project's testing mode is on. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest.
//
// Nothing is stubbed except the database. `../index` resolves by its project path to the
// real `packages/billing` barrel, so every assertion goes through the same
// provider selection, error normalization and dedupe rule a deployed Worker uses. The
// `BillingStore` is a fake because the port exists precisely so the core's rules can be
// tested without an ORM.

import { beforeEach, describe, expect, it } from "vitest";
import { consoleBilling } from "./console";
import {
  applyEvent,
  billing,
  createBilling,
  currentSubscription,
} from "../index";
import type {
  BillableSubject,
  BillingEvent,
  BillingStore,
  HostContext,
  Subscription,
  SubscriptionInput,
  SubscriptionPatch,
} from "../index";
import { BillingError } from "../provider";

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
    // The lockout job and the notifier read these; no console test reaches them.
    pastDueSince() {
      return Promise.resolve([]);
    },
    recipientFor() {
      return Promise.resolve({ email: "ada@example.com" });
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

/** The event a provider call mints, if it mints one. */
async function eventOf(
  pending: Promise<{ event?: BillingEvent } | undefined>
): Promise<BillingEvent | undefined> {
  const result = await pending;
  return result?.event;
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
    expect(createBilling(ENV).provider).toBe("console");
  });

  it("still refuses an unset BILLING_PROVIDER, with one provider installed", () => {
    expect(() => createBilling({})).toThrow(/BILLING_PROVIDER is not set/u);
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

    expect(result.url).toBe("https://app.test/done");
    // A provider with no webhook has to mint the event itself.
    expect(result.event).toBeTruthy();
  });

  it("opens the bought row from the checkout event it mints", async () => {
    const result = await createBilling(ENV).createCheckout(HOST, {
      cancelUrl: "https://app.test/cancel",
      interval: "monthly",
      planId: "pro",
      subject: SUBJECT,
      successUrl: "https://app.test/done",
    });
    await deliver(store, result.event);

    const live = await currentSubscription(store, SUBJECT);
    // `pro` carries trialDays, so the row opens in trial rather than active.
    expect(live).toMatchObject({
      billingInterval: "month",
      plan: "pro",
      providerCustomerId: expect.stringMatching(/^console_cus_/u),
      providerSubscriptionId: expect.stringMatching(/^console_sub_/u),
      status: "trialing",
    });
  });

  it("refuses a plan the project does not have", async () => {
    await expect(
      createBilling(ENV).createCheckout(HOST, {
        cancelUrl: "https://app.test/cancel",
        interval: "monthly",
        planId: "enterprise",
        subject: SUBJECT,
        successUrl: "https://app.test/done",
      })
    ).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError && error.code === "not_found"
      )
    );
  });

  it("sends the portal caller back where it came from", async () => {
    const { url } = await createBilling(ENV).createPortal(HOST, {
      returnUrl: "https://app.test/billing",
      subject: SUBJECT,
    });
    expect(url).toBe("https://app.test/billing");
  });

  it("cancels the live row rather than a guess at it", async () => {
    const client = createBilling(ENV);
    await deliver(
      store,
      await eventOf(
        client.createCheckout(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "yearly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      )
    );

    const current = await currentSubscription(store, SUBJECT);
    const result = await client.cancel(HOST, { current, subject: SUBJECT });
    await deliver(store, result?.event);

    const after = await currentSubscription(store, SUBJECT);
    expect(after?.cancelAtPeriodEnd).toBeTruthy();
    // The plan survives the cancel. This is the assertion the whole `current` field exists
    // for: without it the provider would have to invent a plan and write it over this one.
    expect(after?.plan).toBe("pro");
    expect(after?.billingInterval).toBe("year");
    expect(store.rows).toHaveLength(1);
  });

  it("restores a pending cancellation", async () => {
    const client = createBilling(ENV);
    await deliver(
      store,
      await eventOf(
        client.createCheckout(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "monthly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      )
    );
    await deliver(
      store,
      await eventOf(
        client.cancel(HOST, {
          current: await currentSubscription(store, SUBJECT),
          subject: SUBJECT,
        })
      )
    );
    await deliver(
      store,
      await eventOf(
        client.restore(HOST, {
          current: await currentSubscription(store, SUBJECT),
          subject: SUBJECT,
        })
      )
    );

    const after = await currentSubscription(store, SUBJECT);
    expect(after?.cancelAtPeriodEnd).toBeFalsy();
    expect(after?.cancelAt).toBeNull();
  });

  it("refuses a cancel with no live subscription, as a not_found", async () => {
    await expect(
      createBilling(ENV).cancel(HOST, { subject: SUBJECT })
    ).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError &&
          error.code === "not_found" &&
          error.providerCode === "no_subscription"
      )
    );
  });

  it("moves a live subscription to another plan on the same row", async () => {
    const client = createBilling(ENV);
    await deliver(
      store,
      await eventOf(
        client.createCheckout(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "monthly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      )
    );
    await deliver(
      store,
      await eventOf(
        client.changePlan(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "yearly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      )
    );

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.billingInterval).toBe("year");
  });

  it("carries a running trial across a plan change instead of restarting it", async () => {
    const client = createBilling(ENV);
    await deliver(
      store,
      await eventOf(
        client.createCheckout(HOST, {
          cancelUrl: "https://app.test/cancel",
          interval: "monthly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      )
    );
    const [bought] = store.rows;
    expect(bought?.status).toBe("trialing");

    // The route reads the live row and hands it over, which is the only way a provider with
    // no database can know a trial is running. Stripe carries `trial_end` across an upgrade;
    // restarting it here would hand every plan change another free fortnight.
    await deliver(
      store,
      await eventOf(
        client.changePlan(HOST, {
          cancelUrl: "https://app.test/cancel",
          current: bought,
          interval: "yearly",
          planId: "pro",
          subject: SUBJECT,
          successUrl: "https://app.test/done",
        })
      )
    );

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.status).toBe("trialing");
    expect(store.rows[0]?.trialEnd).toStrictEqual(bought?.trialEnd);
    expect(store.rows[0]?.trialStart).toStrictEqual(bought?.trialStart);
  });

  it("lists no invoices, because it has no vendor to list them from", async () => {
    await expect(
      createBilling(ENV).listInvoices(HOST, { subject: SUBJECT })
    ).resolves.toStrictEqual([]);
  });

  it("rejects a seat count below one, as a normalized BillingError", async () => {
    await expect(
      createBilling(ENV).setQuantity(HOST, { seats: 0, subject: SUBJECT })
    ).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof BillingError &&
          error.code === "invalid_request" &&
          error.providerCode === "invalid_seats"
      )
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

    expect(first.applied).toBeTruthy();
    expect(second.applied).toBeFalsy();
    expect(second.duplicate).toBeTruthy();
    expect(store.rows).toHaveLength(1);
  });
});
