import { defineColumnClasses } from "../column-class";
import { payments as paymentsTable } from "../schema/payment";

// How the production read-only role reads `payments`. See `../column-class.ts`.

export const payments = defineColumnClasses(paymentsTable, {
  id: "plain",
  provider: "plain",
  method: "plain",
  status: "plain",
  amount: "plain",
  currency: "plain",
  settledAmount: "plain",
  claimedAmount: "plain",
  refundedAmount: "plain",
  referenceType: "plain",
  referenceId: "plain",
  userId: "plain",
  transactionId: "plain",
  transactionIdNormalized: "plain",
  // The payer's phone or bank account number.
  senderAccount: "pii",
  returnUrl: "plain",
  providerData: "plain",
  submittedAt: "plain",
  settledAt: "plain",
  createdAt: "plain",
  updatedAt: "plain",
});
