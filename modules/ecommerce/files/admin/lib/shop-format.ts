// The words, amounts and rules the shop screens share. Pure on purpose: no React, no
// router, no config and no `@repo/*` import, so `shop-format.test.ts` runs it under
// `node --test`. Dates go through `shop-dates.ts`, which wraps the shell's own formatters.

import type { StatusTone } from "@repo/ui/components/shell/status-pill";

// Orders ---------------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "placed",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  cancelled: "Cancelled",
  confirmed: "Confirmed",
  delivered: "Delivered",
  placed: "Placed",
  returned: "Returned",
  shipped: "Shipped",
};

/**
 * `placed` waits on staff, so it takes the warn tone; the two moving states take the blue
 * `open` tone; a delivery is settled, a return failed, and a cancel is closed.
 */
export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  cancelled: "neutral",
  confirmed: "open",
  delivered: "ok",
  placed: "warn",
  returned: "bad",
  shipped: "open",
};

/** A status string from the api as one of the six, or `placed` for anything else. */
export function orderStatus(value: string): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value)
    ? (value as OrderStatus)
    : "placed";
}

// Payments -------------------------------------------------------------------------------

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  cancelled: "Cancelled",
  failed: "Failed",
  pending: "Pending",
  submitted: "Submitted",
  successful: "Successful",
};

/** The tones of the Payments screen, so one payment reads the same on both screens. */
export const PAYMENT_STATUS_TONE: Record<string, StatusTone> = {
  cancelled: "neutral",
  failed: "bad",
  pending: "neutral",
  submitted: "open",
  successful: "ok",
};

/** The method id cash on delivery uses in `payment-manual`. */
export const COD_METHOD = "cod";

