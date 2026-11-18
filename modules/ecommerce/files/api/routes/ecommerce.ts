import { declare, zValidator } from "../contract";
import { getSession, requireSession } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { config } from "@repo/config";
import { withDb } from "@repo/db/client";
import type { Db } from "@repo/db/client";
import {
  addCartItem,
  clearCart,
  createGuestCart,
  getCart,
  getCartView,
  getOrCreateUserCart,
  mergeGuestCart,
  setCartItemQuantity,
} from "@repo/db/repositories/ecommerce/cart";
import type { CartRow } from "@repo/db/repositories/ecommerce/cart";
import {
  getActiveProductBySlug,
  listCategories,
  listProducts,
} from "@repo/db/repositories/ecommerce/catalog";
import {
  getOwnAddress,
  listAddresses,
  saveAddress,
} from "@repo/db/repositories/ecommerce/customers";
import {
  cancelExpiredOrders,
  getOrderByNumber,
  listOrders,
  orderListExtras,
  orderPayments,
  orderReservations,
  setOrderPaymentMethod,
} from "@repo/db/repositories/ecommerce/orders";
import type {
  OrderDetail,
  OrderPaymentRow,
} from "@repo/db/repositories/ecommerce/orders";
import { listZones } from "@repo/db/repositories/ecommerce/zones";
import {
  cartTotals,
  EcommerceError,
  isEcommerceError,
  shortLineMessage,
} from "@repo/ecommerce";
import { createPayment } from "@repo/payment";
import {
  cartItemInput,
  cartItemUpdateInput,
  checkoutInput,
  payAgainInput,
  paymentSubmitInput,
  productListQuery,
  shopCategoryList,
  shopProduct,
  shopProductList,
} from "@repo/validators/ecommerce";
import { errorBody } from "@repo/validators/common";
import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { createPaymentStore, withPaymentStore } from "../payment-store";
import {
  imagesOf,
  productCard,
  productPage,
} from "../lib/ecommerce/catalog-view";
import type { ImageView } from "../lib/ecommerce/catalog-view";
import { invalidInput, shopError } from "../lib/ecommerce/http";
import {
  assertMethod,
  buyerOrderView,
  openPayment,
  orderLabel,
  paymentView,
  placeOrder,
} from "../lib/ecommerce/order-flow";
import type { ShopEnv } from "../lib/ecommerce/order-flow";
import { withShopDb } from "../lib/ecommerce/scope";
import type { FileUploadsEnv } from "../lib/file-uploads";
// Registers the payment listener's handler at module load.
import "../lib/ecommerce/payment-listener";

// The shop's public api, mounted at `/shop` by the ecommerce module's `chained-route`
// patch. `apps/web` reads it over `PUBLIC_API_URL`.
//
//   GET    /products, /products/:slug     the active catalog, store-currency prices only
//   GET    /categories                    the catalog's category chips
//   GET    /zones, /payment-methods       what checkout offers
//   GET    /cart                          the cart; a signed-in buyer's guest cart merges in
//   POST   /cart/items                    add to the cart
//   PATCH  /cart/items/:variantId         change a line; 0 removes it
//   DELETE /cart/items/:variantId         remove a line
//   GET    /addresses                     the buyer's saved addresses (session)
//   POST   /checkout                      place the order and start its payment (session)
//   GET    /orders, /orders/:number       the buyer's own orders (session)
//   POST   /orders/:number/pay            "Pay again" after a failed payment (session)
//   POST   /orders/:number/payments/:paymentId/submit   a manual payment's transaction id
//
// Every figure comes from the catalog and the zone. No body here carries a price, and the
// validators strip one a browser sends anyway (plan 0106, "Payment at checkout").
//
// Checkout identity (plan 0106, "Checkout identity"): a client session is required (401
// without), and its user has a verified phone, or a verified email while
// `config.ecommerce.requirePhoneOtp` is false (403 otherwise). The OTP itself is
// `auth-phone`'s `send-otp` and `verify`; this file adds no auth code and no limiter.
//
// A guest cart lives on the `shop_cart` cookie for `guestCartDays`. The first read with a
// session folds it into the user's cart, quantities added and capped at available stock
// (grill Q5), and drops the cookie.
//
// Reading an order, listing orders and checking out cancel the caller's expired unpaid
// orders first, with a `system` event (grill Q3).
//
// Route module contract: ONE chained expression under a NAMED export matching the file.

