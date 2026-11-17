// `@repo/ecommerce/client`: what `apps/web` reads the shop through. It calls the api's
// public `/shop` routes with `fetch` to `PUBLIC_API_URL`, with the browser's cookies, so
// the guest cart cookie and the client session ride along. The catalog pages call it on
// the server; the cart, checkout and order islands call it in the browser.
//
// This file imports nothing outside the package, so it is safe in a browser bundle and
// in the web Worker. The answer types mirror `apps/api/src/routes/ecommerce.ts`.

import type { OrderStatus } from "./status";

/** An image with its public URL. Null when the project serves no public bucket. */
export interface ShopImage {
  id: string;
  url: string | null;
  alt: string;
  variantId: string | null;
}

/** One catalog card. Prices are minor units in the store currency. */
export interface ShopProductCard {
  id: string;
  slug: string;
  title: string;
  image: ShopImage | null;
  minPrice: number | null;
  maxPrice: number | null;
  /** Available stock summed over the active variants. */
  available: number;
}

export interface ShopProductList {
  currency: string;
  products: ShopProductCard[];
  page: number;
  pageCount: number;
  total: number;
}

export interface ShopOption {
  id: string;
  name: string;
  values: { id: string; value: string }[];
}

export interface ShopVariant {
  id: string;
  title: string;
  sku: string | null;
  optionValueIds: string[];
  price: number | null;
  available: number;
}

export interface ShopProduct {
  id: string;
  slug: string;
  title: string;
  categoryId: string | null;
  currency: string;
  descriptionHtml: string;
  images: ShopImage[];
  options: ShopOption[];
  variants: ShopVariant[];
}

export interface ShopCategory {
  id: string;
  name: string;
  slug: string;
}

export interface ShopZone {
  id: string;
  name: string;
  rate: number;
  currency: string;
}

export interface ShopMethod {
  id: string;
  label: string;
}

export interface ShopCartLine {
  variantId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  variantTitle: string;
  sku: string | null;
  quantity: number;
  unitPrice: number | null;
  available: number;
  forSale: boolean;
  image: ShopImage | null;
}

export interface ShopCart {
  id: string | null;
  currency: string;
  itemCount: number;
  subtotal: number;
  lines: ShopCartLine[];
}

/** A shipping address, as checkout sends it and the order keeps it. */
export interface ShopAddressInput {
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  area?: string | null;
  city: string;
  postalCode?: string | null;
  country?: string;
}

export interface ShopSavedAddress extends ShopAddressInput {
  id: string;
  zoneId: string | null;
}

/** What a manual payment asks the payer to do. Empty `fields`: nothing to send back. */
export interface ShopInstructions {
  account?: { label: string; number: string; name?: string; kind?: string };
  fields: {
    id: "transactionId" | "senderAccount" | "amount";
    label: string;
    placeholder?: string;
  }[];
  note?: string;
}

export interface ShopPayment {
  id: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  transactionId: string | null;
  takesNoSubmission: boolean;
  /** Present while the payment waits on the payer. */
  instructions?: ShopInstructions | null;
}

export interface ShopOrderItem {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  image?: ShopImage | null;
}

export interface ShopOrder {
  number: number;
  label: string;
  status: OrderStatus;
  createdAt: string;
  currency: string;
  contactName: string;
  contactPhone: string;
  shippingAddress: ShopAddressInput & Record<string, unknown>;
  zoneName: string;
  paymentMethod: string | null;
  items: ShopOrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  payments: ShopPayment[];
  events: {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    createdAt: string;
  }[];
  canPayAgain: boolean;
  refundDue: boolean;
  /** When an unpaid order's hold runs out, or null when it holds with no expiry. */
  holdExpiresAt?: string | null;
}

export interface ShopOrderRow {
  number: number;
  label: string;
  status: OrderStatus;
  createdAt: string;
  currency: string;
  total: number;
  itemCount?: number;
  paymentMethod: string | null;
}

export interface ShopOrderList {
  orders: ShopOrderRow[];
  page: number;
  pageCount: number;
  total: number;
}

/** What `payment` says the payer does next. */
export type ShopNext =
  | { kind: "instructions"; instructions: ShopInstructions }
  | { kind: "redirect"; url: string }
  | { kind: "client"; token: string };

/** The answer of checkout and of "Pay again". */
export interface ShopPlaced {
  next: ShopNext;
  order: ShopOrder;
  payment: ShopPayment;
}

export interface ShopCheckoutInput {
  zoneId: string;
  paymentMethod: string;
  addressId?: string;
  address?: ShopAddressInput;
  saveAddress?: boolean;
  note?: string;
  returnUrl?: string;
}

export interface ShopPaymentSubmit {
  transactionId?: string;
  senderAccount?: string;
  amount?: number;
}

