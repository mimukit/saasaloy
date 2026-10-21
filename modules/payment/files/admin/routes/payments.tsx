import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  BanknoteIcon,
  HistoryIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { DataTable } from "@admin/components/data-table";
import type { DataTableColumn } from "@admin/components/data-table";
import { DetailPanel } from "@admin/components/detail-panel";
import { FilterChips } from "@admin/components/filter-chips";
import { PageHeader } from "@admin/components/page-header";
import { PageLayout } from "@admin/components/page-layout";
import { StatusPill } from "@admin/components/status-pill";
import { api } from "@admin/lib/api";

// The Payments screen at `/payments`, shipped by `modules/payment`. The router plugin wires
// it from the path, and the module's `nav-entry` patch adds the "Payments" row under Manage.
//
// It lists one-time payments from every installed provider, and it is the review queue for
// the providers that cannot check a payment themselves. A `submitted` payment is a claim: a
// shopper says they sent money and typed a transaction ID. Nothing on this screen verifies
// that claim. The staff member finds the ID in the receiving account's own statement, then
// confirms or rejects here, and the api records who decided.
//
// Every call goes to `apps/api`'s `/admin/payment` routes behind `requireAdmin`, and this
// file names no provider. Adding `payment-manual` or a gateway later changes the rows, not
// this file.

const STATUS_FILTERS = [
  { id: "submitted", label: "Submitted" },
  { id: "successful", label: "Successful" },
  { id: "failed", label: "Failed" },
  { id: "pending", label: "Pending" },
  { id: "cancelled", label: "Cancelled" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["id"];

const STATUS_LABEL: Record<StatusFilter, string> = {
  cancelled: "Cancelled",
  failed: "Failed",
  pending: "Pending",
  submitted: "Submitted",
  successful: "Successful",
};

const REJECT_REASONS = [
  { id: "amount_mismatch", label: "Amount does not match" },
  { id: "not_found", label: "Transaction not found" },
  { id: "duplicate", label: "Duplicate submission" },
  { id: "other", label: "Other" },
] as const;

type RejectReason = (typeof REJECT_REASONS)[number]["id"];

const LIST_KEY = ["admin", "payment", "payments"] as const;

const paymentsQuery = (status: StatusFilter) =>
  queryOptions({
    queryKey: [...LIST_KEY, "list", status],
    queryFn: async () => {
      const res = await api.admin.payment.payments.$get({ query: { status } });
      // `res.status === 200`, not `res.ok`: `hc` keys the body type by status code, and
      // the narrow is what drops the error envelope out of the union.
      if (res.status !== 200) {
        throw new Error(`The api answered ${String(res.status)}.`);
      }
      return res.json();
    },
  });

const paymentQuery = (id: string) =>
  queryOptions({
    queryKey: [...LIST_KEY, "detail", id],
    queryFn: async () => {
      const res = await api.admin.payment.payments[":id"].$get({
        param: { id },
      });
      if (res.status !== 200) {
        throw new Error(`The api answered ${String(res.status)}.`);
      }
      return res.json();
    },
  });

export const Route = createFileRoute("/payments")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(paymentsQuery("submitted")),
  component: Payments,
  errorComponent: PaymentsError,
});

/**
 * One row and one detail, taken from the queries' own return types rather than
 * redeclared, so a field the api drops lands as a typecheck failure in this file.
 */
type Payment = Awaited<
  ReturnType<NonNullable<ReturnType<typeof paymentsQuery>["queryFn"]>>
>["payments"][number];

type PaymentDetail = Awaited<
  ReturnType<NonNullable<ReturnType<typeof paymentQuery>["queryFn"]>>
>;

type PaymentEvent = PaymentDetail["events"][number];

/** A 409 from a review: another staff member decided first. Shown as a toast, not inline. */
class ReviewConflictError extends Error {
  override name = "ReviewConflictError";
}