type Bindings = AuthDbBindings & FileUploadsEnv & Record<string, unknown>;
type ShopContext = Context<{ Bindings: Bindings }>;

const CART_COOKIE = "shop_cart";

const shop = () => config.ecommerce;

/** The fields of a client user checkout reads. `auth-phone` adds the phone pair. */
interface ShopUser {
  id: string;
  emailVerified: boolean;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
}

/** 401 before anything else when nobody is signed in on the client session. */
const signedIn = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  await requireSession(c);
  return next();
});

async function sessionUser(c: ShopContext): Promise<ShopUser> {
  const session = await requireSession(c);
  return session.user as unknown as ShopUser;
}

/**
 * The phone checkout trusts for the order, `null` when a verified email stands in for it,
 * or `undefined` when the buyer must verify a phone first.
 */
function verifiedPhone(user: ShopUser): string | null | undefined {
  if (user.phoneNumberVerified === true && user.phoneNumber) {
    return user.phoneNumber;
  }
  if (!shop().requirePhoneOtp && user.emailVerified) {
    return null;
  }
  return undefined;
}

function env(c: ShopContext): ShopEnv {
  return c.env as ShopEnv;
}

/**
 * Run `body` with this request's client, the payment store in scope for the core, and the
 * shop's scope for the payment listener. An `EcommerceError` or a `PaymentError` becomes
 * the api's error envelope.
 */
function scoped<T>(c: ShopContext, body: (db: Db) => Promise<T>) {
  return withDb(c, (db) =>
    withShopDb(db, () =>
      withPaymentStore(createPaymentStore(db), async () => {
        try {
          return await body(db);
        } catch (error) {
          return shopError(c, error);
        }
      })
    )
  );
}

function cookieOptions(c: ShopContext) {
  return {
    httpOnly: true,
    maxAge: shop().guestCartDays * 86_400,
    path: "/",
    sameSite: "Lax" as const,
    secure: new URL(c.req.url).protocol === "https:",
  };
}

/**
 * The caller's cart. Signed in: the user's cart, with any guest cart on the cookie merged
 * in and the cookie dropped. Signed out: the guest cart the cookie names, or a new one
 * when `create` is set, or null.
 */
async function resolveCart(
  c: ShopContext,
  db: Db,
  options: { create: boolean }
): Promise<CartRow | null> {
  const session = await getSession(c);
  const guestId = getCookie(c, CART_COOKIE);
  if (session) {
    if (guestId) {
      await mergeGuestCart(db, {
        currency: shop().currency,
        guestCartId: guestId,
        userId: session.user.id,
      });
      deleteCookie(c, CART_COOKIE, { path: "/" });
    }
    return getOrCreateUserCart(db, session.user.id, shop().currency);
  }
  if (guestId) {
    const cart = await getCart(db, guestId);
    if (cart && cart.userId === null) {
      return cart;
    }
  }
  if (!options.create) {
    return null;
  }
  const cart = await createGuestCart(db, {
    currency: shop().currency,
    lifetimeDays: shop().guestCartDays,
  });
  setCookie(c, CART_COOKIE, cart.id, cookieOptions(c));
  return cart;
}

/** A cart as the cart page shows it: each line with its product's first image. */
async function cartView(c: ShopContext, db: Db, cartId: string) {
  const view = await getCartView(db, cartId);
  const images = await imagesOf(db, c.env, [
    ...new Set(view.lines.map((line) => line.productId)),
  ]);
  return {
    ...view,
    lines: view.lines.map((line) => ({
      ...line,
      image: lineImage(images.get(line.productId), line.variantId),
    })),
  };
}

/** The variant's own image when it has one, else the product's first. */
function lineImage(
  images: readonly ImageView[] | undefined,
  variantId: string | null
): ImageView | null {
  return (
    images?.find((image) => image.variantId === variantId) ??
    images?.[0] ??
    null
  );
}

