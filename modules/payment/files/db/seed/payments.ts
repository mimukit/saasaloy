import { payments as paymentsTable } from "../../schema/payment";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One payment for each state the admin Payments page shows differently: a hosted checkout
// still pending, a manual submission waiting for review, one whose claimed amount differs,
// a confirmed one, a confirmed one with a partial refund, a rejected one and a cancelled
// checkout. Each references a fake order and belongs to a seed user.
//
// Every row names the `console` provider, because it is the local provider every project
// can install. The manual rows still carry `instructions`, so the review queue shows the
// receiving account. The transaction ids start with `SEED`, and the dates are fixed, so a
// rerun writes the same rows.

const CREATED = new Date("2026-01-01T09:00:00.000Z");
const SUBMITTED = new Date("2026-01-01T09:05:00.000Z");
const SETTLED = new Date("2026-01-01T09:20:00.000Z");

const bkash = {
  instructions: {
    account: {
      kind: "personal",
      label: "bKash personal",
      number: "01700000111",
    },
    fields: [
      { id: "transactionId", label: "Transaction ID" },
      { id: "senderAccount", label: "Your bKash number" },
      { id: "amount", label: "Amount sent" },
    ],
  },
};

function payment(order: string, user: string, status: string) {
  return {
    amount: 125_000,
    createdAt: CREATED,
    currency: "BDT",
    method: "bkash",
    provider: "console",
    providerData: bkash,
    referenceId: order,
    referenceType: "order",
    status,
    userId: seedId("users", user),
  };
}

function submission(id: string) {
  return {
    claimedAmount: 125_000,
    senderAccount: "01712345678",
    submittedAt: SUBMITTED,
    transactionId: id,
    transactionIdNormalized: id,
  };
}

export const payments = defineSlice(paymentsTable, {
  rows: {
    "amount-differs": {
      ...payment("1002", "admin", "submitted"),
      ...submission("SEED0002"),
      claimedAmount: 100_000,
      method: "nagad",
    },
    cancelled: {
      ...payment("1006", "banned", "cancelled"),
      method: "card",
      providerData: null,
    },
    failed: {
      ...payment("1005", "member", "failed"),
      ...submission("SEED0005"),
    },
    pending: {
      ...payment("1000", "member", "pending"),
      method: "card",
      providerData: null,
    },
    refunded: {
      ...payment("1004", "superadmin", "successful"),
      ...submission("SEED0004"),
      refundedAmount: 25_000,
      settledAmount: 125_000,
      settledAt: SETTLED,
    },
    submitted: {
      ...payment("1001", "member", "submitted"),
      ...submission("SEED0001"),
    },
    successful: {
      ...payment("1003", "admin", "successful"),
      ...submission("SEED0003"),
      settledAmount: 125_000,
      settledAt: SETTLED,
    },
  },
});
