import { paymentEvents as paymentEventsTable } from "../../schema/payment";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// The history behind each seed payment in `payments.ts`: a creation row for every payment,
// a submission for the manual ones, and the staff decision for the confirmed and rejected
// ones. The rejection carries a reason and a note, as the reject dialog requires.

const AT = {
  created: new Date("2026-01-01T09:00:00.000Z"),
  submitted: new Date("2026-01-01T09:05:00.000Z"),
  decided: new Date("2026-01-01T09:20:00.000Z"),
};

function event(
  payment: string,
  fromStatus: string | null,
  toStatus: string,
  createdAt: Date
) {
  return {
    actorUserId: null,
    createdAt,
    fromStatus,
    paymentId: seedId("payments", payment),
    toStatus,
  };
}

const created = (payment: string) =>
  event(payment, null, "pending", AT.created);
const submitted = (payment: string) =>
  event(payment, "pending", "submitted", AT.submitted);

export const paymentEvents = defineSlice(paymentEventsTable, {
  rows: {
    "amount-differs-created": created("amount-differs"),
    "amount-differs-submitted": submitted("amount-differs"),
    "cancelled-cancelled": event(
      "cancelled",
      "pending",
      "cancelled",
      AT.decided
    ),
    "cancelled-created": created("cancelled"),
    "failed-created": created("failed"),
    "failed-rejected": {
      ...event("failed", "submitted", "failed", AT.decided),
      actorUserId: seedId("users", "admin"),
      note: "We found no bKash payment with this transaction ID. Check the ID and submit again.",
      reason: "not_found",
    },
    "failed-submitted": submitted("failed"),
    "pending-created": created("pending"),
    "refunded-confirmed": {
      ...event("refunded", "submitted", "successful", AT.decided),
      actorUserId: seedId("users", "admin"),
    },
    "refunded-created": created("refunded"),
    "refunded-submitted": submitted("refunded"),
    "submitted-created": created("submitted"),
    "submitted-submitted": submitted("submitted"),
    "successful-confirmed": {
      ...event("successful", "submitted", "successful", AT.decided),
      actorUserId: seedId("users", "superadmin"),
    },
    "successful-created": created("successful"),
    "successful-submitted": submitted("successful"),
  },
});