async function cartBody(c: ShopContext, db: Db, cart: CartRow | null) {
  if (!cart) {
    return {
      ...cartTotals([], shop().currency),
      id: null,
      lines: [],
      userId: null,
    };
  }
  return cartView(c, db, cart.id);
}

/** What a manual payment asks the payer, while the payment still waits on the payer. */
function waitingInstructions(row: OrderPaymentRow): unknown {
  if (row.status !== "pending") {
    return null;
  }
  const data = row.providerData as { instructions?: unknown } | null;
  return data?.instructions ?? null;
}

/**
 * The order page: the buyer's view of the order, each item with its image, each payment
 * with its instructions while it is pending, and when the stock hold runs out (null when
 * the order holds no stock or holds it with no expiry).
 */
async function orderPageBody(c: ShopContext, db: Db, order: OrderDetail) {
  const [payments, holds, images] = await Promise.all([
    orderPayments(db, order.id),
    orderReservations(db, order.id),
    // An item keeps its copy after its product is deleted; that item shows no image.
    imagesOf(db, c.env, [
      ...new Set(
        order.items.flatMap((item) => (item.productId ? [item.productId] : []))
      ),
    ]),
  ]);
  const view = buyerOrderView(order, payments);
  const timed =
    order.status === "placed" &&
    holds.length > 0 &&
    holds.every((hold) => hold.expiresAt !== null);
  const expiry = timed
    ? Math.max(...holds.map((hold) => hold.expiresAt?.getTime() ?? 0))
    : null;
  return {
    ...view,
    holdExpiresAt: expiry === null ? null : new Date(expiry).toISOString(),
    items: view.items.map((item) => ({
      ...item,
      image: item.productId
        ? lineImage(images.get(item.productId), item.variantId)
        : null,
    })),
    payments: view.payments.map((payment, index) => ({
      ...payment,
      instructions: waitingInstructions(payments[index] as OrderPaymentRow),
    })),
  };
}

/** The caller's order by its number, after its expired hold is settled; 404 for anyone else's. */
async function ownOrder(
  db: Db,
  user: ShopUser,
  raw: string
): Promise<OrderDetail> {
  const number = Number(raw);
  const order = Number.isSafeInteger(number)
    ? await getOrderByNumber(db, number)
    : null;
  if (!order || order.userId !== user.id) {
    throw new EcommerceError("not_found", `No order ${raw}.`);
  }
  const cancelled = await cancelExpiredOrders(db, { orderIds: [order.id] });
  if (cancelled.length === 0) {
    return order;
  }
  return (await getOrderByNumber(db, number)) ?? order;
}

const validProductList = zValidator("query", productListQuery, invalidInput);
const validCartItem = zValidator("json", cartItemInput, invalidInput);
const validCartUpdate = zValidator("json", cartItemUpdateInput, invalidInput);
const validCheckout = zValidator("json", checkoutInput, invalidInput);
const validPayAgain = zValidator("json", payAgainInput, invalidInput);
const validSubmit = zValidator("json", paymentSubmitInput, invalidInput);
const validPage = zValidator(
  "query",
  z.object({ page: z.coerce.number().int().min(1).default(1) }),
  invalidInput
);

