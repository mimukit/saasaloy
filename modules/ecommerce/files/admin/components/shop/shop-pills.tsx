import { Badge } from "@repo/ui/components/shell/badge";
import { StatusPill } from "@repo/ui/components/shell/status-pill";

import {
  COD_METHOD,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  methodLabel,
  orderStatus,
} from "@admin/lib/shop-format";

// The pills every shop screen shares. A state takes a status pill and a tag takes a badge
// (DESIGN.md, "Colors"): an order's or a payment's status is a state, COD is a tag.

export function OrderStatusPill({ status }: { status: string }) {
  const known = orderStatus(status);
  return (
    <StatusPill
      label={ORDER_STATUS_LABEL[known]}
      tone={ORDER_STATUS_TONE[known]}
    />
  );
}

export function PaymentStatusPill({ status }: { status: string }) {
  return (
    <StatusPill
      label={PAYMENT_STATUS_LABEL[status] ?? status}
      tone={PAYMENT_STATUS_TONE[status] ?? "neutral"}
    />
  );
}

/** The COD tag on an order, or the method's name for any other method. */
export function MethodTag({ method }: { method: string | null }) {
  if (method === null) {
    return null;
  }
  return (
    <Badge variant="outline">
      {method === COD_METHOD ? "COD" : methodLabel(method)}
    </Badge>
  );
}

export function ProductStatusPill({ status }: { status: string }) {
  return status === "active" ? (
    <StatusPill label="Active" tone="ok" />
  ) : (
    <StatusPill label="Draft" tone="neutral" />
  );
}
