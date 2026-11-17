import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";

import { fromMinor, toMinor } from "@repo/ecommerce";
import {
  addressLines,
  orderTrack,
  ShopClientError,
} from "@repo/ecommerce/client";
import type {
  ShopMethod,
  ShopOrder,
  ShopPayment,
  ShopPaymentSubmit,
} from "@repo/ecommerce/client";
import { Button, buttonVariants } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Skeleton } from "@repo/ui/components/skeleton";
import { cn } from "@repo/ui/lib/utils";
import {
  money,
  phoneText,
  shopClient,
  shopPaths,
  shownDate,
  STATUS_LABEL,
} from "@web/lib/shop";
import { SignInGate } from "./SignInGate";
import { ErrorLine, FieldLabel, StatusPill, Thumb } from "./shop-ui";

// One order, for the buyer who placed it (session only). It shows where the order is,
// what it holds, where it goes and its payments. While a manual payment waits on the
// buyer, the page shows where to send the money and takes the transaction id. After a
// failed or cancelled online payment it offers "Pay again" (plan 0106, grill Q11).

const PAYMENT_STATUS: Readonly<Record<string, string>> = {
  cancelled: "Cancelled",
  failed: "Failed",
  pending: "Waiting for payment",
  refunded: "Refunded",
  submitted: "Being checked",
  successful: "Paid",
};

function message(error: unknown): string {
  return error instanceof ShopClientError
    ? error.message
    : "Something went wrong. Try again.";
}

function methodName(methods: ShopMethod[], id: string | null): string {
  if (!id) {
    return "Payment";
  }
  return methods.find((row) => row.id === id)?.label ?? id;
}

