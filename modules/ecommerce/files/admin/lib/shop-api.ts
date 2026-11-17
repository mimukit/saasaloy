import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { api } from "@admin/lib/api";

// The shop screens' calls to `apps/api`'s `/admin/shop` routes, through the one typed
// client. Each read is a `queryOptions` the route loaders and the screens share; each
// write returns the api's body or throws a `ShopRequestError` carrying the api's message.
// The row and detail types come from the queries' own return types, so a field the api
// drops fails the typecheck here rather than at runtime.

/** A refused shop call: the api's own sentence, its status and its error code. */
export class ShopRequestError extends Error {
  override name = "ShopRequestError";
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The api's `{ error: { code, message } }` envelope off any refused body. */
async function refusal(
  response: Response,
  fallback: string
): Promise<ShopRequestError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A body that is not JSON keeps the fallback sentence.
  }
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  return new ShopRequestError(
    typeof error?.message === "string" ? error.message : fallback,
    response.status,
    typeof error?.code === "string" ? error.code : null
  );
}

/** The body type of a response's 200 or 201 member, read off `hc`'s status-keyed union. */
type OkBody<R> = R extends {
  status: 200 | 201;
  json: () => Promise<infer B>;
}
  ? B
  : never;

/** The body of a 2xx answer, or the api's refusal as a thrown `ShopRequestError`. */
async function answer<R extends { ok: boolean; status: number }>(
  response: R,
  fallback: string
): Promise<OkBody<R>> {
  const raw = response as unknown as Response;
  if (!response.ok) {
    throw await refusal(raw, fallback);
  }
  return (await raw.json()) as OkBody<R>;
}

/** Every shop query key starts here, so one invalidate refreshes every shop screen. */
export const SHOP_KEY = ["admin", "shop"] as const;

export const shopKeys = {
  all: SHOP_KEY,
  categories: [...SHOP_KEY, "categories"] as const,
  customer: (id: string) => [...SHOP_KEY, "customers", "detail", id] as const,
  customers: (q: string, page: number) =>
    [...SHOP_KEY, "customers", "list", q, page] as const,
  order: (id: string) => [...SHOP_KEY, "orders", "detail", id] as const,
  orders: (status: string, page: number) =>
    [...SHOP_KEY, "orders", "list", status, page] as const,
  product: (id: string) => [...SHOP_KEY, "products", "detail", id] as const,
  products: (status: string, page: number, q = "") =>
    [...SHOP_KEY, "products", "list", status, page, q] as const,
  report: (range: string, from: string, to: string) =>
    [...SHOP_KEY, "reports", range, from, to] as const,
  zones: [...SHOP_KEY, "zones"] as const,
};

/** Refresh every shop screen and the Orders badge in the sidebar after a write. */
export async function refreshShop(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: SHOP_KEY }),
    queryClient.invalidateQueries({ queryKey: ["nav-count", "/shop/orders"] }),
    queryClient.invalidateQueries({ queryKey: ["nav-count", "/payments"] }),
  ]);
}

// Products -------------------------------------------------------------------------------

export type ProductFilter = "all" | "active" | "draft";

/** A page of products; `q` matches a part of the title or a variant's SKU. */
export const productsQuery = (status: ProductFilter, page: number, q = "") =>
  queryOptions({
    queryKey: shopKeys.products(status, page, q.trim()),
    queryFn: async () =>
      answer(
        await api.admin.shop.products.$get({
          query: {
            page: String(page),
            status,
            ...(q.trim() === "" ? {} : { q: q.trim() }),
          },
        }),
        "The product list did not load."
      ),
  });

export const productQuery = (id: string) =>
  queryOptions({
    queryKey: shopKeys.product(id),
    queryFn: async () =>
      answer(
        await api.admin.shop.products[":id"].$get({ param: { id } }),
        "The product did not load."
      ),
  });

export const categoriesQuery = () =>
  queryOptions({
    queryKey: shopKeys.categories,
    queryFn: async () =>
      answer(
        await api.admin.shop.categories.$get(),
        "The categories did not load."
      ),
  });

export type ProductList = Awaited<
  ReturnType<NonNullable<ReturnType<typeof productsQuery>["queryFn"]>>
>;
export type ProductRow = ProductList["products"][number];
export type Product = Awaited<
  ReturnType<NonNullable<ReturnType<typeof productQuery>["queryFn"]>>
