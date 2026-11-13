import { defineColumnClasses } from "../column-class";
import { paymentRefunds as paymentRefundsTable } from "../schema/payment";

// How the production read-only role reads `payment_refunds`. See `../column-class.ts`.

export const paymentRefunds = defineColumnClasses(paymentRefundsTable, {
  id: "plain",
  paymentId: "plain",
  amount: "plain",
  // Free text staff wrote about the refund.
  note: "pii",
  actorUserId: "plain",
  providerRefundId: "plain",
  createdAt: "plain",
});