/**
 * A refusal. `code` is the api envelope's code, `failed` for a refusal with no envelope,
 * or `unreachable` when the request never reached the api.
 */
export class ShopClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ShopClientError";
    this.status = status;
    this.code = code;
  }
}

export interface ShopClientOptions {
  /** The api origin, `PUBLIC_API_URL`. */
  apiUrl: string;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra headers, such as the browser's cookie when a page calls on the server. */
  headers?: Record<string, string>;
}

export interface ShopClient {
  products(query?: {
    page?: number;
    category?: string;
  }): Promise<ShopProductList>;
  /** One active product, or null when the api sells none by that slug. */
  product(slug: string): Promise<ShopProduct | null>;
  categories(): Promise<ShopCategory[]>;
  zones(): Promise<ShopZone[]>;
  paymentMethods(): Promise<ShopMethod[]>;
  cart(): Promise<ShopCart>;
  addToCart(variantId: string, quantity: number): Promise<ShopCart>;
  setQuantity(variantId: string, quantity: number): Promise<ShopCart>;
  removeLine(variantId: string): Promise<ShopCart>;
  addresses(): Promise<ShopSavedAddress[]>;
  checkout(input: ShopCheckoutInput): Promise<ShopPlaced>;
  orders(page?: number): Promise<ShopOrderList>;
  order(number: number | string): Promise<ShopOrder>;
  payAgain(
    number: number,
    input: { paymentMethod?: string; returnUrl?: string }
  ): Promise<ShopPlaced>;
  submitPayment(
    number: number,
    paymentId: string,
    input: ShopPaymentSubmit
  ): Promise<ShopOrder>;
}

const GENERIC = "Something went wrong. Try again.";
const UNREACHABLE =
  "The shop cannot be reached. Check your connection and try again.";

function envelopeOf(body: unknown): { code?: string; message?: string } {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return {};
  }
  const { error } = body as { error: unknown };
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  return {
    code: typeof code === "string" ? code : undefined,
    message:
      typeof message === "string" && message !== "" ? message : undefined,
  };
}