>;
export type ProductVariant = Product["variants"][number];
export type Category = Awaited<
  ReturnType<NonNullable<ReturnType<typeof categoriesQuery>["queryFn"]>>
>["categories"][number];

export interface ProductFields {
  title: string;
  slug: string;
  description: Record<string, unknown> | null;
  categoryId: string | null;
}

export async function createProduct(fields: ProductFields) {
  return answer(
    await api.admin.shop.products.$post({ json: fields }),
    "The product was not created."
  );
}

export async function updateProduct(
  id: string,
  fields: Partial<ProductFields>
) {
  return answer(
    await api.admin.shop.products[":id"].$patch({
      json: fields,
      param: { id },
    }),
    "The product was not saved."
  );
}

export async function setProductStatus(id: string, status: "draft" | "active") {
  return answer(
    await api.admin.shop.products[":id"].status.$post({
      json: { status },
      param: { id },
    }),
    status === "active"
      ? "The product was not published."
      : "The product was not unpublished."
  );
}

export async function deleteProduct(id: string) {
  return answer(
    await api.admin.shop.products[":id"].$delete({ param: { id } }),
    "The product was not deleted."
  );
}

export async function setProductOptions(
  id: string,
  options: { name: string; values: string[] }[]
) {
  return answer(
    await api.admin.shop.products[":id"].options.$put({
      json: { options },
      param: { id },
    }),
    "The options were not saved."
  );
}

export async function updateVariant(
  id: string,
  body: { sku: string | null; price: number | null; active: boolean }
) {
  return answer(
    await api.admin.shop.variants[":id"].$put({ json: body, param: { id } }),
    "The variant was not saved."
  );
}

export async function setStock(id: string, onHand: number) {
  return answer(
    await api.admin.shop.variants[":id"].stock.$post({
      json: { note: "Counted in the product editor.", onHand },
      param: { id },
    }),
    "The stock was not saved."
  );
}

export async function addProductImage(
  productId: string,
  storageObjectId: string,
  position: number
) {
  return answer(
    await api.admin.shop.products[":id"].images.$post({
      json: { alt: "", position, storageObjectId, variantId: null },
      param: { id: productId },
    }),
    "The image was not added."
  );
}

export async function removeProductImage(id: string) {
  return answer(
    await api.admin.shop.images[":id"].$delete({ param: { id } }),
    "The image was not removed."
  );
}

export async function createCategory(name: string, slug: string) {
  return answer(
    await api.admin.shop.categories.$post({
      json: { name, position: 0, slug },
    }),
    "The category was not created."
  );
}

// Orders ---------------------------------------------------------------------------------

export type OrderFilter =
  | "all"
  | "placed"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

export const ordersQuery = (status: OrderFilter, page: number) =>
  queryOptions({
    queryKey: shopKeys.orders(status, page),
    queryFn: async () =>
      answer(
        await api.admin.shop.orders.$get({
          query: { page: String(page), status },
        }),
        "The order list did not load."
      ),
  });

export const orderQuery = (id: string) =>
  queryOptions({
    queryKey: shopKeys.order(id),
    queryFn: async () =>
      answer(
        await api.admin.shop.orders[":id"].$get({ param: { id } }),
        "The order did not load."
      ),
  });

export type OrderList = Awaited<
  ReturnType<NonNullable<ReturnType<typeof ordersQuery>["queryFn"]>>
>;
export type OrderListRow = OrderList["orders"][number];
export type Order = Awaited<
  ReturnType<NonNullable<ReturnType<typeof orderQuery>["queryFn"]>>
>;
export type OrderPayment = Order["payments"][number];

export type StaffStatus =
  "confirmed" | "shipped" | "delivered" | "cancelled" | "returned";

export async function moveOrder(
  id: string,
  body: { status: StaffStatus; note?: string; restock?: boolean }
) {
  return answer(
    await api.admin.shop.orders[":id"].status.$post({
      json: {
        restock: body.restock ?? true,
        status: body.status,
        ...(body.note ? { note: body.note } : {}),
      },
      param: { id },
    }),
    "The order did not move."
  );
}

export async function restockOrder(id: string) {
  return answer(
    await api.admin.shop.orders[":id"].restock.$post({ param: { id } }),
    "The items were not restocked."
  );
}