export const ecommerce = new Hono<{ Bindings: Bindings }>()
  // The active catalog, newest first. A draft never shows; `status` in the query is ignored.
  .get(
    "/products",
    declare({
      name: "shop_products_list",
      description:
        "List the store's active products, newest first by default, with price range and available stock in the store currency. Filter by category slug and sort.",
      output: shopProductList,
      agent: {
        callable: true,
        readOnly: true,
        confirm: false,
        scope: null,
      },
    }),
    validProductList,
    (c) =>
      scoped(c, async (db) => {
        const query = c.req.valid("query");
        const page = await listProducts(db, {
          categorySlug: query.category,
          currency: shop().currency,
          page: query.page,
          pageSize: shop().pageSize,
          sort: query.sort,
          status: "active",
        });
        const images = await imagesOf(
          db,
          c.env,
          page.products.map((product) => product.id)
        );
        return c.json(
          {
            currency: shop().currency,
            page: page.page,
            pageCount: page.pageCount,
            products: page.products.map((product) =>
              productCard(product, images.get(product.id) ?? [])
            ),
            total: page.total,
          },
          200
        );
      })
  )

  // One active product by slug, with its active variants. 404 for a draft.
  .get(
    "/products/:slug",
    declare({
      name: "shop_product_read",
      description:
        "Read one active product by its slug, with its options, images and active variants with price and available stock.",
      output: shopProduct,
      agent: {
        callable: true,
        readOnly: true,
        confirm: false,
        scope: null,
      },
    }),
    (c) =>
      scoped(c, async (db) => {
        const product = await getActiveProductBySlug(db, c.req.param("slug"));
        if (!product) {
          return c.json(errorBody("not_found", "No such product."), 404);
        }
        const images = await imagesOf(db, c.env, [product.id]);
        return c.json(
          productPage(product, images.get(product.id) ?? [], shop().currency),
          200
        );
      })
  )

  .get(
    "/categories",
    declare({
      name: "shop_categories_list",
      description: "List the store's product categories.",
      output: shopCategoryList,
      agent: {
        callable: true,
        readOnly: true,
        confirm: false,
        scope: null,
      },
    }),
    (c) =>
      scoped(c, async (db) => {
        const categories = await listCategories(db);
        return c.json(
          {
            categories: categories.map((category) => ({
              id: category.id,
              name: category.name,
              slug: category.slug,
            })),
          },
          200
        );
      })
  )

  .get(
    "/zones",
    declare({
      name: "shop_zones_list",
      description:
        "List the delivery zones and their rates for the checkout form.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    (c) =>
      scoped(c, async (db) => {
        const zones = await listZones(db, { activeOnly: true });
        return c.json(
          {
            zones: zones.map((zone) => ({
              currency: zone.currency,
              id: zone.id,
              name: zone.name,
              rate: zone.rate,
            })),
          },
          200
        );
      })
  )

  // The methods the installed payment providers take now, for the checkout's picker.
  .get(
    "/payment-methods",
    declare({
      name: "shop_payment_methods_list",
      description: "List the payment methods the checkout offers.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    (c) =>
      scoped(c, async () => {
        const methods = createPayment(env(c)).methods();
        return c.json(
          {
            // `account` is the public number a manual method's payer sends to, so the
            // checkout radio can show it before the order exists. Null for cod and gateways.
            methods: methods.map((method) => ({
              account: method.account
                ? {
                    kind: method.account.kind ?? null,
                    label: method.account.label,
                    number: method.account.number,
                  }
                : null,
              id: method.id,
              label: method.label,
            })),
          },
          200
        );
      })
  )

  .get(
    "/cart",
    declare({
      name: "shop_cart_read",
      description: "Read the visitor's cart.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    (c) =>
      scoped(c, async (db) => {
        const cart = await resolveCart(c, db, { create: false });
        return c.json(await cartBody(c, db, cart), 200);
      })
  )

  // Add to the cart. Above the available stock is a 409 `out_of_stock` and changes nothing.
  .post(
    "/cart/items",
    declare({
      name: "shop_cart_item_add",
      description: "Add a variant to the cart.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    validCartItem,
    (c) =>
      scoped(c, async (db) => {
        const body = c.req.valid("json");
        const cart = await resolveCart(c, db, { create: true });
        if (!cart) {
          throw new EcommerceError("not_found", "No cart.");
        }
        await addCartItem(db, cart.id, body.variantId, body.quantity);
        return c.json(await cartView(c, db, cart.id), 200);
      })
  )

  .patch(
    "/cart/items/:variantId",
    declare({
      name: "shop_cart_item_update",
      description: "Change a cart line's quantity.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    validCartUpdate,
    (c) =>
      scoped(c, async (db) => {
        const cart = await resolveCart(c, db, { create: true });
        if (!cart) {
          throw new EcommerceError("not_found", "No cart.");
        }
        await setCartItemQuantity(
          db,
          cart.id,
          c.req.param("variantId"),
          c.req.valid("json").quantity
        );
        return c.json(await cartView(c, db, cart.id), 200);
      })
  )

  .delete(
    "/cart/items/:variantId",
    declare({
      name: "shop_cart_item_remove",
      description: "Remove a line from the cart.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    (c) =>
      scoped(c, async (db) => {
        const cart = await resolveCart(c, db, { create: false });
        if (cart) {
          await setCartItemQuantity(db, cart.id, c.req.param("variantId"), 0);
        }
        return c.json(await cartBody(c, db, cart), 200);
      })
  )

  .get(
    "/addresses",
    declare({
      name: "shop_addresses_list",
      description:
        "List the customer's saved delivery addresses for the checkout form.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    signedIn,
    (c) =>
      scoped(c, async (db) => {
        const user = await sessionUser(c);
        return c.json({ addresses: await listAddresses(db, user.id) }, 200);
      })
  )

  // Place the order from the caller's cart and start its payment. Answers `next` from
  // `payment`: instructions for a manual method, a redirect for a hosted checkout.
  .post(
    "/checkout",
    declare({
      name: "shop_checkout",
      description: "Place an order from the cart.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    signedIn,
    validCheckout,
    (c) =>
      scoped(c, async (db) => {
        const user = await sessionUser(c);
        const phone = verifiedPhone(user);
        if (phone === undefined) {
          return c.json(
            errorBody(
              "phone_unverified",
              "Verify your phone number before you check out."
            ),
            403
          );
        }
        const body = c.req.valid("json");
        await cancelExpiredOrders(db, { userId: user.id });

        const cart = await resolveCart(c, db, { create: true });
        if (!cart) {
          throw new EcommerceError("not_found", "No cart.");
        }
        const view = await getCartView(db, cart.id);
        if (view.lines.length === 0) {
          return c.json(errorBody("empty_cart", "The cart is empty."), 400);
        }
        const unavailable = view.lines.find((line) => !line.forSale);
        if (unavailable) {
          throw new EcommerceError(
            "not_for_sale",
            `${unavailable.productTitle} is no longer for sale. Remove it from the cart.`
          );
        }
        const short = shortLineMessage(view.lines);
        if (short) {
          throw new EcommerceError("out_of_stock", short);
        }

        let address: Record<string, unknown> & { name: string; phone: string };
        if (body.addressId) {
          const saved = await getOwnAddress(db, user.id, body.addressId);
          if (!saved) {
            throw new EcommerceError("not_found", "No such saved address.");
          }
          address = {
            area: saved.area,
            city: saved.city,
            country: saved.country,
            line1: saved.line1,
            line2: saved.line2,
            name: saved.name,
            phone: saved.phone,
            postalCode: saved.postalCode,
          };
        } else if (body.address) {
          ({ address } = body);
        } else {
          throw new EcommerceError("not_found", "No address.");
        }

        // The cart check above reads stock without a lock. A buyer who took the last unit
        // since then makes `createOrder` refuse under its row lock; name the line that ran
        // out rather than the variant id.
        let placed: Awaited<ReturnType<typeof placeOrder>>;
        try {
          placed = await placeOrder(db, env(c), {
            actor: { type: "system" },
            contactName: address.name,
            contactPhone: phone ?? address.phone,
            lines: view.lines.map((line) => ({
              quantity: line.quantity,
              variantId: line.variantId,
            })),
            note: body.note ?? null,
            paymentMethod: body.paymentMethod,
            returnUrl: body.returnUrl,
            shippingAddress: address,
            userId: user.id,
            zoneId: body.zoneId,
          });
        } catch (error) {
          if (isEcommerceError(error) && error.code === "out_of_stock") {
            const fresh = await getCartView(db, cart.id);
            throw new EcommerceError(
              "out_of_stock",
              shortLineMessage(fresh.lines) ??
                "An item in your cart sold out. Check the cart, then place the order again."
            );
          }
          throw error;
        }
        if (body.address && body.saveAddress) {
          await saveAddress(db, user.id, {
            area: body.address.area,
            city: body.address.city,
            country: body.address.country,
            isDefault: false,
            line1: body.address.line1,
            line2: body.address.line2,
            name: body.address.name,
            phone: body.address.phone,
            postalCode: body.address.postalCode,
            zoneId: body.zoneId,
          });
        }
        await clearCart(db, cart.id);
        const payments = await orderPayments(db, placed.order.id);
        return c.json(
          {
            next: placed.next,
            order: buyerOrderView(placed.order, payments),
            payment: paymentView(
              payments.find((row) => row.id === placed.payment.id) ??
                (placed.payment as unknown as (typeof payments)[number])
            ),
          },
          201
        );
      })
  )

  .get(
    "/orders",
    declare({
      name: "shop_orders_list",
      description: "List the customer's orders.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    signedIn,
    validPage,
    (c) =>
      scoped(c, async (db) => {
        const user = await sessionUser(c);
        await cancelExpiredOrders(db, { userId: user.id });
        const page = await listOrders(db, {
          page: c.req.valid("query").page,
          pageSize: shop().pageSize,
          userId: user.id,
        });
        const extras = await orderListExtras(
          db,
          page.orders.map((order) => order.id)
        );
        return c.json(
          {
            orders: page.orders.map((order) => ({
              createdAt: order.createdAt.toISOString(),
              currency: order.currency,
              itemCount: extras.get(order.id)?.itemCount ?? 0,
              label: orderLabel(order),
              number: order.number,
              paymentMethod: order.paymentMethod,
              status: order.status,
              total: order.total,
            })),
            page: page.page,
            pageCount: page.pageCount,
            total: page.total,
          },
          200
        );
      })
  )

  .get(
    "/orders/:number",
    declare({
      name: "shop_order_read",
      description: "Read one of the customer's orders.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    signedIn,
    (c) =>
      scoped(c, async (db) => {
        const user = await sessionUser(c);
        const order = await ownOrder(db, user, c.req.param("number"));
        return c.json(await orderPageBody(c, db, order), 200);
      })
  )

  // "Pay again" (grill Q11): a new payment for a placed order whose last payment failed
  // or was cancelled. A new method also becomes the order's method.
  .post(
    "/orders/:number/pay",
    declare({
      name: "shop_order_pay",
      description: "Start a new payment for an unpaid order.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    signedIn,
    validPayAgain,
    (c) =>
      scoped(c, async (db) => {
        const user = await sessionUser(c);
        const body = c.req.valid("json");
        const order = await ownOrder(db, user, c.req.param("number"));
        const before = await orderPayments(db, order.id);
        const last = before.at(-1);
        if (
          order.status !== "placed" ||
          !last ||
          (last.status !== "failed" && last.status !== "cancelled")
        ) {
          return c.json(
            errorBody(
              "conflict",
              "This order has no failed payment to try again."
            ),
            409
          );
        }
        const method = body.paymentMethod ?? order.paymentMethod ?? last.method;
        assertMethod(env(c), method);
        if (method !== order.paymentMethod) {
          await setOrderPaymentMethod(db, order.id, method);
        }
        const started = await openPayment(db, env(c), order, {
          method,
          returnUrl: body.returnUrl,
        });
        const fresh = await ownOrder(db, user, String(order.number));
        const payments = await orderPayments(db, order.id);
        return c.json(
          {
            next: started.next,
            order: buyerOrderView(fresh, payments),
            payment: paymentView(
              payments.find((row) => row.id === started.payment.id) ??
                (started.payment as unknown as (typeof payments)[number])
            ),
          },
          201
        );
      })
  )

  // The buyer's transaction id for a manual payment (bKash, Nagad, bank). The order's
  // hold then loses its expiry until staff review it.
  .post(
    "/orders/:number/payments/:paymentId/submit",
    declare({
      name: "shop_payment_submit",
      description: "Submit the proof of a manual payment.",
      agent: {
        callable: false,
        reason:
          "Checkout, payment and the cart stay with a person in the storefront.",
      },
    }),
    signedIn,
    validSubmit,
    (c) =>
      scoped(c, async (db) => {
        const user = await sessionUser(c);
        const order = await ownOrder(db, user, c.req.param("number"));
        const paymentId = c.req.param("paymentId");
        const payments = await orderPayments(db, order.id);
        if (!payments.some((row) => row.id === paymentId)) {
          throw new EcommerceError(
            "not_found",
            "No such payment on this order."
          );
        }
        await createPayment(env(c)).submit(paymentId, c.req.valid("json"));
        const fresh = await ownOrder(db, user, String(order.number));
        return c.json(await orderPageBody(c, db, fresh), 200);
      })
  );
