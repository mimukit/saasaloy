import { config } from "@repo/config";
import { formatPrice } from "@repo/ecommerce";
import { createShopClient, shopDate } from "@repo/ecommerce/client";
import type { ShopClient, ShopSort } from "@repo/ecommerce/client";
import type { OrderStatus } from "@repo/ecommerce";
import { webEnv } from "@web/env";

// The shop's shared pieces on `apps/web`, installed by `saasaloy add ecommerce`: the client
// the pages and islands read the shop through, the words they show, and the formatters.
//
// The pages live at `src/pages/shop/`, and Astro routes by file name. `config.ecommerce
// .basePath` builds every link the pages and islands write, so if you move the shop,
// rename that folder, the config value and the two `run_worker_first` entries in
// wrangler.jsonc in the same edit.
//
// A product slug of `cart`, `checkout` or `orders` is shadowed by the page of that name.

/** The shop client over `PUBLIC_API_URL`, with the browser's cookies on every call. */
export function shopClient(): ShopClient {
  return createShopClient({ apiUrl: webEnv().PUBLIC_API_URL });
}

/** The shop's URL prefix, `/shop` unless the project moved it. */
export const SHOP_BASE = config.ecommerce.basePath.replace(/\/+$/, "");

export const shopPaths = {
  cart: `${SHOP_BASE}/cart`,
  catalog: SHOP_BASE,
  checkout: `${SHOP_BASE}/checkout`,
  orders: `${SHOP_BASE}/orders`,
} as const;

/** A price for a screen: `৳1,450`, or `৳1,450.50` when it has a fraction. */
export function money(amount: number, currency: string): string {
  return formatPrice(amount, currency, config.app.locale);
}

/** A date in the shop's time zone: "16 Nov 2026", or with `time` the time as well. */
export function shownDate(iso: string, time = false): string {
  return shopDate(iso, config.app.locale, config.ecommerce.timeZone, { time });
}

/** `+8801712345678` as `+880 1712-345678`; any other number as it is. */
export function phoneText(phone: string): string {
  const match = /^\+880(\d{4})(\d{6})$/.exec(phone);
  return match ? `+880 ${match[1]}-${match[2]}` : phone;
}

/** The event islands send after a cart change, so the header count follows. */
export const CART_EVENT = "shop:cart";

/** Tell the header the cart now holds `itemCount` items. */
export function announceCart(itemCount: number): void {
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: itemCount }));
}

export const STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  cancelled: "Cancelled",
  confirmed: "Confirmed",
  delivered: "Delivered",
  placed: "Placed",
  returned: "Returned",
  shipped: "Shipped",
};

/** One line under each payment method at checkout, before the order exists. */
export function methodHint(id: string): string {
  if (id === "cod") {
    return "Pay the courier when the parcel arrives.";
  }
  if (id === "bkash" || id === "nagad" || id === "rocket") {
    return "Send money from your wallet. The next page shows the number and the amount.";
  }
  if (id === "bank") {
    return "Pay by bank transfer. The next page shows the account and the amount.";
  }
  return "You finish the payment after you place the order.";
}

/** The catalog's sort choices, in the order the select lists them. */
export const SHOP_SORTS: readonly { value: ShopSort; label: string }[] = [
  { label: "Newest", value: "newest" },
  { label: "Price: low to high", value: "price_asc" },
  { label: "Price: high to low", value: "price_desc" },
];

/** Every word the shop pages show. `{siteName}` is filled in by the page. */
export const shopCopy = {
  title: "Shop",
  lead: "Everything {siteName} sells, newest first.",
  allCategories: "All",
  categoriesLabel: "Categories",
  sortLabel: "Sort products",
  sortApply: "Sort",
  empty: "Nothing is for sale yet. Products show here once staff publish them.",
  emptyCategory: "Nothing in this category is for sale right now.",
  outOfStock: "Out of stock",
  from: "From",
  pagerLabel: "Pages",
  newer: "Previous",
  older: "Next",
  allProducts: "All products",
  cart: "Cart",
  checkout: "Checkout",
  orders: "Your orders",
} as const;