export interface ManualOrderBody {
  phone: string;
  name: string;
  lines: { variantId: string; quantity: number }[];
  address: {
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    area: string | null;
    city: string;
    postalCode: string | null;
    country: string;
  };
  zoneId: string;
  paymentMethod: string;
  paymentReceived?: { transactionId: string; senderAccount?: string };
  note?: string;
}

export async function createManualOrder(body: ManualOrderBody) {
  return answer(
    await api.admin.shop.orders.$post({ json: body }),
    "The order was not created."
  );
}

// Payments, through the existing `/admin/payment` routes (plan 0106, Phase 5) -------------

export type RejectReason =
  | "amount_mismatch"
  | "not_found"
  | "duplicate"
  | "delivery_refused"
  | "delivery_failed"
  | "other";

export async function reviewPayment(
  id: string,
  body:
    | { action: "confirm"; note?: string }
    | { action: "reject"; reason: RejectReason; note?: string }
) {
  return answer(
    await api.admin.payment.payments[":id"].review.$post({
      json: body,
      param: { id },
    }),
    body.action === "confirm"
      ? "The payment was not confirmed."
      : "The payment was not rejected."
  );
}

export async function recordRefund(id: string, amount: number, note?: string) {
  return answer(
    await api.admin.payment.payments[":id"].refunds.$post({
      json: { amount, ...(note ? { note } : {}) },
      param: { id },
    }),
    "The refund was not recorded."
  );
}

// Customers ------------------------------------------------------------------------------

export const customersQuery = (q: string, page: number) =>
  queryOptions({
    queryKey: shopKeys.customers(q, page),
    queryFn: async () =>
      answer(
        await api.admin.shop.customers.$get({
          query: { page: String(page), ...(q.trim() === "" ? {} : { q }) },
        }),
        "The customer list did not load."
      ),
  });

export const customerQuery = (id: string) =>
  queryOptions({
    queryKey: shopKeys.customer(id),
    queryFn: async () =>
      answer(
        await api.admin.shop.customers[":id"].$get({ param: { id } }),
        "The customer did not load."
      ),
  });

export type CustomerList = Awaited<
  ReturnType<NonNullable<ReturnType<typeof customersQuery>["queryFn"]>>
>;
export type CustomerRow = CustomerList["customers"][number];
export type Customer = Awaited<
  ReturnType<NonNullable<ReturnType<typeof customerQuery>["queryFn"]>>
>;

/** The "New order" page's phone lookup: the owner of the number, or null. */
export async function lookupCustomer(phone: string) {
  const body = await answer(
    await api.admin.shop.customers.lookup.$get({ query: { phone } }),
    "The phone lookup failed."
  );
  return body.customer;
}

export type LookedUpCustomer = NonNullable<
  Awaited<ReturnType<typeof lookupCustomer>>
>;

// Zones ----------------------------------------------------------------------------------

export const zonesQuery = () =>
  queryOptions({
    queryKey: shopKeys.zones,
    queryFn: async () =>
      answer(await api.admin.shop.zones.$get(), "The zones did not load."),
  });

export type Zone = Awaited<
  ReturnType<NonNullable<ReturnType<typeof zonesQuery>["queryFn"]>>
>["zones"][number];

export interface ZoneFields {
  name: string;
  rate: number;
  active: boolean;
  position: number;
}

export async function createZone(fields: ZoneFields) {
  return answer(
    await api.admin.shop.zones.$post({ json: fields }),
    "The zone was not created."
  );
}

export async function updateZone(id: string, fields: Partial<ZoneFields>) {
  return answer(
    await api.admin.shop.zones[":id"].$patch({ json: fields, param: { id } }),
    "The zone was not saved."
  );
}

export async function deleteZone(id: string) {
  return answer(
    await api.admin.shop.zones[":id"].$delete({ param: { id } }),
    "The zone was not deleted."
  );
}

// Reports --------------------------------------------------------------------------------

export type ReportRangeId = "today" | "7d" | "30d" | "custom";

export const reportQuery = (range: ReportRangeId, from: string, to: string) =>
  queryOptions({
    queryKey: shopKeys.report(range, from, to),
    queryFn: async () =>
      answer(
        await api.admin.shop.reports.$get({
          query: range === "custom" ? { from, range, to } : { range },
        }),
        "The report did not load."
      ),
  });

export type Report = Awaited<
  ReturnType<NonNullable<ReturnType<typeof reportQuery>["queryFn"]>>
>;
