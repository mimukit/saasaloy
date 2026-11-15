import type { AuditActionMap } from "../lib/audit-actions";

// The payment module's audit actions, one per staff decision. The descriptor's
// `plugin-array` patch appends `paymentAuditActions()` into `AUDIT_ACTIONS` in
// `../lib/audit-actions.ts`, so `saasaloy remove payment` takes these with it.
//
// A review route carries two actions, because confirm and reject are two decisions on one
// URL. The target is the payment, and its label is the payment's reference, the same
// `<referenceType> · <referenceId>` the Payments screen shows.
export function paymentAuditActions() {
  return {
    "payment.refund.create": {
      area: "payments",
      areaLabel: "Payments",
      label: "Recorded a refund",
      route: "POST /admin/payment/payments/:id/refunds",
      target: "payment",
    },
    "payment.review.confirm": {
      area: "payments",
      label: "Confirmed a payment",
      route: "POST /admin/payment/payments/:id/review",
      target: "payment",
    },
    "payment.review.reject": {
      area: "payments",
      label: "Rejected a payment",
      route: "POST /admin/payment/payments/:id/review",
      target: "payment",
    },
  } as const satisfies AuditActionMap;
}