/** A client for the public shop routes. */
export function createShopClient(options: ShopClientOptions): ShopClient {
  if (!options.apiUrl) {
    throw new Error(
      "createShopClient needs the api origin. Set PUBLIC_API_URL for apps/web."
    );
  }
  const base = `${options.apiUrl.replace(/\/+$/, "")}/shop`;
  // Called as a plain function: workerd throws "Illegal invocation" when `fetch` runs as a
  // method of some other object.
  const doFetch: typeof fetch =
    options.fetch ?? ((input, init) => fetch(input, init));

  async function send(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...options.headers,
        },
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      });
    } catch {
      throw new ShopClientError(0, "unreachable", UNREACHABLE);
    }
    return response;
  }

  async function json<T>(
    path: string,
    init?: { method?: string; body?: unknown }
  ): Promise<T> {
    const response = await send(path, init);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const envelope = envelopeOf(body);
      throw new ShopClientError(
        response.status,
        envelope.code ?? "failed",
        envelope.message ?? GENERIC
      );
    }
    return body as T;
  }

  return {
    addToCart(variantId, quantity) {
      return json<ShopCart>("/cart/items", { body: { quantity, variantId } });
    },
    async addresses() {
      const body = await json<{ addresses: ShopSavedAddress[] }>("/addresses");
      return body.addresses;
    },
    cart() {
      return json<ShopCart>("/cart");
    },
    async categories() {
      const body = await json<{ categories: ShopCategory[] }>("/categories");
      return body.categories;
    },
    checkout(input) {
      return json<ShopPlaced>("/checkout", { body: input });
    },
    order(number) {
      return json<ShopOrder>(`/orders/${encodeURIComponent(String(number))}`);
    },
    orders(page = 1) {
      return json<ShopOrderList>(`/orders?page=${page}`);
    },
    payAgain(number, input) {
      return json<ShopPlaced>(`/orders/${number}/pay`, { body: input });
    },
    async paymentMethods() {
      const body = await json<{ methods: ShopMethod[] }>("/payment-methods");
      return body.methods;
    },
    async product(slug) {
      try {
        return await json<ShopProduct>(`/products/${encodeURIComponent(slug)}`);
      } catch (error) {
        if (error instanceof ShopClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    products(query = {}) {
      const params = new URLSearchParams({ page: String(query.page ?? 1) });
      if (query.category) {
        params.set("category", query.category);
      }
      return json<ShopProductList>(`/products?${params.toString()}`);
    },
    removeLine(variantId) {
      return json<ShopCart>(`/cart/items/${encodeURIComponent(variantId)}`, {
        method: "DELETE",
      });
    },
    setQuantity(variantId, quantity) {
      return json<ShopCart>(`/cart/items/${encodeURIComponent(variantId)}`, {
        body: { quantity },
        method: "PATCH",
      });
    },
    submitPayment(number, paymentId, input) {
      return json<ShopOrder>(
        `/orders/${number}/payments/${encodeURIComponent(paymentId)}/submit`,
        { body: input }
      );
    },
    async zones() {
      const body = await json<{ zones: ShopZone[] }>("/zones");
      return body.zones;
    },
  };
}

// Page helpers ---------------------------------------------------------------------------

/** A choice of one value per option, keyed by option id. */
export type ShopSelection = Record<string, string>;

function sameValues(variant: ShopVariant, values: readonly string[]): boolean {
  return (
    variant.optionValueIds.length === values.length &&
    values.every((value) => variant.optionValueIds.includes(value))
  );
}

/** The variant the selection names, or undefined while it names none. */
export function variantFor(
  product: Pick<ShopProduct, "options" | "variants">,
  selection: ShopSelection
): ShopVariant | undefined {
  const values: string[] = [];
  for (const option of product.options) {
    const value = selection[option.id];
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return product.variants.find((variant) => sameValues(variant, values));
}

/** What picking `valueId` for `optionId`, with the rest kept, would land on. */
export function valueState(
  product: Pick<ShopProduct, "options" | "variants">,
  selection: ShopSelection,
  optionId: string,
  valueId: string
): "available" | "sold_out" | "missing" {
  const found = variantFor(product, { ...selection, [optionId]: valueId });
  if (!found) {
    return "missing";
  }
  return found.available > 0 ? "available" : "sold_out";
}

/** The selection a product page opens on: the first variant in stock, else the first. */
export function initialSelection(
  product: Pick<ShopProduct, "options" | "variants">
): ShopSelection {
  const start =
    product.variants.find((variant) => variant.available > 0) ??
    product.variants[0];
  const selection: ShopSelection = {};
  if (!start) {
    return selection;
  }
  for (const option of product.options) {
    const value = option.values.find((row) =>
      start.optionValueIds.includes(row.id)
    );
    if (value) {
      selection[option.id] = value.id;
    }
  }
  return selection;
}

/** A card's price: the lowest, marked "From" when the variants differ. */
export function priceFrom(card: {
  minPrice: number | null;
  maxPrice: number | null;
}): { amount: number; from: boolean } | null {
  if (card.minPrice === null) {
    return null;
  }
  return {
    amount: card.minPrice,
    from: card.maxPrice !== null && card.maxPrice !== card.minPrice,
  };
}

function filled(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * An address as lines: the street lines, then area, city and postal code on one line.
 * Parts are joined with ", " or " ", so no two words ever run together.
 */
export function addressLines(address: {
  line1?: unknown;
  line2?: unknown;
  area?: unknown;
  city?: unknown;
  postalCode?: unknown;
}): string[] {
  const place = [filled(address.area), filled(address.city)]
    .filter(Boolean)
    .join(", ");
  const last = [place, filled(address.postalCode)].filter(Boolean).join(" ");
  return [filled(address.line1), filled(address.line2), last].filter(
    (line): line is string => line !== undefined && line !== ""
  );
}

/** Why a cart line blocks checkout, or null when it does not. */
export function cartLineNotice(line: {
  quantity: number;
  available: number;
  forSale: boolean;
}): string | null {
  if (!line.forSale) {
    return "No longer for sale. Remove it to check out.";
  }
  if (line.available <= 0) {
    return "Sold out. Remove it to check out.";
  }
  if (line.quantity > line.available) {
    return `Only ${line.available} left. Lower the quantity to ${line.available} to check out.`;
  }
  return null;
}

const TRACK: readonly OrderStatus[] = [
  "placed",
  "confirmed",
  "shipped",
  "delivered",
];

/** The order page's progress line. Empty for a cancelled or returned order. */
export function orderTrack(
  status: OrderStatus
): { status: OrderStatus; state: "done" | "current" | "todo" }[] {
  const at = TRACK.indexOf(status);
  if (at === -1) {
    return [];
  }
  return TRACK.map((step, index) => ({
    state: index < at ? "done" : index === at ? "current" : "todo",
    status: step,
  }));
}

function joinPath(basePath: string, ...parts: string[]): string {
  return [basePath.replace(/\/+$/, ""), ...parts].join("/");
}

export function productPath(basePath: string, slug: string): string {
  return joinPath(basePath, encodeURIComponent(slug));
}

export function orderPath(basePath: string, number: number): string {
  return joinPath(basePath, "orders", String(number));
}

export function itemsText(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

/** "16 Nov 2026", or with `time` "16 Nov 2026, 15:20" (en-GB), in the shop's time zone. */
export function shopDate(
  iso: string,
  locale: string,
  timeZone: string,
  options: { time?: boolean } = {}
): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(date);
  if (!options.time) {
    return day;
  }
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
  return `${day}, ${time}`;
}
