import { paymentRefunds as paymentRefundsTable } from "../../schema/payment";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One partial refund that staff sent by hand, on the `refunded` seed payment. Its amount
// matches that payment's `refundedAmount`, so the page's refundable figure adds up.

export const paymentRefunds = defineSlice(paymentRefundsTable, {
  rows: {
    partial: {
      actorUserId: seedId("users", "superadmin"),
      amount: 25_000,
      createdAt: new Date("2026-01-02T10:00:00.000Z"),
      note: "Part of the order was out of stock. Sent back by bKash.",
      paymentId: seedId("payments", "refunded"),
      providerRefundId: null,
    },
  },
});
