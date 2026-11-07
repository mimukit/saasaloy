import { defineColumnClasses } from "../column-class";
import { billingSubscriptions as billingSubscriptionsTable } from "../schema/billing";

// How the production read-only role reads `billing_subscriptions`. See `../column-class.ts`.

export const billingSubscriptions = defineColumnClasses(
  billingSubscriptionsTable,
  {
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
  }
);
