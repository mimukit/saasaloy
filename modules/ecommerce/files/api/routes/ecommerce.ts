import { zValidator } from "@hono/zod-validator";
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
  orderPayments,
  setOrderPaymentMethod,
} from "@repo/db/repositories/ecommerce/orders";
import type { OrderDetail } from "@repo/db/repositories/ecommerce/orders";
import { listZones } from "@repo/db/repositories/ecommerce/zones";
import { cartTotals, EcommerceError } from "@repo/ecommerce";
import { createPayment } from "@repo/payment";
import {
  cartItemInput,
  cartItemUpdateInput,
  checkoutInput,
  payAgainInput,
  paymentSubmitInput,
  productListQuery,
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

async function cartBody(db: Db, cart: CartRow | null) {
  if (!cart) {
    return {
      ...cartTotals([], shop().currency),
      id: null,
      lines: [],
      userId: null,
    };
  }
  return getCartView(db, cart.id);
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
  .get("/products", validProductList, (c) =>
    scoped(c, async (db) => {
      const query = c.req.valid("query");
      const page = await listProducts(db, {
        categorySlug: query.category,
        currency: shop().currency,
        page: query.page,
        pageSize: shop().pageSize,
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
  .get("/products/:slug", (c) =>
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

  .get("/zones", (c) =>
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
  .get("/payment-methods", (c) =>
    scoped(c, async () => {
      const methods = createPayment(env(c)).methods();
      return c.json(
        {
          methods: methods.map((method) => ({
            id: method.id,
            label: method.label,
          })),
        },
        200
      );
    })
  )

  .get("/cart", (c) =>
    scoped(c, async (db) => {
      const cart = await resolveCart(c, db, { create: false });
      return c.json(await cartBody(db, cart), 200);
    })
  )

  // Add to the cart. Above the available stock is a 409 `out_of_stock` and changes nothing.
  .post("/cart/items", validCartItem, (c) =>
    scoped(c, async (db) => {
      const body = c.req.valid("json");
      const cart = await resolveCart(c, db, { create: true });
      if (!cart) {
        throw new EcommerceError("not_found", "No cart.");
      }
      await addCartItem(db, cart.id, body.variantId, body.quantity);
      return c.json(await getCartView(db, cart.id), 200);
    })
  )

  .patch("/cart/items/:variantId", validCartUpdate, (c) =>
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
      return c.json(await getCartView(db, cart.id), 200);
    })
  )

  .delete("/cart/items/:variantId", (c) =>
    scoped(c, async (db) => {
      const cart = await resolveCart(c, db, { create: false });
      if (cart) {
        await setCartItemQuantity(db, cart.id, c.req.param("variantId"), 0);
      }
      return c.json(await cartBody(db, cart), 200);
    })
  )

  .get("/addresses", signedIn, (c) =>
    scoped(c, async (db) => {
      const user = await sessionUser(c);
      return c.json({ addresses: await listAddresses(db, user.id) }, 200);
    })
  )

  // Place the order from the caller's cart and start its payment. Answers `next` from
  // `payment`: instructions for a manual method, a redirect for a hosted checkout.
  .post("/checkout", signedIn, validCheckout, (c) =>
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

      const placed = await placeOrder(db, env(c), {
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

  .get("/orders", signedIn, validPage, (c) =>
    scoped(c, async (db) => {
      const user = await sessionUser(c);
      await cancelExpiredOrders(db, { userId: user.id });
      const page = await listOrders(db, {
        page: c.req.valid("query").page,
        pageSize: shop().pageSize,
        userId: user.id,
      });
      return c.json(
        {
          orders: page.orders.map((order) => ({
            createdAt: order.createdAt.toISOString(),
            currency: order.currency,
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

  .get("/orders/:number", signedIn, (c) =>
    scoped(c, async (db) => {
      const user = await sessionUser(c);
      const order = await ownOrder(db, user, c.req.param("number"));
      return c.json(
        buyerOrderView(order, await orderPayments(db, order.id)),
        200
      );
    })
  )

  // "Pay again" (grill Q11): a new payment for a placed order whose last payment failed
  // or was cancelled. A new method also becomes the order's method.
  .post("/orders/:number/pay", signedIn, validPayAgain, (c) =>
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
        return c.json(
          buyerOrderView(fresh, await orderPayments(db, order.id)),
          200
        );
      })
  );
