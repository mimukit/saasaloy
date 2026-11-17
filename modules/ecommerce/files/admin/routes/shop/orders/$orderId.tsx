import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { EllipsisIcon, MapPinIcon, PhoneIcon, UserIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { PageSkeleton } from "@repo/ui/blocks/shell/page-skeleton";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@repo/ui/components/shell/alert-dialog";
import { Button } from "@repo/ui/components/shell/button";
import {
  Card,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@repo/ui/components/shell/card";
import { Checkbox } from "@repo/ui/components/shell/checkbox";
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
import { Label } from "@repo/ui/components/shell/label";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/shell/menu";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { usePageTrail } from "@admin/components/page-trail";
import { NextActionBar } from "@admin/components/shop/next-action-bar";
import {
  PaymentsPanel,
  RefundDialog,
  RejectPaymentDialog,
  refundable,
} from "@admin/components/shop/order-payments";
import { MethodTag, OrderStatusPill } from "@admin/components/shop/shop-pills";
import {
  moveOrder,
  orderQuery,
  recordRefund,
  refreshShop,
  restockOrder,
  reviewPayment,
} from "@admin/lib/shop-api";
import type {
  Order,
  OrderPayment,
  RejectReason,
  StaffStatus,
} from "@admin/lib/shop-api";
import { SHOP_LOCALE, shownDateTime } from "@admin/lib/shop-dates";
import {
  ORDER_STATUS_TONE,
  addressLines,
  eventText,
  headerActions,
  nextAction,
  orderStatus,
} from "@admin/lib/shop-format";
import { money } from "@admin/lib/shop-money";
import type { HeaderActions, OrderAction } from "@admin/lib/shop-format";

// One order at `/shop/orders/<id>`, laid out as the approved mockup: the status buttons sit
// in the header beside the order number (the next move, the other moves, and Cancel in the
// overflow menu), chosen by `nextAction` and `headerActions`. A line under the header says
// what the order waits on and carries "Record refund" while a refund is due. Below it is
// the record: the items and totals, the contact and address, the payments, and the history.
//
// Confirm, Reject and Record refund on a payment go through the `/admin/payment` routes.
// Cancel asks first. Mark returned opens a dialog with the "Restock items" checkbox,
// checked by default (grill Q8); an order the payment listener returned offers "Restock
// items" in the header until its items are back.

export const Route = createFileRoute("/shop/orders/$orderId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(orderQuery(params.orderId)),
  component: OrderPage,
  errorComponent: OrderError,
  pendingComponent: () => <PageSkeleton />,
});

const MOVE_DONE: Record<StaffStatus, string> = {
  cancelled: "Order cancelled",
  confirmed: "Order confirmed",
  delivered: "Marked delivered",
  returned: "Marked returned",
  shipped: "Marked shipped",
};

type Step =
  | { kind: "move"; status: StaffStatus; restock?: boolean }
  | { kind: "confirmPayment"; payment: OrderPayment }
  | {
      kind: "rejectPayment";
      payment: OrderPayment;
      reason: RejectReason;
      note: string;
    }
  | { kind: "refund"; payment: OrderPayment; amount: number; note: string }
  | { kind: "restock" };

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="p-4 pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardPanel className="p-4">{children}</CardPanel>
    </Card>
  );
}