/** The api's error envelope, read off any non-200 body, or a fallback sentence. */
function errorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return fallback;
}

// The api stores every amount in the currency's minor unit. The exponent comes from the
// currency, not a hard 100: JPY has no minor unit, and dividing by 100 would show ¥9900
// as ¥99.
function currencyFormat(currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency: currency.toUpperCase(),
    style: "currency",
  });
}

function minorDigits(currency: string): number {
  return currencyFormat(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

function money(amount: number, currency: string): string {
  return currencyFormat(currency).format(amount / 10 ** minorDigits(currency));
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
  style: "short",
});

/** "5 min ago", "1 hr ago", "yesterday": the table's time columns. */
function ago(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      return RELATIVE.format(Math.round(value), unit);
    }
    value /= size;
  }
  return RELATIVE.format(Math.round(value), "year");
}

function dateTime(iso: string | null): string | null {
  return iso === null
    ? null
    : new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });
}

function reference(payment: Payment): string {
  return `${payment.referenceType} · ${payment.referenceId}`;
}

/** `bkash_personal` reads "Bkash personal". A provider owns the method id, not this page. */
function methodLabel(method: string): string {
  const words = method.replaceAll(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function amountDiffers(payment: Payment): boolean {
  return (
    payment.claimedAmount !== null && payment.claimedAmount !== payment.amount
  );
}

/** What a refund may still return: the settled figure, less what went back already. */
function refundable(payment: Payment): number {
  return (payment.settledAmount ?? payment.amount) - payment.refundedAmount;
}

// Two tones, as StatusPill allows. `submitted` is the live state on this screen, the one
// that waits for a person, so it alone takes the blue pill.
function statusPill(status: StatusFilter) {
  return (
    <StatusPill
      label={STATUS_LABEL[status]}
      tone={status === "submitted" ? "open" : "neutral"}
    />
  );
}

function StatusCell({ payment }: { payment: Payment }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {statusPill(payment.status)}
      {amountDiffers(payment) ? (
        <StatusPill
          label="Amount differs"
          icon={<TriangleAlertIcon />}
          tone="neutral"
        />
      ) : null}
      {payment.refundedAmount > 0 ? (
        <StatusPill
          label={`Refunded ${money(payment.refundedAmount, payment.currency)}`}
          tone="neutral"
        />
      ) : null}
    </span>
  );
}

const referenceColumn: DataTableColumn<Payment> = {
  id: "reference",
  header: "Reference",
  value: reference,
  sortable: true,
  cell: (payment) => (
    <span className="truncate font-medium">{reference(payment)}</span>
  ),
};

const methodColumn: DataTableColumn<Payment> = {
  id: "method",
  header: "Method",
  value: (payment) => methodLabel(payment.method),
  sortable: true,
};

const amountColumn: DataTableColumn<Payment> = {
  id: "amount",
  header: "Amount",
  value: (payment) => payment.amount,
  sortable: true,
  align: "end",
  cell: (payment) => (
    <span className="tabular-nums">
      {money(payment.amount, payment.currency)}
    </span>
  ),
};

const transactionColumn: DataTableColumn<Payment> = {
  id: "transaction",
  header: "Transaction ID",
  value: (payment) => payment.transactionId,
  cell: (payment) =>
    payment.transactionId === null ? null : (
      // A gateway's own ids run long. Truncate in the table; the panel shows it whole.
      <span
        title={payment.transactionId}
        className="block max-w-40 truncate font-mono text-xs"
      >
        {payment.transactionId}
      </span>
    ),
};

const statusColumn: DataTableColumn<Payment> = {
  id: "status",
  header: "Status",
  value: (payment) => payment.status,
  cell: (payment) => <StatusCell payment={payment} />,
};

/** The queue view: what the shopper submitted, oldest first as the api sends it. */
const QUEUE_COLUMNS: readonly DataTableColumn<Payment>[] = [
  referenceColumn,
  methodColumn,
  amountColumn,
  transactionColumn,
  {
    id: "submitted",
    header: "Submitted",
    value: (payment) =>
      payment.submittedAt === null ? null : new Date(payment.submittedAt),
    sortable: true,
    cell: (payment) => (
      <span className="text-muted-foreground">{ago(payment.submittedAt)}</span>
    ),
  },
  statusColumn,
];

/** The Successful view adds who took the money and when it settled. */
const SETTLED_COLUMNS: readonly DataTableColumn<Payment>[] = [
  referenceColumn,
  methodColumn,
  amountColumn,
  transactionColumn,
  {
    id: "provider",
    header: "Provider",
    value: (payment) => payment.provider,
    sortable: true,
  },
  {
    id: "settled",
    header: "Settled",
    value: (payment) =>
      payment.settledAt === null ? null : new Date(payment.settledAt),
    sortable: true,
    cell: (payment) => (
      <span className="text-muted-foreground">{ago(payment.settledAt)}</span>
    ),
  },
  statusColumn,
];

/** One line of the history, in words a staff member reads without the status machine. */
function describeEvent(event: PaymentEvent, provider: string): string {
  const by = event.actorEmail === null ? "" : ` by ${event.actorEmail}`;
  if (event.fromStatus === null) {
    return `Created, ${event.toStatus}`;
  }
  switch (event.toStatus) {
    case "submitted": {
      return "Submitted by the shopper";
    }
    case "successful": {
      return event.actorEmail === null
        ? `Paid through ${provider}`
        : `Confirmed${by}`;
    }
    case "failed": {
      const reason = REJECT_REASONS.find((item) => item.id === event.reason);
      return event.fromStatus === "submitted"
        ? `Rejected${by}${reason === undefined ? "" : `: ${reason.label}`}`
        : `Failed${by}`;
    }
    case "cancelled": {
      return `Cancelled${by}`;
    }
    default: {
      return `Moved to ${event.toStatus}${by}`;
    }
  }
}

interface HistoryLine {
  id: string;
  at: string;
  text: string;
  note: string | null;
}

/** Status events and refunds as one timeline, newest first. */
function historyOf(detail: PaymentDetail): HistoryLine[] {
  const { payment } = detail;
  const lines: HistoryLine[] = [
    ...detail.events.map((event) => ({
      at: event.createdAt,
      id: event.id,
      note: event.note,
      text: describeEvent(event, payment.provider),
    })),
    ...detail.refunds.map((refund) => ({
      at: refund.createdAt,
      id: refund.id,
      note: refund.note,
      text: `Refund recorded, ${money(refund.amount, payment.currency)}`,
    })),
  ];
  return lines.toSorted((left, right) => right.at.localeCompare(left.at));
}

function History({ lines }: { lines: readonly HistoryLine[] }) {
  if (lines.length === 0) {
    return <p className="text-muted-foreground px-1 py-1 text-sm">Loading…</p>;
  }
  return (
    <ol className="flex flex-col gap-2 px-1 py-1 text-sm">
      {lines.map((line) => (
        <li key={line.id} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="bg-border mt-1.5 size-2 shrink-0 rounded-full"
          />
          <div className="min-w-0">
            <p>{line.text}</p>
            {line.note === null || line.note === "" ? null : (
              <p className="text-muted-foreground break-words">{line.note}</p>
            )}
            <p className="text-muted-foreground text-xs">{time(line.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A modal over the page, on the platform's own `<dialog>`. The shared ui package ships no
 * dialog, and `showModal()` gives the backdrop, the focus trap and Escape for free.
 */
function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      // Escape belongs to this dialog alone. Below `md` the detail panel sits in a Sheet
      // that also closes on Escape, and without this one key press closed both.
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
        }
      }}
      className="bg-popover text-popover-foreground border-border m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border p-0 shadow-lg backdrop:bg-black/45"
    >
      {open ? (
        <div className="flex flex-col gap-3 p-4 text-sm">
          <h2 className="text-base font-semibold">{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

function RejectDialog({
  payment,
  pending,
  error,
  onCancel,
  onReject,
}: {
  payment: Payment | undefined;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onReject: (reason: RejectReason, note: string) => void;
}) {
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");

  return (
    <Modal
      open={payment !== undefined}
      title="Reject this payment?"
      onClose={() => {
        setReason("");
        setNote("");
        onCancel();
      }}
    >
      {payment === undefined ? null : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason !== "") {
              onReject(reason, note);
            }
          }}
        >
          <p className="text-muted-foreground">
            {reference(payment)} · {methodLabel(payment.method)} ·{" "}
            {money(payment.amount, payment.currency)} asked
            {payment.claimedAmount === null
              ? ""
              : `, ${money(payment.claimedAmount, payment.currency)} claimed`}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reject-reason" className="text-muted-foreground">
              Reason
            </Label>
            <select
              id="reject-reason"
              required
              value={reason}
              onChange={(event) => {
                setReason(event.target.value as RejectReason | "");
              }}
              className="border-input dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {REJECT_REASONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reject-note" className="text-muted-foreground">
              Note for the shopper (optional)
            </Label>
            <textarea
              id="reject-note"
              value={note}
              maxLength={1000}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              className="border-input dark:bg-input/30 min-h-16 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>
          <p className="text-muted-foreground">
            The shopper can submit the same transaction ID again after a
            rejection.
          </p>
          {error === null ? null : (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || reason === ""}
            >
              {pending ? "Rejecting…" : "Reject payment"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RefundDialog({
  payment,
  pending,
  error,
  onCancel,
  onRefund,
}: {
  payment: Payment | undefined;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onRefund: (amount: number, note: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const digits = payment === undefined ? 2 : minorDigits(payment.currency);
  const remaining = payment === undefined ? 0 : refundable(payment);
  const parsed = Number(amount);
  const minor = Math.round(parsed * 10 ** digits);
  const valid =
    amount.trim() !== "" &&
    Number.isFinite(parsed) &&
    minor > 0 &&
    minor <= remaining;

  return (
    <Modal
      open={payment !== undefined}
      title="Record a refund"
      onClose={() => {
        setAmount("");
        setNote("");
        onCancel();
      }}
    >
      {payment === undefined ? null : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) {
              onRefund(minor, note);
            }
          }}
        >
          <p className="text-muted-foreground">
            Log a refund you already sent. Up to{" "}
            {money(remaining, payment.currency)} of{" "}
            {money(payment.settledAmount ?? payment.amount, payment.currency)}{" "}
            is left to refund.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refund-amount" className="text-muted-foreground">
              Amount ({payment.currency.toUpperCase()})
            </Label>
            <Input
              id="refund-amount"
              type="number"
              inputMode="decimal"
              required
              min={1 / 10 ** digits}
              max={remaining / 10 ** digits}
              step={1 / 10 ** digits}
              value={amount}
              aria-invalid={amount !== "" && !valid ? true : undefined}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refund-note" className="text-muted-foreground">
              Note (optional)
            </Label>
            <textarea
              id="refund-note"
              value={note}
              maxLength={1000}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              className="border-input dark:bg-input/30 min-h-16 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>
          {error === null ? null : (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? "Recording…" : "Record refund"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** The lost-race notice, bottom right. It closes itself after a few seconds. */
function Toast({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 8000);
    return () => {
      clearTimeout(timer);
    };
  }, [onClose]);

  return (
    <div
      role="status"
      className="bg-popover text-popover-foreground border-border fixed right-5 bottom-5 z-50 flex w-[min(21rem,calc(100vw-2.5rem))] items-start gap-2 rounded-xl border p-3 text-sm shadow-lg"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </div>
  );
}

/** The panel beside the table, built from the detail query and the list row before it. */
function PaymentDetailView({
  payment,
  detail,
  pending,
  error,
  onClose,
  onConfirm,
  onReject,
  onRefund,
}: {
  payment: Payment;
  detail: PaymentDetail | undefined;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onRefund: () => void;
}) {
  const history = detail === undefined ? [] : historyOf(detail);
  const confirmedBy = detail?.events.findLast(
    (event) => event.toStatus === "successful"
  )?.actorEmail;
  const account = payment.receivingAccount;
  const paidTo =
    account === null ? null : `${account.label} · ${account.number}`;

  const submission = {
    id: "submission",
    label: "Submission",
    icon: ReceiptTextIcon,
    items: [
      {
        label: "Transaction ID",
        value:
          payment.transactionId === null ? null : (
            <span className="font-mono text-xs">{payment.transactionId}</span>
          ),
      },
      {
        label: "Sender",
        value:
          payment.senderAccount === null ? null : (
            <span className="font-mono text-xs">{payment.senderAccount}</span>
          ),
      },
      { label: "Paid to", value: paidTo },
      { label: "Submitted", value: dateTime(payment.submittedAt) },
    ],
  };

  const paymentGroup = {
    id: "payment",
    label: "Payment",
    icon: BanknoteIcon,
    items: [
      { label: "Provider", value: payment.provider },
      { label: "Reference", value: reference(payment) },
      { label: "User", value: payment.userEmail },
      {
        label: "Payment ID",
        value: (
          <span className="text-muted-foreground font-mono text-xs">
            {payment.id}
          </span>
        ),
      },
    ],
  };

  const historyGroup = {
    id: "history",
    label: "History",
    icon: HistoryIcon,
    items: [{ label: "Events", value: <History lines={history} /> }],
  };

  const isSubmitted = payment.status === "submitted";
  const isSuccessful = payment.status === "successful";

  const attributes = isSubmitted
    ? [
        { label: "Status", value: statusPill(payment.status) },
        {
          label: "Asked at checkout",
          value: (
            <span className="font-semibold tabular-nums">
              {money(payment.amount, payment.currency)}
            </span>
          ),
        },
        {
          label: "Claimed",
          value:
            payment.claimedAmount === null ? null : (
              <span className="inline-flex flex-wrap items-center gap-1">
                <span className="font-semibold tabular-nums">
                  {money(payment.claimedAmount, payment.currency)}
                </span>
                {amountDiffers(payment) ? (
                  <StatusPill
                    label="Amount differs"
                    icon={<TriangleAlertIcon />}
                  />
                ) : null}
              </span>
            ),
        },
      ]
    : [
        { label: "Status", value: statusPill(payment.status) },
        { label: "Amount", value: money(payment.amount, payment.currency) },
        // Only a successful payment can carry a refund, so the row is noise elsewhere.
        ...(isSuccessful
          ? [
              {
                label: "Refunded",
                value:
                  payment.refundedAmount > 0 ? (
                    money(payment.refundedAmount, payment.currency)
                  ) : (
                    <span className="text-muted-foreground">none</span>
                  ),
              },
            ]
          : []),
        {
          label: "Transaction ID",
          value:
            payment.transactionId === null ? null : (
              <span className="font-mono text-xs">{payment.transactionId}</span>
            ),
        },
        ...(isSuccessful
          ? [{ label: "Confirmed by", value: confirmedBy ?? null }]
          : []),
      ];

  return (
    <div className="flex min-h-0 w-full flex-col gap-2">
      {isSubmitted ? (
        <div
          role="note"
          className="border-border bg-muted text-foreground flex shrink-0 gap-2 rounded-xl border p-3 text-sm"
        >
          <TriangleAlertIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-semibold">Nothing here is verified.</span>{" "}
            {account === null
              ? "Find this transaction ID in the receiving account's own statement before you confirm."
              : `Find this transaction ID in the ${account.label} statement for ${account.number} before you confirm.`}
          </p>
        </div>
      ) : null}

      <DetailPanel
        title={reference(payment)}
        onClose={onClose}
        className="flex-1"
        attributes={attributes}
        groups={
          isSubmitted
            ? [submission, paymentGroup, historyGroup]
            : [paymentGroup, historyGroup]
        }
      />

      {isSubmitted || (isSuccessful && refundable(payment) > 0) ? (
        <div className="bg-card border-border flex shrink-0 flex-col gap-2 rounded-xl border p-3">
          {error === null ? null : (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {isSubmitted ? (
              <>
                <Button
                  className="flex-1"
                  disabled={pending}
                  onClick={onConfirm}
                >
                  {pending ? "Confirming…" : "Confirm payment"}
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  disabled={pending}
                  onClick={onReject}
                >
                  Reject…
                </Button>
              </>
            ) : (
              <Button
                className="flex-1"
                variant="outline"
                disabled={pending}
                onClick={onRefund}
              >
                Record refund…
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Payments() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("submitted");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"reject" | "refund" | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(
    null
  );

  const { data, isFetching } = useQuery(paymentsQuery(status));
  const rows = useMemo(() => data?.payments ?? [], [data]);

  // The panel reads the detail route, which carries the events and refunds the list does
  // not. The list row fills the panel until that answer lands, and keeps the panel open
  // after a review moves the payment out of the current chip.
  const detail = useQuery({
    ...paymentQuery(selectedId ?? ""),
    enabled: selectedId !== null,
  });
  const [lastRow, setLastRow] = useState<Payment | undefined>();
  const listRow = rows.find((row) => row.id === selectedId);
  const selected =
    selectedId === null
      ? undefined
      : (detail.data?.payment ?? listRow ?? lastRow);

  const chips = useMemo(
    () =>
      STATUS_FILTERS.map((filter) => ({
        count: data?.counts[filter.id],
        id: filter.id,
        label: filter.label,
      })),
    [data]
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: LIST_KEY });
  };

  const settle = async (next: PaymentDetail) => {
    queryClient.setQueryData(paymentQuery(next.payment.id).queryKey, next);
    setDialog(null);
    await refresh();
  };

  // A 409 means another staff member reviewed this payment first. The page refetches,
  // then names the status the payment holds now.
  const lostRace = async (id: string) => {
    setDialog(null);
    await refresh();
    const now = queryClient.getQueryData(paymentQuery(id).queryKey);
    setToast({
      body:
        now === undefined
          ? "The list shows its current status."
          : `It is now ${STATUS_LABEL[now.payment.status]}. The list shows its current status.`,
      title: "Someone else reviewed this payment first.",
    });
  };

  const review = useMutation({
    mutationFn: async (
      input:
        | { id: string; action: "confirm" }
        | { id: string; action: "reject"; reason: RejectReason; note: string }
    ) => {
      const res = await api.admin.payment.payments[":id"].review.$post({
        json:
          input.action === "confirm"
            ? { action: "confirm" }
            : {
                action: "reject",
                reason: input.reason,
                ...(input.note.trim() === "" ? {} : { note: input.note }),
              },
        param: { id: input.id },
      });
      if (res.status === 409) {
        throw new ReviewConflictError();
      }
      const body = await res.json();
      if (res.status !== 200 || !("payment" in body)) {
        throw new Error(errorMessage(body, "The review did not go through."));
      }
      return body;
    },
    onError: async (error, input) => {
      if (error instanceof ReviewConflictError) {
        await lostRace(input.id);
      }
    },
    onSuccess: settle,
  });

  const refund = useMutation({
    mutationFn: async (input: { id: string; amount: number; note: string }) => {
      const res = await api.admin.payment.payments[":id"].refunds.$post({
        json: {
          amount: input.amount,
          ...(input.note.trim() === "" ? {} : { note: input.note }),
        },
        param: { id: input.id },
      });
      const body = await res.json();
      if (res.status !== 200 || !("payment" in body)) {
        throw new Error(errorMessage(body, "The refund was not recorded."));
      }
      return body;
    },
    onSuccess: settle,
  });

  const reviewError =
    review.error === null || review.error instanceof ReviewConflictError
      ? null
      : review.error.message;

  const select = (row?: Payment) => {
    review.reset();
    refund.reset();
    setDialog(null);
    setLastRow(row);
    setSelectedId(row?.id ?? null);
  };

  return (
    <PageLayout
      detailLabel={selected === undefined ? undefined : reference(selected)}
      onDetailClose={() => {
        select();
      }}
      detail={
        selected === undefined ? undefined : (
          <PaymentDetailView
            payment={selected}
            detail={detail.data}
            pending={review.isPending || refund.isPending}
            error={dialog === null ? reviewError : null}
            onClose={() => {
              select();
            }}
            onConfirm={() => {
              review.mutate({ action: "confirm", id: selected.id });
            }}
            onReject={() => {
              review.reset();
              setDialog("reject");
            }}
            onRefund={() => {
              refund.reset();
              setDialog("refund");
            }}
          />
        )
      }
    >
      <PageHeader
        title="Payments"
        description="One-time payments from every installed provider"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <FilterChips
          chips={chips}
          selectedId={status}
          label="Filter payments by status"
          onSelect={(id) => {
            // The chips are literal ids out of STATUS_FILTERS.
            select();
            setStatus(id as StatusFilter);
          }}
        />
      </div>

      <DataTable
        caption="Payments, with the amount asked, the transaction ID the shopper gave, and the status."
        columns={status === "successful" ? SETTLED_COLUMNS : QUEUE_COLUMNS}
        rows={rows}
        rowId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={select}
        emptyState={
          status === "submitted" ? (
            <span className="flex flex-col items-center gap-1 py-6">
              <span className="text-foreground text-sm font-semibold">
                No payments wait for review
              </span>
              <span>
                A payment appears here when a shopper submits a transaction ID.
              </span>
            </span>
          ) : (
            `No ${STATUS_LABEL[status].toLowerCase()} payments.`
          )
        }
      />

      <RejectDialog
        payment={dialog === "reject" ? selected : undefined}
        pending={review.isPending}
        error={dialog === "reject" ? reviewError : null}
        onCancel={() => {
          setDialog(null);
        }}
        onReject={(reason, note) => {
          if (selected !== undefined) {
            review.mutate({ action: "reject", id: selected.id, note, reason });
          }
        }}
      />

      <RefundDialog
        payment={dialog === "refund" ? selected : undefined}
        pending={refund.isPending}
        error={refund.error?.message ?? null}
        onCancel={() => {
          setDialog(null);
        }}
        onRefund={(amount, note) => {
          if (selected !== undefined) {
            refund.mutate({ amount, id: selected.id, note });
          }
        }}
      />

      {toast === null ? null : (
        <Toast
          title={toast.title}
          body={toast.body}
          onClose={() => {
            setToast(null);
          }}
        />
      )}
    </PageLayout>
  );
}

// A 403 is a real answer here, not only a down api: every route is role-gated on the
// server as well as in the shell.
function PaymentsError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader
        title="Payments"
        description="The payment list did not load."
        actions={
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div
          role="alert"
          className="border-border text-muted-foreground max-w-2xl rounded-xl border p-4 text-sm"
        >
          {/* `error` is typed `unknown` by the router, so read the message through a
              guard rather than assume an Error reached here. */}
          {error instanceof Error ? error.message : String(error)} GET
          /admin/payment/payments answers 403 unless the signed-in account has
          the admin role, and 500 when PAYMENT_PROVIDER names no installed
          provider.
        </div>
      </div>
    </PageLayout>
  );
}
