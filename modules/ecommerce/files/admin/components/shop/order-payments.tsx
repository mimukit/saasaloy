import { useState } from "react";

import { Button } from "@repo/ui/components/shell/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/shell/dialog";
import { Field, FieldLabel } from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/shell/select";
import { Textarea } from "@repo/ui/components/shell/textarea";

import { PaymentStatusPill } from "@admin/components/shop/shop-pills";
import type { OrderPayment, RejectReason } from "@admin/lib/shop-api";
import { SHOP_LOCALE } from "@admin/lib/shop-dates";
import { amountText, methodLabel, parseAmount } from "@admin/lib/shop-format";
import { money } from "@admin/lib/shop-money";

// The Payments panel on the order page, and its two dialogs. Every decision goes through
// the existing `/admin/payment` routes (plan 0106, Phase 5): Confirm and Reject call the
// review route, and Record refund calls the refund route. The order keeps no paid flag; the
// payment listener moves the order when a COD payment is rejected with a delivery reason.

const REJECT_REASONS: readonly {
  id: RejectReason;
  label: string;
  for: "delivery" | "submission" | "both";
}[] = [
  {
    for: "delivery",
    id: "delivery_refused",
    label: "Delivery refused by the buyer",
  },
  { for: "delivery", id: "delivery_failed", label: "Delivery failed" },
  { for: "submission", id: "amount_mismatch", label: "Amount does not match" },
  { for: "submission", id: "not_found", label: "Transaction not found" },
  { for: "submission", id: "duplicate", label: "Duplicate submission" },
  { for: "both", id: "other", label: "Other" },
];

/** What staff may still refund on a successful payment. */
export function refundable(payment: OrderPayment): number {
  return payment.amount - payment.refundedAmount;
}

export function PaymentsPanel({
  payments,
  pending,
  onConfirm,
  onReject,
  onRefund,
}: {
  payments: readonly OrderPayment[];
  pending: boolean;
  onConfirm: (payment: OrderPayment) => void;
  onReject: (payment: OrderPayment) => void;
  onRefund: (payment: OrderPayment) => void;
}) {
  if (payments.length === 0) {
    return <p className="text-muted-foreground text-sm">No payment yet.</p>;
  }
  return (
    <ul className="divide-border flex flex-col divide-y">
      {payments.toReversed().map((payment) => (
        <li
          key={payment.id}
          className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">
              {methodLabel(payment.method)}
            </span>
            <span className="text-sm tabular-nums">
              {money(payment.amount, payment.currency, SHOP_LOCALE)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PaymentStatusPill status={payment.status} />
            {payment.transactionId === null ? null : (
              <span className="text-muted-foreground text-xs">
                Transaction ID{" "}
                <span className="font-mono">{payment.transactionId}</span>
              </span>
            )}
            {payment.refundedAmount > 0 ? (
              <span className="text-muted-foreground text-xs">
                Refunded{" "}
                {money(payment.refundedAmount, payment.currency, SHOP_LOCALE)}
              </span>
            ) : null}
          </div>
          {payment.reviewable ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={pending}
                onClick={() => {
                  onConfirm(payment);
                }}
              >
                {payment.takesNoSubmission
                  ? "Confirm cash received"
                  : "Confirm payment"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  onReject(payment);
                }}
              >
                Reject
              </Button>
            </div>
          ) : null}
          {payment.status === "successful" && refundable(payment) > 0 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                onRefund(payment);
              }}
            >
              Record refund
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function RejectPaymentDialog({
  payment,
  pending,
  error,
  onCancel,
  onReject,
}: {
  payment: OrderPayment | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onReject: (reason: RejectReason, note: string) => void;
}) {
  return (
    <Dialog
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogPopup>
        {payment === null ? null : (
          <RejectForm
            payment={payment}
            pending={pending}
            error={error}
            onReject={onReject}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function RejectForm({
  payment,
  pending,
  error,
  onReject,
}: {
  payment: OrderPayment;
  pending: boolean;
  error: string | null;
  onReject: (reason: RejectReason, note: string) => void;
}) {
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [note, setNote] = useState("");
  const kind = payment.takesNoSubmission ? "delivery" : "submission";
  const items = REJECT_REASONS.filter(
    (item) => item.for === kind || item.for === "both"
  ).map((item) => ({ label: item.label, value: item.id }));

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason !== null) {
          onReject(reason, note);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {payment.takesNoSubmission
            ? "Reject the COD payment"
            : "Reject the payment"}
        </DialogTitle>
        <DialogDescription>
          {methodLabel(payment.method)},{" "}
          {money(payment.amount, payment.currency, SHOP_LOCALE)}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Reason</FieldLabel>
          <Select
            items={items}
            value={reason}
            required
            onValueChange={(next: RejectReason | null) => {
              setReason(next);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a reason" />
            </SelectTrigger>
            <SelectPopup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Note (optional)</FieldLabel>
          <Textarea
            value={note}
            maxLength={1000}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
        <p className="text-muted-foreground text-sm">
          {payment.takesNoSubmission
            ? "A delivery reason marks a shipped order as returned."
            : "The buyer can pay again after a rejection."}
        </p>
        {error === null ? null : (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          type="submit"
          variant="destructive"
          disabled={pending || reason === null}
        >
          {pending ? "Rejecting…" : "Reject payment"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RefundDialog({
  payment,
  pending,
  error,
  onCancel,
  onRefund,
}: {
  payment: OrderPayment | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onRefund: (amount: number, note: string) => void;
}) {
  return (
    <Dialog
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogPopup>
        {payment === null ? null : (
          <RefundForm
            payment={payment}
            pending={pending}
            error={error}
            onRefund={onRefund}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function RefundForm({
  payment,
  pending,
  error,
  onRefund,
}: {
  payment: OrderPayment;
  pending: boolean;
  error: string | null;
  onRefund: (amount: number, note: string) => void;
}) {
  const remaining = refundable(payment);
  const [amount, setAmount] = useState(amountText(remaining, payment.currency));
  const [note, setNote] = useState("");
  const minor = parseAmount(amount, payment.currency);
  const valid = minor !== null && minor > 0 && minor <= remaining;

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          onRefund(minor, note);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Record a refund</DialogTitle>
        <DialogDescription>
          Record money you already sent back. Up to{" "}
          {money(remaining, payment.currency, SHOP_LOCALE)} is left to refund.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Amount ({payment.currency})</FieldLabel>
          <Input
            inputMode="decimal"
            required
            value={amount}
            aria-invalid={amount !== "" && !valid ? true : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel>Note (optional)</FieldLabel>
          <Textarea
            value={note}
            maxLength={1000}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
        {error === null ? null : (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Recording…" : "Record refund"}
        </Button>
      </DialogFooter>
    </form>
  );
}