/** `cod` reads "Cash on delivery"; any other id is worded: `bank_transfer` is "Bank transfer". */
export function methodLabel(method: string | null): string {
  if (method === null || method.trim() === "") {
    return "No method";
  }
  if (method === COD_METHOD) {
    return "Cash on delivery";
  }
  const words = method.replaceAll(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Money ----------------------------------------------------------------------------------

function currencyFormat(currency: string, locale?: string) {
  return new Intl.NumberFormat(locale, {
    currency: currency.toUpperCase(),
    style: "currency",
  });
}

/** The currency's minor unit exponent: 2 for BDT, 0 for JPY. */
export function minorDigits(currency: string): number {
  return (
    currencyFormat(currency, "en").resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** An amount in minor units for a person: `money(145000, "BDT", "en")` is "BDT 1,450.00". */
export function money(
  amount: number,
  currency: string,
  locale?: string
): string {
  return currencyFormat(currency, locale).format(
    amount / 10 ** minorDigits(currency)
  );
}

const DECIMAL = /^(\d+)(?:\.(\d*))?$/;

/**
 * A typed amount in minor units, exactly, or null when it is not one: no sign, no
 * exponent, and no more decimals than the currency has. Group commas are dropped.
 */
export function parseAmount(text: string, currency: string): number | null {
  const match = DECIMAL.exec(text.trim().replaceAll(",", ""));
  if (!match) {
    return null;
  }
  const [, whole = "", fraction = ""] = match;
  const digits = minorDigits(currency);
  if (fraction.length > digits) {
    return null;
  }
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units as a field holds them: `145000` BDT is "1450", `145050` is "1450.50". */
export function amountText(amount: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) {
    return String(amount);
  }
  const whole = Math.floor(amount / 10 ** digits);
  const fraction = amount % 10 ** digits;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(digits, "0")}`;
}

/** A rate between 0 and 1 as a whole percent: `0.82` is "82%". */
export function percent(rate: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(rate);
}

// Addresses ------------------------------------------------------------------------------

/** The address an order or a saved address carries. Every part but `line1` may be empty. */
export interface AddressParts {
  line1?: unknown;
  line2?: unknown;
  area?: unknown;
  city?: unknown;
  postalCode?: unknown;
  country?: unknown;
}

function part(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * An address as lines a person reads: the street parts joined with commas, then the city
 * and postal code with a space, then the country when it is not `homeCountry`. Parts are
 * always joined with a separator, so no two words run together. A stored value that is not
 * an object reads as no lines.
 */
export function addressLines(address: unknown, homeCountry = "BD"): string[] {
  if (typeof address !== "object" || address === null) {
    return [];
  }
  const parts = address as AddressParts;
  const street = [part(parts.line1), part(parts.line2), part(parts.area)]
    .filter((value) => value !== "")
    .join(", ");
  const city = [part(parts.city), part(parts.postalCode)]
    .filter((value) => value !== "")
    .join(" ");
  const country = part(parts.country);
  return [
    street,
    city,
    country === "" || country === homeCountry ? "" : country,
  ].filter((line) => line !== "");
}

/** An address on one line: `addressLines` joined with commas. */
export function formatAddress(address: unknown, homeCountry = "BD"): string {
  return addressLines(address, homeCountry).join(", ");
}

// Time -----------------------------------------------------------------------------------

/** "12 min. ago", "yesterday": a list's time column. Intl puts the spaces in. */
export function relativeTime(iso: string, now: Date, locale?: string): string {
  const format = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  });
  let value = (new Date(iso).getTime() - now.getTime()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      return format.format(Math.round(value), unit);
    }
    value /= size;
  }
  return format.format(Math.round(value), "year");
}

// Order history --------------------------------------------------------------------------

export interface EventLike {
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorName: string | null;
}

const EVENT_VERB: Record<OrderStatus, string> = {
  cancelled: "Cancelled",
  confirmed: "Confirmed",
  delivered: "Delivered",
  placed: "Placed",
  returned: "Returned",
  shipped: "Shipped",
};

/**
 * One line of an order's history. Checkout writes its first event as `system`, so a
 * placed-by-system event names the buyer; any other `system` move is automatic.
 */
export function eventText(event: EventLike, buyerName: string): string {
  const verb = EVENT_VERB[orderStatus(event.toStatus)];
  if (event.actorType === "system") {
    return event.fromStatus === null
      ? `${verb} by ${buyerName}`
      : `${verb} automatically`;
  }
  return `${verb} by ${event.actorName ?? "a staff member"}`;
}

// The variant grid -----------------------------------------------------------------------

/** One stored variant, as the product body carries it. */
export interface VariantLike {
  id: string;
  sku: string | null;
  active: boolean;
  prices: readonly { currency: string; amount: number }[];
  stock: { onHand: number };
}

/** One row of the editor's grid, as the fields hold it. */
export interface VariantDraft {
  id: string;
  sku: string;
  price: string;
  stock: string;
  active: boolean;
}

/** The grid row a stored variant starts as, priced in the store currency. */
export function draftFromVariant(
  variant: VariantLike,
  currency: string
): VariantDraft {
  const price = variant.prices.find((item) => item.currency === currency);
  return {
    active: variant.active,
    id: variant.id,
    price: price === undefined ? "" : amountText(price.amount, currency),
    sku: variant.sku ?? "",
    stock: String(variant.stock.onHand),
  };
}

const STOCK = /^\d+$/;

/**
 * What keeps a row from saving, as the line under it says, or null. An active variant
 * needs a store price (grill Q4); stock is a counted whole number.
 */
export function variantProblem(
  draft: VariantDraft,
  currency: string
): string | null {
  if (
    draft.price.trim() !== "" &&
    parseAmount(draft.price, currency) === null
  ) {
    return "Use an amount such as 1450 or 1450.50";
  }
  if (draft.active && draft.price.trim() === "") {
    return "Add a price to activate";
  }
  if (!STOCK.test(draft.stock.trim())) {
    return "Stock is a whole number, 0 or more";
  }
  return null;
}

/**
 * Which call a changed row needs: `variant` for the SKU, the price or the active flag,
 * `stock` for the on-hand count. Prices compare as amounts, so "1450.00" is "1450".
 */
export function variantChanges(
  saved: VariantDraft,
  draft: VariantDraft,
  currency = "BDT"
): { variant: boolean; stock: boolean } {
  const amount = (text: string) =>
    text.trim() === "" ? null : parseAmount(text, currency);
  return {
    stock: saved.stock.trim() !== draft.stock.trim(),
    variant:
      saved.sku.trim() !== draft.sku.trim() ||
      saved.active !== draft.active ||
      amount(saved.price) !== amount(draft.price),
  };
}

/** "Set one price for all": the same price on every row. */
export function applyPrice(
  drafts: readonly VariantDraft[],
  price: string
): VariantDraft[] {
  return drafts.map((draft) => ({ ...draft, price: price.trim() }));
}

// The next-action bar --------------------------------------------------------------------

export type OrderAction =
  | "confirm"
  | "ship"
  | "deliver"
  | "cancel"
  | "return"
  | "confirmPayment"
  | "recordRefund"
  | "restock";

export interface NextStep {
  action: OrderAction;
  label: string;
}

export interface NextAction {
  /** What the order waits on, in a few words. */
  title: string;
  /** One sentence on why, or what happens next. */
  detail: string;
  /** `warn` while something is owed, `ok` once the order is done, `neutral` otherwise. */
  tone: "neutral" | "warn" | "ok";
  primary: NextStep | null;
  secondary: NextStep[];
}

export interface NextActionInput {
  status: string;
  paymentMethod: string | null;
  payments: readonly {
    status: string;
    reviewable: boolean;
    takesNoSubmission: boolean;
  }[];
  refundDue: boolean;
  restocked: boolean;
}

/**
 * The one thing an order waits on, for the bar at the top of the order page. It reads the
 * order's status and its payments, and never the payment method's name beyond the COD
 * wording: a reviewable payment is one staff decide on, whatever its method.
 */
export function nextAction(order: NextActionInput): NextAction {
  const status = orderStatus(order.status);
  const reviewable = order.payments.find((payment) => payment.reviewable);
  const cash = reviewable?.takesNoSubmission === true;
  const paid = order.payments.some(
    (payment) => payment.status === "successful"
  );

  switch (status) {
    case "placed": {
      if (reviewable && !cash) {
        return {
          detail:
            "The buyer sent a transaction ID. Find it in the receiving account's statement before you confirm.",
          primary: { action: "confirmPayment", label: "Confirm payment" },
          secondary: [{ action: "cancel", label: "Cancel order" }],
          title: "Check the payment",
          tone: "warn",
        };
      }
      if (cash || order.paymentMethod === COD_METHOD) {
        return {
          detail:
            "Call the buyer to check the order and the address, then confirm it.",
          primary: { action: "confirm", label: "Confirm order" },
          secondary: [{ action: "cancel", label: "Cancel order" }],
          title: "Call the buyer",
          tone: "warn",
        };
      }
      return {
        detail:
          "The order confirms itself when the payment succeeds. An unpaid hold ends on its own.",
        primary: null,
        secondary: [{ action: "cancel", label: "Cancel order" }],
        title: "Waiting for payment",
        tone: "neutral",
      };
    }
    case "confirmed": {
      return {
        detail:
          "Pack the items and hand them to the courier. Stock leaves the shelf when you ship.",
        primary: { action: "ship", label: "Mark shipped" },
        secondary: [{ action: "cancel", label: "Cancel order" }],
        title: "Ready to ship",
        tone: "neutral",
      };
    }
    case "shipped": {
      return {
        detail: cash
          ? "Mark it delivered at the handover. Confirm the cash when the courier pays it in."
          : "Mark it delivered when the courier hands it over.",
        primary: { action: "deliver", label: "Mark delivered" },
        secondary: [{ action: "return", label: "Mark returned" }],
        title: "With the courier",
        tone: "neutral",
      };
    }
    case "delivered": {
      if (reviewable) {
        return {
          detail:
            "The buyer has the items. Confirm the cash when the courier pays it in.",
          primary: {
            action: "confirmPayment",
            label: cash ? "Confirm cash received" : "Confirm payment",
          },
          secondary: [],
          title: cash ? "Collect the cash" : "Check the payment",
          tone: "warn",
        };
      }
      return {
        detail: paid
          ? "Delivered and paid. Nothing is left to do."
          : "Delivered.",
        primary: null,
        secondary: [],
        title: "Complete",
        tone: "ok",
      };
    }
    default: {
      // `cancelled` and `returned`: the order is closed.
      const restock: NextStep[] =
        status === "returned" && !order.restocked
          ? [{ action: "restock", label: "Restock items" }]
          : [];
      if (order.refundDue) {
        return {
          detail:
            "A successful payment is not refunded in full. Send the money back, then record the refund on the payment.",
          primary: { action: "recordRefund", label: "Record refund" },
          secondary: restock,
          title: "Refund due",
          tone: "warn",
        };
      }
      if (restock.length > 0) {
        return {
          detail:
            "The items came back. Put them back on the shelf if they can be sold again.",
          primary: restock[0] ?? null,
          secondary: [],
          title: "Returned",
          tone: "neutral",
        };
      }
      return {
        detail:
          status === "cancelled"
            ? "The order is closed and its stock is free again."
            : "The order is closed.",
        primary: null,
        secondary: [],
        title: status === "cancelled" ? "Cancelled" : "Returned",
        tone: "neutral",
      };
    }
  }
}

// The "New order" page --------------------------------------------------------------------

/** One line of a staff order being built. The price is the catalog's, for the summary only. */
export interface DraftLine {
  variantId: string;
  title: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  available: number;
}

/**
 * Add a variant to the order, or one more of it when it is already there, capped at the
 * stock available. A variant with nothing available is not added.
 */
export function addLine(
  lines: readonly DraftLine[],
  line: Omit<DraftLine, "quantity">
): DraftLine[] {
  const current = lines.find((item) => item.variantId === line.variantId);
  if (current) {
    return lines.map((item) =>
      item.variantId === line.variantId
        ? { ...item, quantity: Math.min(item.quantity + 1, item.available) }
        : item
    );
  }
  return line.available > 0 ? [...lines, { ...line, quantity: 1 }] : [...lines];
}

/** Set a line's quantity, between 1 and the stock available. Zero removes the line. */
export function setLineQuantity(
  lines: readonly DraftLine[],
  variantId: string,
  quantity: number
): DraftLine[] {
  if (quantity <= 0) {
    return lines.filter((item) => item.variantId !== variantId);
  }
  return lines.map((item) =>
    item.variantId === variantId
      ? { ...item, quantity: Math.min(Math.floor(quantity), item.available) }
      : item
  );
}

/** The summary the page shows; the api works the real figures out from the catalog. */
export function draftTotals(
  lines: readonly DraftLine[],
  shipping: number
): { subtotal: number; shipping: number; total: number } {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0
  );
  return { shipping, subtotal, total: subtotal + shipping };
}

/** True once a typed phone has enough digits to look up: 11 to 15, a plus allowed. */
export function phoneReady(text: string): boolean {
  const trimmed = text.trim();
  if (!/^\+?[\d\s-]+$/.test(trimmed)) {
    return false;
  }
  const digits = trimmed.replaceAll(/\D/g, "").length;
  return digits >= 11 && digits <= 15;
}