function OrderView({ number }: { number: string }) {
  const [order, setOrder] = useState<ShopOrder | null>(null);
  const [methods, setMethods] = useState<ShopMethod[]>([]);
  const [problem, setProblem] = useState<{
    missing: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    const client = shopClient();
    Promise.all([
      client.order(number),
      client.paymentMethods().catch((): ShopMethod[] => []),
    ])
      .then(([found, list]) => {
        setOrder(found);
        setMethods(list);
      })
      .catch((error: unknown) => {
        setProblem({
          missing: error instanceof ShopClientError && error.status === 404,
          text: message(error),
        });
      });
  }, [number]);

  if (problem) {
    return (
      <div className="bg-card rounded-xl border p-6">
        {problem.missing ? (
          <p>
            This account has no order {number}. Sign in with the number you
            ordered with.
          </p>
        ) : (
          <ErrorLine message={`The order did not load. ${problem.text}`} />
        )}
        <a
          href={shopPaths.orders}
          className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
        >
          Your orders
        </a>
      </div>
    );
  }
  if (!order) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  const last = order.payments.at(-1);
  const track = orderTrack(order.status);
  const ended = order.events.findLast(
    (event) => event.toStatus === order.status
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Order {order.label}
          </h1>
          <StatusPill status={order.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          Placed {shownDate(order.createdAt, true)}
        </p>
      </header>

      {order.canPayAgain && last && (
        <PayAgain
          order={order}
          last={last}
          methods={methods}
          onDone={(next) => {
            setOrder(next);
          }}
        />
      )}

      {order.refundDue && (
        <p className="bg-warning/10 border-warning/40 text-warning-foreground rounded-xl border px-4 py-3 text-sm">
          The shop owes you a refund for this order. It records the refund when
          it sends the money back.
        </p>
      )}

      {last &&
        last.status === "pending" &&
        last.instructions &&
        !order.canPayAgain && (
          <PaymentDue
            order={order}
            payment={last}
            methodLabel={methodName(methods, last.method)}
            onSubmitted={setOrder}
          />
        )}

      {last && last.status === "submitted" && order.status === "placed" && (
        <p className="bg-card rounded-xl border px-4 py-3 text-sm">
          We got your transaction ID. The shop checks it, then confirms the
          order.
        </p>
      )}

      {track.length > 0 ? (
        <ol className="grid grid-cols-4 gap-2" aria-label="Order progress">
          {track.map((step, index) => (
            <li
              key={step.status}
              aria-current={step.state === "current" ? "step" : undefined}
              className="relative flex flex-col items-center gap-2 text-center"
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-3 right-1/2 h-px w-full -translate-y-1/2",
                    step.state === "todo" ? "bg-border" : "bg-foreground"
                  )}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 flex size-6 items-center justify-center rounded-full border-2",
                  step.state === "done" &&
                    "bg-foreground border-foreground text-background",
                  step.state === "current" && "bg-warning border-warning",
                  step.state === "todo" && "bg-background border-border"
                )}
              >
                {step.state === "done" && <CheckIcon className="size-3.5" />}
              </span>
              <span
                className={cn(
                  "text-xs sm:text-sm",
                  step.state === "current"
                    ? "font-semibold"
                    : "text-muted-foreground"
                )}
              >
                {STATUS_LABEL[step.status]}
                {step.state === "done" && (
                  <span className="sr-only">, done</span>
                )}
                {step.state === "current" && (
                  <span className="sr-only">, now</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="bg-card rounded-xl border px-4 py-3 text-sm">
          This order was {STATUS_LABEL[order.status].toLowerCase()}
          {ended ? ` on ${shownDate(ended.createdAt)}` : ""}.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="bg-card text-card-foreground rounded-xl border p-5">
          <h2 className="mb-4 text-xl font-semibold tracking-tight">Items</h2>
          <ul className="flex flex-col divide-y">
            {order.items.map((item) => (
              <li
                key={item.variantId}
                className="flex items-center gap-3 py-3 first:pt-0"
              >
                <Thumb image={item.image} className="size-16" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium wrap-anywhere">
                    {item.productTitle}
                  </p>
                  {item.variantTitle && (
                    <p className="text-muted-foreground text-sm">
                      {item.variantTitle}
                    </p>
                  )}
                </div>
                <p className="shrink-0 text-sm tabular-nums">
                  {item.quantity} × {money(item.unitPrice, order.currency)}
                </p>
              </li>
            ))}
          </ul>
          <dl className="flex flex-col gap-2 border-t pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">
                {money(order.subtotal, order.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Shipping</dt>
              <dd className="tabular-nums">
                {money(order.shipping, order.currency)}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex justify-between gap-4 border-t pt-4 text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">
              {money(order.total, order.currency)}
            </span>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <section className="bg-card text-card-foreground rounded-xl border p-5">
            <h2 className="mb-3 text-xl font-semibold tracking-tight">
              Delivery address
            </h2>
            <address className="text-sm not-italic">
              <span className="block">{order.shippingAddress.name}</span>
              <span className="block">
                {phoneText(String(order.shippingAddress.phone))}
              </span>
              {addressLines(order.shippingAddress).map((line) => (
                <span key={line} className="block wrap-anywhere">
                  {line}
                </span>
              ))}
              <span className="text-muted-foreground mt-2 block">
                {order.zoneName}
              </span>
            </address>
          </section>
          <section className="bg-card text-card-foreground rounded-xl border p-5">
            <h2 className="mb-3 text-xl font-semibold tracking-tight">
              Payments
            </h2>
            {order.payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No payment yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {order.payments.map((payment) => (
                  <li key={payment.id}>
                    {methodName(methods, payment.method)}{" "}
                    <span className="tabular-nums">
                      {money(payment.amount, payment.currency)}
                    </span>
                    {" · "}
                    {PAYMENT_STATUS[payment.status] ?? payment.status}
                    {" · "}
                    {shownDate(payment.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function PayAgain({
  order,
  last,
  methods,
  onDone,
}: {
  order: ShopOrder;
  last: ShopPayment;
  methods: ShopMethod[];
  onDone: (order: ShopOrder) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const method = order.paymentMethod ?? last.method;
  const offerCod = method !== "cod" && methods.some((row) => row.id === "cod");

  async function pay(paymentMethod?: string) {
    setBusy(true);
    setProblem(null);
    try {
      const placed = await shopClient().payAgain(order.number, {
        paymentMethod,
      });
      if (placed.next.kind === "redirect") {
        window.location.assign(placed.next.url);
        return;
      }
      onDone(await shopClient().order(order.number));
      setBusy(false);
    } catch (error) {
      setProblem(message(error));
      setBusy(false);
    }
  }

  const held = order.holdExpiresAt
    ? ` Your items are held until ${shownDate(order.holdExpiresAt, true)}.`
    : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="bg-warning/10 border-warning/40 text-warning-foreground flex items-start gap-3 rounded-xl border px-4 py-3 text-sm">
        <AlertTriangleIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          Your {methodName(methods, last.method)} payment was not accepted.
          {held} Pay again to keep the order.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="lg"
          className="h-10 px-5"
          disabled={busy}
          onClick={() => {
            void pay();
          }}
        >
          Pay again
        </Button>
        {offerCod && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-10 px-5"
            disabled={busy}
            onClick={() => {
              void pay("cod");
            }}
          >
            Pay with cash on delivery
          </Button>
        )}
      </div>
      <ErrorLine message={problem} />
    </div>
  );
}

function PaymentDue({
  order,
  payment,
  methodLabel,
  onSubmitted,
}: {
  order: ShopOrder;
  payment: ShopPayment;
  methodLabel: string;
  onSubmitted: (order: ShopOrder) => void;
}) {
  const ids = useId();
  const { instructions } = payment;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    amount: fromMinor(payment.amount, payment.currency).replace(/\.0+$/, ""),
  }));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!instructions) {
    return null;
  }

  if (instructions.fields.length === 0) {
    return (
      <p className="bg-card rounded-xl border px-4 py-3 text-sm">
        Pay {money(payment.amount, payment.currency)} in cash when the parcel
        arrives.
      </p>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!instructions) {
      return;
    }
    setProblem(null);
    const body: ShopPaymentSubmit = {};
    for (const field of instructions.fields) {
      const value = (values[field.id] ?? "").trim();
      if (value === "") {
        setProblem(`Enter ${field.label.toLowerCase()}.`);
        return;
      }
      if (field.id === "amount") {
        try {
          body.amount = toMinor(value.replaceAll(",", ""), payment.currency);
        } catch {
          setProblem("Enter the amount as a number, such as 1450 or 1450.50.");
          return;
        }
      } else {
        body[field.id] = value;
      }
    }
    setBusy(true);
    try {
      onSubmitted(
        await shopClient().submitPayment(order.number, payment.id, body)
      );
      setBusy(false);
    } catch (error) {
      setProblem(message(error));
      setBusy(false);
    }
  }

  return (
    <section className="bg-card text-card-foreground rounded-xl border p-5 md:p-6">
      <h2 className="text-xl font-semibold tracking-tight">
        Pay with {methodLabel}
      </h2>
      {instructions.account && (
        <p className="mt-3 text-sm">
          Send {money(payment.amount, payment.currency)} to the{" "}
          {instructions.account.label} number{" "}
          <span className="font-semibold tabular-nums">
            {instructions.account.number}
          </span>
          {instructions.account.name ? ` (${instructions.account.name})` : ""}.
        </p>
      )}
      {instructions.note && (
        <p className="text-muted-foreground mt-1 text-sm">
          {instructions.note}
        </p>
      )}
      <form className="mt-5 flex flex-col gap-4" noValidate onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-3">
          {instructions.fields.map((field) => (
            <div key={field.id}>
              <FieldLabel htmlFor={`${ids}-${field.id}`}>
                {field.label}
              </FieldLabel>
              <Input
                id={`${ids}-${field.id}`}
                className="h-10"
                inputMode={
                  field.id === "amount"
                    ? "decimal"
                    : field.id === "senderAccount"
                      ? "tel"
                      : "text"
                }
                autoCapitalize={
                  field.id === "transactionId" ? "characters" : undefined
                }
                autoCorrect="off"
                placeholder={field.placeholder}
                value={values[field.id] ?? ""}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }));
                }}
              />
            </div>
          ))}
        </div>
        <ErrorLine message={problem} />
        <div>
          <Button type="submit" size="lg" className="h-10 px-5" disabled={busy}>
            {busy ? "Sending…" : "Send transaction ID"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function OrderPage({ number }: { number: string }) {
  return (
    <SignInGate intro="Sign in with the phone number you ordered with to see this order. We send a code by SMS.">
      {() => <OrderView number={number} />}
    </SignInGate>
  );
}