function OrderPage() {
  const { orderId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: order } = useQuery(orderQuery(orderId));
  const [dialog, setDialog] = useState<"cancel" | "return" | null>(null);
  const [rejecting, setRejecting] = useState<OrderPayment | null>(null);
  const [refunding, setRefunding] = useState<OrderPayment | null>(null);
  const [pendingAction, setPendingAction] = useState<OrderAction | null>(null);

  usePageTrail([
    { label: "Orders", to: "/shop/orders" },
    { label: order?.label ?? "Order" },
  ]);

  const step = useMutation({
    mutationFn: async (input: Step): Promise<string> => {
      switch (input.kind) {
        case "move": {
          await moveOrder(orderId, {
            restock: input.restock,
            status: input.status,
          });
          return MOVE_DONE[input.status];
        }
        case "confirmPayment": {
          await reviewPayment(input.payment.id, { action: "confirm" });
          return input.payment.takesNoSubmission
            ? "Cash confirmed"
            : "Payment confirmed";
        }
        case "rejectPayment": {
          await reviewPayment(input.payment.id, {
            action: "reject",
            reason: input.reason,
            ...(input.note.trim() === "" ? {} : { note: input.note }),
          });
          return "Payment rejected";
        }
        case "refund": {
          await recordRefund(input.payment.id, input.amount, input.note);
          return "Refund recorded";
        }
        default: {
          // `restock`: a returned order's items go back on the shelf.
          await restockOrder(orderId);
          return "Items restocked";
        }
      }
    },
    onSuccess: async (title) => {
      setDialog(null);
      setRejecting(null);
      setRefunding(null);
      toastManager.add({ title, type: "success" });
      await refreshShop(queryClient);
    },
    onError: (error) => {
      // A dialog shows the error inline; the bar's direct actions report in a toast.
      if (dialog === null && rejecting === null && refunding === null) {
        toastManager.add({
          description: error.message,
          title: "That did not go through",
          type: "error",
        });
      }
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  if (!order) {
    return <PageSkeleton />;
  }

  const next = nextAction(order);
  const reviewable = order.payments.find((payment) => payment.reviewable);
  const owed = order.payments.find(
    (payment) => payment.status === "successful" && refundable(payment) > 0
  );

  const run = (action: OrderAction) => {
    step.reset();
    switch (action) {
      case "confirm":
      case "ship":
      case "deliver": {
        setPendingAction(action);
        step.mutate({
          kind: "move",
          status:
            action === "confirm"
              ? "confirmed"
              : action === "ship"
                ? "shipped"
                : "delivered",
        });
        return;
      }
      case "cancel": {
        setDialog("cancel");
        return;
      }
      case "return": {
        setDialog("return");
        return;
      }
      case "confirmPayment": {
        if (reviewable) {
          setPendingAction(action);
          step.mutate({ kind: "confirmPayment", payment: reviewable });
        }
        return;
      }
      case "recordRefund": {
        if (owed) {
          setRefunding(owed);
        }
        return;
      }
      default: {
        // `restock`.
        setPendingAction(action);
        step.mutate({ kind: "restock" });
      }
    }
  };

  const lines = addressLines(order.shippingAddress);

  return (
    <PageLayout>
      <PageHeader
        title={order.label}
        badges={
          <span className="inline-flex items-center gap-1.5">
            <OrderStatusPill status={order.status} />
            <MethodTag method={order.paymentMethod} />
          </span>
        }
        description={`Placed ${shownDateTime(order.createdAt)}`}
        actions={
          <OrderHeaderActions
            actions={headerActions(next)}
            pending={pendingAction}
            busy={step.isPending}
            onAction={run}
          />
        }
      />
      <PageBody className="flex flex-col gap-4">
        <NextActionBar
          next={next}
          pending={step.isPending}
          onRecordRefund={() => {
            run("recordRefund");
          }}
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <ItemsPanel order={order} />
            <HistoryPanel order={order} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Contact">
              <ul className="flex flex-col gap-2 text-sm">
                <li className="flex gap-2">
                  <UserIcon
                    aria-hidden="true"
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  />
                  <span>{order.contactName}</span>
                </li>
                <li className="flex gap-2">
                  <PhoneIcon
                    aria-hidden="true"
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  />
                  <span className="tabular-nums">{order.contactPhone}</span>
                </li>
                <li className="flex gap-2">
                  <MapPinIcon
                    aria-hidden="true"
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  />
                  <span className="flex flex-col">
                    {lines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                </li>
              </ul>
              {order.note ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  Note: {order.note}
                </p>
              ) : null}
            </Panel>
            <Panel title="Payments">
              <PaymentsPanel
                payments={order.payments}
                pending={step.isPending}
                onConfirm={(payment) => {
                  step.reset();
                  setPendingAction("confirmPayment");
                  step.mutate({ kind: "confirmPayment", payment });
                }}
                onReject={(payment) => {
                  step.reset();
                  setRejecting(payment);
                }}
                onRefund={(payment) => {
                  step.reset();
                  setRefunding(payment);
                }}
              />
            </Panel>
          </div>
        </div>
      </PageBody>

      <AlertDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {order.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The held stock goes back on sale.
              {order.payments.some((payment) => payment.status === "successful")
                ? " The order is paid, so it shows Refund due until you record the refund."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {step.error && dialog === "cancel" ? (
            <p className="text-destructive px-6 text-sm" role="alert">
              {step.error.message}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>
              Keep order
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={step.isPending}
              onClick={() => {
                step.mutate({ kind: "move", status: "cancelled" });
              }}
            >
              {step.isPending ? "Cancelling…" : "Cancel order"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <ReturnDialog
        order={order}
        open={dialog === "return"}
        pending={step.isPending}
        error={dialog === "return" ? (step.error?.message ?? null) : null}
        onCancel={() => {
          setDialog(null);
        }}
        onReturn={(restock) => {
          step.mutate({ kind: "move", restock, status: "returned" });
        }}
      />

      <RejectPaymentDialog
        payment={rejecting}
        pending={step.isPending}
        error={rejecting === null ? null : (step.error?.message ?? null)}
        onCancel={() => {
          setRejecting(null);
        }}
        onReject={(reason, note) => {
          if (rejecting) {
            step.mutate({
              kind: "rejectPayment",
              note,
              payment: rejecting,
              reason,
            });
          }
        }}
      />

      <RefundDialog
        payment={refunding}
        pending={step.isPending}
        error={refunding === null ? null : (step.error?.message ?? null)}
        onCancel={() => {
          setRefunding(null);
        }}
        onRefund={(amount, note) => {
          if (refunding) {
            step.mutate({ amount, kind: "refund", note, payment: refunding });
          }
        }}
      />
    </PageLayout>
  );
}

/**
 * The status buttons beside the order number, as the approved mockup lays them out: the
 * next move filled, the other moves outlined, and Cancel in the overflow menu.
 */
function OrderHeaderActions({
  actions,
  pending,
  busy,
  onAction,
}: {
  actions: HeaderActions;
  pending: OrderAction | null;
  busy: boolean;
  onAction: (action: OrderAction) => void;
}) {
  const { primary, secondary, overflow } = actions;
  return (
    <span className="flex items-center gap-2">
      {primary === null ? null : (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            onAction(primary.action);
          }}
        >
          {pending === primary.action ? "Saving…" : primary.label}
        </Button>
      )}
      {secondary.map((step) => (
        <Button
          key={step.action}
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            onAction(step.action);
          }}
        >
          {step.label}
        </Button>
      ))}
      {overflow.length === 0 ? null : (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="More order actions"
                disabled={busy}
              />
            }
          >
            <EllipsisIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            {overflow.map((step) => (
              <MenuItem
                key={step.action}
                variant={step.action === "cancel" ? "destructive" : "default"}
                onClick={() => {
                  onAction(step.action);
                }}
              >
                {step.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      )}
    </span>
  );
}

function ItemsPanel({ order }: { order: Order }) {
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <Panel title={`Items (${count})`}>
      <table className="w-full text-sm">
        <caption className="sr-only">
          The order lines, with the price each was sold at.
        </caption>
        <thead className="text-muted-foreground text-xs">
          <tr className="border-border border-b">
            <th scope="col" className="py-2 text-left font-medium">
              Product and variant
            </th>
            <th
              scope="col"
              className="hidden py-2 text-left font-medium sm:table-cell"
            >
              SKU
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Qty
            </th>
            <th
              scope="col"
              className="hidden py-2 text-right font-medium sm:table-cell"
            >
              Unit price
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Line total
            </th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="border-border border-b">
              <td className="py-2.5 pr-3">
                <span className="block font-medium">{item.productTitle}</span>
                {item.variantTitle === "" ? null : (
                  <span className="text-muted-foreground block text-xs">
                    {item.variantTitle}
                  </span>
                )}
              </td>
              <td className="text-muted-foreground hidden py-2.5 pr-3 font-mono text-xs sm:table-cell">
                {item.sku ?? ""}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {item.quantity}
              </td>
              <td className="hidden py-2.5 text-right tabular-nums sm:table-cell">
                {money(item.unitPrice, order.currency, SHOP_LOCALE)}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {money(item.lineTotal, order.currency, SHOP_LOCALE)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">
          {money(order.subtotal, order.currency, SHOP_LOCALE)}
        </dd>
        <dt className="text-muted-foreground">Shipping, {order.zoneName}</dt>
        <dd className="text-right tabular-nums">
          {money(order.shipping, order.currency, SHOP_LOCALE)}
        </dd>
        <dt className="border-border border-t pt-1.5 font-semibold">Total</dt>
        <dd className="border-border border-t pt-1.5 text-right font-semibold tabular-nums">
          {money(order.total, order.currency, SHOP_LOCALE)}
        </dd>
      </dl>
    </Panel>
  );
}

function HistoryPanel({ order }: { order: Order }) {
  return (
    <Panel title="History">
      <ol className="flex flex-col gap-3 text-sm">
        {order.events.toReversed().map((event) => {
          const tone = ORDER_STATUS_TONE[orderStatus(event.toStatus)];
          return (
            <li key={event.id} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className={
                  tone === "ok"
                    ? "bg-status-ok mt-1.5 size-2 shrink-0 rounded-full"
                    : tone === "bad"
                      ? "bg-status-bad mt-1.5 size-2 shrink-0 rounded-full"
                      : tone === "warn"
                        ? "bg-status-warn mt-1.5 size-2 shrink-0 rounded-full"
                        : tone === "open"
                          ? "bg-status-open-foreground mt-1.5 size-2 shrink-0 rounded-full"
                          : "bg-border mt-1.5 size-2 shrink-0 rounded-full"
                }
              />
              <div className="min-w-0">
                <p>{eventText(event, order.contactName)}</p>
                {event.note ? (
                  <p className="text-muted-foreground break-words">
                    {event.note}
                  </p>
                ) : null}
                <p className="text-muted-foreground text-xs tabular-nums">
                  {shownDateTime(event.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function ReturnDialog({
  order,
  open,
  pending,
  error,
  onCancel,
  onReturn,
}: {
  order: Order;
  open: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onReturn: (restock: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <DialogPopup>
        <ReturnForm
          order={order}
          pending={pending}
          error={error}
          onReturn={onReturn}
        />
      </DialogPopup>
    </Dialog>
  );
}

function ReturnForm({
  order,
  pending,
  error,
  onReturn,
}: {
  order: Order;
  pending: boolean;
  error: string | null;
  onReturn: (restock: boolean) => void;
}) {
  const [restock, setRestock] = useState(true);
  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onReturn(restock);
      }}
    >
      <DialogHeader>
        <DialogTitle>Mark {order.label} returned</DialogTitle>
        <DialogDescription>
          The courier brought the parcel back.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-3">
        <Label className="flex items-center gap-2.5 text-sm font-medium">
          <Checkbox
            checked={restock}
            onCheckedChange={(checked) => {
              setRestock(checked);
            }}
          />
          Restock items
        </Label>
        <ul className="text-muted-foreground flex flex-col gap-1 pl-7 text-sm">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.variantTitle === ""
                ? item.productTitle
                : `${item.productTitle}, ${item.variantTitle}`}{" "}
              <span className="tabular-nums">× {item.quantity}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          {restock
            ? "These items go back on sale."
            : "Unchecked, the stock stays as it is."}
        </p>
        {error === null ? null : (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Mark returned"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function OrderError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Order" />
      <ErrorState
        code="500"
        title="The order did not load"
        description="Check that the api is running and that the order exists."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
