import { defineColumnClasses } from "../column-class";
import { subscriptions as subscriptionsTable } from "../schema/subscription";

// How the production read-only role reads `subscriptions`. See `../column-class.ts`.

export const subscriptions = defineColumnClasses(subscriptionsTable, {
  billingInterval: "plain",
  cancelAt: "plain",
  cancelAtPeriodEnd: "plain",
  canceledAt: "plain",
  createdAt: "plain",
  customerType: "plain",
  endedAt: "plain",
  id: "plain",
  lockedAt: "plain",
  metadata: "plain",
  periodEnd: "plain",
  periodStart: "plain",
  plan: "plain",
  providerCustomerId: "plain",
  providerScheduleId: "plain",
  providerSubscriptionId: "plain",
  referenceId: "plain",
  reminderSentAt: "plain",
  seats: "plain",
  status: "plain",
  trialEnd: "plain",
  trialStart: "plain",
  updatedAt: "plain",
});
