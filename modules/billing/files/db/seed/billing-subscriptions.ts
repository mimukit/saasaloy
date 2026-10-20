import { billingSubscriptions as billingSubscriptionsTable } from "../../schema/billing";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One subscription for each normalized status, plus a `past_due` row the lockout job has
// locked, which the admin page shows apart from a plain `past_due`. Each belongs to a seed
// user, so a user also carries a history row: the superadmin's old canceled plan, say.
//
// The provider ids start with `seed_`, so no vendor ever answers for them. The dates are
// fixed, so a rerun writes the same rows.

const START = new Date("2026-01-01T00:00:00.000Z");
const END = new Date("2099-01-01T00:00:00.000Z");

function subscription(slug: string, user: string, status: string) {
  return {
    billingInterval: "month",
    periodEnd: END,
    periodStart: START,
    plan: "pro",
    providerCustomerId: `seed_cus_${user}`,
    providerSubscriptionId: `seed_sub_${slug}`,
    referenceId: seedId("users", user),
    status,
  };
}

export const billingSubscriptions = defineSlice(billingSubscriptionsTable, {
  rows: {
    active: subscription("active", "superadmin", "active"),
    canceled: {
      ...subscription("canceled", "superadmin", "canceled"),
      canceledAt: START,
      endedAt: START,
    },
    incomplete: subscription("incomplete", "admin", "incomplete"),
    "past-due": subscription("past-due", "member", "past_due"),
    "past-due-locked": {
      ...subscription("past-due-locked", "banned", "past_due"),
      lockedAt: START,
    },
    paused: subscription("paused", "banned", "paused"),
    trialing: {
      ...subscription("trialing", "admin", "trialing"),
      trialEnd: END,
      trialStart: START,
    },
    unpaid: subscription("unpaid", "member", "unpaid"),
  },
});
