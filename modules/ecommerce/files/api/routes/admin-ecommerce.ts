import { zValidator } from "@hono/zod-validator";
import {
  ADMIN_APP_ROLES,
  requireAdminApp,
  withAuthScope,
} from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { placeholderEmail } from "@repo/auth/phone-rules";
import { renderRichText } from "@repo/cms";
import type { RichTextDocument } from "@repo/cms";
import { config } from "@repo/config";
import { withDb } from "@repo/db/client";
import type { Db } from "@repo/db/client";
import {
  addProductImage,
  createCategory,
  createProduct,
  deleteProduct,
  getProduct,
  listCategories,
  listProducts,
  removeProductImage,
  removeVariantPrice,
  setProductOptions,
  setProductStatus,
  setVariantPrice,
  updateProduct,
  updateVariant,
} from "@repo/db/repositories/ecommerce/catalog";
import {
  createPhoneCustomer,
  customerStats,
  findUserByPhone,
  getCustomer,
  listCustomers,
} from "@repo/db/repositories/ecommerce/customers";
import {
  cancelExpiredOrders,
  countPlacedCod,
  getOrder,
  listOrders,
  orderPayments,
  restockReturnedOrder,
  wasRestocked,
} from "@repo/db/repositories/ecommerce/orders";
import type {
  OrderDetail,
  OrderRow,
} from "@repo/db/repositories/ecommerce/orders";
import {
  codReport,
  ordersByStatus,
  salesByDay,
  topProducts,
} from "@repo/db/repositories/ecommerce/reports";
import { adjustStock } from "@repo/db/repositories/ecommerce/stock";
import {
  createZone,
  deleteZone,
  getZone,
  listZones,
  updateZone,
} from "@repo/db/repositories/ecommerce/zones";
import { productImages, productVariants } from "@repo/db/schema/ecommerce";
import { EcommerceError } from "@repo/ecommerce";
import type { OrderStatus } from "@repo/ecommerce";
import { createPayment, takesNoSubmission } from "@repo/payment";
import {
  categoryInput,
  customerListQuery,
  customerLookupQuery,
  manualOrderInput,
  orderListQuery,
  orderStatusInput,
  productImageInput,
  productInput,
  productListQuery,
  productOptionsInput,
  productStatusInput,
  reportQuery,
  shippingZoneInput,
  stockAdjustInput,
  variantInput,
} from "@repo/validators/ecommerce";
import { errorBody } from "@repo/validators/common";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { apiEnv } from "../env";
import { adminWrite } from "../lib/admin-write";
import type { AdminWriteScope } from "../lib/admin-write";
import { imagesOf } from "../lib/ecommerce/catalog-view";
import { invalidInput, shopError } from "../lib/ecommerce/http";
import {
  moveOrder,
  mustGetOrder,
  orderLabel,
  placeOrder,
  staffOrderView,
} from "../lib/ecommerce/order-flow";
import type { ShopEnv } from "../lib/ecommerce/order-flow";
import { reportRange } from "../lib/ecommerce/report-range";
import { publicImageUrl } from "../lib/file-uploads";
import type { FileUploadsEnv } from "../lib/file-uploads";
import { createPaymentStore, withPaymentStore } from "../payment-store";
// Registers the payment listener's handler at module load.
import "../lib/ecommerce/payment-listener";

// The shop's staff api, mounted at `/admin/shop` by the ecommerce module's second
// `chained-route` patch. The mount is not `/admin` because `admin` already routes `/admin`.
//
//   products    list, read, create, edit, publish, delete; options and the generated
//               variant grid; a variant's SKU, price and active flag; stock edits; images
//   categories  list, create
//   orders      list (status and COD filters), the awaiting-call count, detail, the
//               "New order" page (Q33 to Q35), status actions, restock after a return
//   customers   list, detail, lookup by phone
//   zones       list, create, edit, delete
//   reports     sales by day, top products, orders by status, COD collection and refusal
//
// Who may call: the roles that open the admin shell, `ADMIN_APP_ROLES` (plan 0106,
// "Admin"). Every route lists `shopGate` first, before its validator, so a caller with no
// admin session gets 401 and a client-only user gets 403, whatever the body says.
//
// Every write runs through `adminWrite` and names its action in `../audit/ecommerce.ts`
// (Q20), so the change and its audit row commit together. A payment listener set off
// inside a write (a manual order's payment confirmed at once) writes through the same
// transaction, through `currentAdminWrite()`.
//
// Reading the order list or one order cancels the expired unpaid orders it touches first,
// with a `system` event (grill Q3).
//
// Route module contract: ONE chained expression under a NAMED export matching the file.

type Bindings = AuthDbBindings & FileUploadsEnv & Record<string, unknown>;
type StaffContext = Context<{ Bindings: Bindings }>;

const shop = () => config.ecommerce;

/** 401 without an admin session, 403 for a role outside `ADMIN_APP_ROLES`. */
const shopGate = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  await withAuthScope(c, () => requireAdminApp(c));
  return next();
});

function env(c: StaffContext): ShopEnv {
  return c.env as ShopEnv;
}

/** A staff read: the gate, this request's client, and the envelope for a shop error. */
function staff<T>(c: StaffContext, body: (db: Db) => Promise<T>) {
  return withAuthScope(c, async () => {
    await requireAdminApp(c);
    return withDb(c, (db) =>
      withPaymentStore(createPaymentStore(db), async () => {
        try {
          return await body(db);
        } catch (error) {
          return shopError(c, error);
        }
      })
    );
  });
}

/**
 * A staff write: `adminWrite` with the shop's roles, the payment store built over its
 * transaction, and the envelope for a shop error, which rolls the write back.
 */
function staffWrite<T>(
  c: StaffContext,
  body: (scope: AdminWriteScope) => Promise<T>
) {
  return adminWrite(
    c,
    (scope) =>
      withPaymentStore(createPaymentStore(scope.db), async () => {
        try {
          return await body(scope);
        } catch (error) {
          return shopError(c, error);
        }
      }),
    { roles: ADMIN_APP_ROLES }
  );
}

/** Render a product description once, on save, as the CMS does at publish. */
function renderDescription(
  c: StaffContext,
  description: Record<string, unknown> | null
): string | null {
  if (description === null) {
    return null;
  }
  const files = apiEnv(c.env);
  try {
    return renderRichText(description as unknown as RichTextDocument, {
      imageUrl: (key: string) => publicImageUrl(files, key),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InvalidDescriptionError(reason);
  }
}

class InvalidDescriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDescriptionError";
  }
}

/** A 400 for a description the renderer refuses, or the shop envelope. */
function writeError(c: StaffContext, error: unknown): Response {
  if (error instanceof InvalidDescriptionError) {
    return c.json(
      errorBody(
        "invalid_input",
        `description: the body cannot be rendered (${error.message}).`
      ),
      400
    );
  }
  return shopError(c, error);
}

/** An order row as the staff list shows it. */
function orderRow(order: OrderRow) {
  return {
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    createdAt: order.createdAt.toISOString(),
    currency: order.currency,
    id: order.id,
    label: orderLabel(order),
    number: order.number,
    paymentMethod: order.paymentMethod,
    status: order.status,
    total: order.total,
    userId: order.userId,
    zoneName: order.zoneName,
  };
}

async function orderDetail(db: Db, order: OrderDetail) {
  const [payments, restocked, customer] = await Promise.all([
    orderPayments(db, order.id),
    wasRestocked(db, order.id),
    getCustomer(db, order.userId),
  ]);
  return {
    ...staffOrderView(order, payments, { restocked }),
    customer: customer
      ? {
          email: customer.email,
          id: customer.id,
          name: customer.name,
          phoneNumber: customer.phoneNumber,
          phoneNumberVerified: customer.phoneNumberVerified,
        }
      : null,
  };
}

/** The product's id for a variant, or `not_found`. */
async function productOfVariant(db: Db, variantId: string): Promise<string> {
  const [row] = await db
    .select({
      productId: productVariants.productId,
      title: productVariants.title,
    })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  if (!row) {
    throw new EcommerceError("not_found", `No variant ${variantId}.`);
  }
  return row.productId;
}

async function mustGetProduct(db: Db, productId: string) {
  const product = await getProduct(db, productId);
  if (!product) {
    throw new EcommerceError("not_found", `No product ${productId}.`);
  }
  return product;
}

async function productBody(c: StaffContext, db: Db, productId: string) {
  const product = await mustGetProduct(db, productId);
  const images = await imagesOf(db, c.env, [product.id]);
  return {
    ...product,
    images: images.get(product.id) ?? [],
    lowStockThreshold: shop().lowStockThreshold,
  };
}

const STATUS_ACTIONS = {
  cancelled: "ecommerce.order.cancel",
  confirmed: "ecommerce.order.confirm",
  delivered: "ecommerce.order.deliver",
  returned: "ecommerce.order.return",
  shipped: "ecommerce.order.ship",
} as const;

const validProductList = zValidator("query", productListQuery, invalidInput);
const validProduct = zValidator("json", productInput, invalidInput);
const validProductPatch = zValidator(
  "json",
  productInput.partial(),
  invalidInput
);
const validProductStatus = zValidator("json", productStatusInput, invalidInput);
const validOptions = zValidator("json", productOptionsInput, invalidInput);
const validVariant = zValidator("json", variantInput, invalidInput);
const validStock = zValidator("json", stockAdjustInput, invalidInput);
const validImage = zValidator("json", productImageInput, invalidInput);
const validCategory = zValidator("json", categoryInput, invalidInput);
const validOrderList = zValidator("query", orderListQuery, invalidInput);
const validManualOrder = zValidator("json", manualOrderInput, invalidInput);
const validOrderStatus = zValidator("json", orderStatusInput, invalidInput);
const validCustomerList = zValidator("query", customerListQuery, invalidInput);
const validLookup = zValidator("query", customerLookupQuery, invalidInput);
const validZone = zValidator("json", shippingZoneInput, invalidInput);
const validZonePatch = zValidator(
  "json",
  shippingZoneInput.partial(),
  invalidInput
);
const validReport = zValidator("query", reportQuery, invalidInput);

export const adminEcommerce = new Hono<{ Bindings: Bindings }>()
  // Products ------------------------------------------------------------------------

  .get("/products", shopGate, validProductList, (c) =>
    staff(c, async (db) => {
      const query = c.req.valid("query");
      const page = await listProducts(db, {
        categorySlug: query.category,
        currency: shop().currency,
        page: query.page,
        pageSize: shop().pageSize,
        status: query.status,
      });
      const images = await imagesOf(
        db,
        c.env,
        page.products.map((product) => product.id)
      );
      return c.json(
        {
          currency: shop().currency,
          lowStockThreshold: shop().lowStockThreshold,
          page: page.page,
          pageCount: page.pageCount,
          products: page.products.map((product) => ({
            ...product,
            image: images.get(product.id)?.[0] ?? null,
            lowStock: product.available <= shop().lowStockThreshold,
          })),
          total: page.total,
        },
        200
      );
    })
  )

  .post("/products", shopGate, validProduct, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const body = c.req.valid("json");
      try {
        const product = await createProduct(db, {
          categoryId: body.categoryId,
          description: body.description,
          descriptionHtml: renderDescription(c, body.description),
          slug: body.slug,
          title: body.title,
        });
        audit({
          action: "ecommerce.product.create",
          after: {
            slug: product.slug,
            status: product.status,
            title: product.title,
          },
          target: { id: product.id, label: product.title },
        });
        return c.json(await productBody(c, db, product.id), 201);
      } catch (error) {
        return writeError(c, error);
      }
    })
  )

  .get("/products/:id", shopGate, (c) =>
    staff(c, async (db) =>
      c.json(await productBody(c, db, c.req.param("id")), 200)
    )
  )

  .patch("/products/:id", shopGate, validProductPatch, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const body = c.req.valid("json");
      const id = c.req.param("id");
      try {
        const before = await mustGetProduct(db, id);
        const after = await updateProduct(db, id, {
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.slug === undefined ? {} : { slug: body.slug }),
          ...(body.categoryId === undefined
            ? {}
            : { categoryId: body.categoryId }),
          ...(body.description === undefined
            ? {}
            : {
                description: body.description,
                descriptionHtml: renderDescription(c, body.description),
              }),
        });
        audit({
          action: "ecommerce.product.update",
          after: {
            categoryId: after.categoryId,
            descriptionHtml: after.descriptionHtml,
            slug: after.slug,
            title: after.title,
          },
          before: {
            categoryId: before.categoryId,
            descriptionHtml: before.descriptionHtml,
            slug: before.slug,
            title: before.title,
          },
          target: { id, label: after.title },
        });
        return c.json(await productBody(c, db, id), 200);
      } catch (error) {
        return writeError(c, error);
      }
    })
  )

  // Publish or unpublish. Active needs one or more active variants (grill Q4).
  .post("/products/:id/status", shopGate, validProductStatus, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const { status } = c.req.valid("json");
      const before = await mustGetProduct(db, id);
      const after = await setProductStatus(db, id, status);
      audit({
        action:
          status === "active"
            ? "ecommerce.product.publish"
            : "ecommerce.product.unpublish",
        after: { status: after.status },
        before: { status: before.status },
        target: { id, label: after.title },
      });
      return c.json(await productBody(c, db, id), 200);
    })
  )

  .delete("/products/:id", shopGate, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const before = await mustGetProduct(db, id);
      await deleteProduct(db, id);
      audit({
        action: "ecommerce.product.delete",
        before: {
          slug: before.slug,
          status: before.status,
          title: before.title,
        },
        target: { id, label: before.title },
      });
      return c.json({ id }, 200);
    })
  )

  // Replace the options and regenerate the variant grid. A kept combination keeps its
  // variant, SKU, prices and stock; a new one starts inactive and unpriced.
  .put("/products/:id/options", shopGate, validOptions, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const before = await mustGetProduct(db, id);
      const after = await setProductOptions(
        db,
        id,
        c.req.valid("json").options
      );
      audit({
        action: "ecommerce.product.options",
        after: {
          options: after.options.map((option) => ({
            name: option.name,
            values: option.values.map((value) => value.value),
          })),
          variantCount: after.variants.length,
        },
        before: {
          options: before.options.map((option) => ({
            name: option.name,
            values: option.values.map((value) => value.value),
          })),
          variantCount: before.variants.length,
        },
        target: { id, label: after.title },
      });
      return c.json(await productBody(c, db, id), 200);
    })
  )

  // One row of the variant grid: SKU, store-currency price and active flag. A variant
  // needs a store price to be active, and an active one keeps it.
  .put("/variants/:id", shopGate, validVariant, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const productId = await productOfVariant(db, id);
      const product = await mustGetProduct(db, productId);
      const before = product.variants.find((variant) => variant.id === id);
      const { currency } = shop();
      const options = { storeCurrency: currency };
      if (body.price !== null) {
        await setVariantPrice(db, id, { amount: body.price, currency });
      }
      await updateVariant(
        db,
        id,
        { active: body.active, sku: body.sku },
        options
      );
      if (body.price === null) {
        await removeVariantPrice(db, id, currency, options);
      }
      const fresh = await mustGetProduct(db, productId);
      const after = fresh.variants.find((variant) => variant.id === id);
      const priceOf = (variant: typeof before) =>
        variant?.prices.find((price) => price.currency === currency)?.amount ??
        null;
      audit({
        action: "ecommerce.variant.update",
        after: {
          active: after?.active,
          price: priceOf(after),
          sku: after?.sku,
        },
        before: {
          active: before?.active,
          price: priceOf(before),
          sku: before?.sku,
        },
        target: {
          id,
          label: [product.title, after?.title].filter(Boolean).join(" / "),
        },
      });
      return c.json(await productBody(c, db, productId), 200);
    })
  )

  // A staff stock edit: a delta or a counted figure. Writes a `stock_movements` row.
  .post("/variants/:id/stock", shopGate, validStock, (c) =>
    staffWrite(c, async ({ db, actor, audit }) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const productId = await productOfVariant(db, id);
      const product = await mustGetProduct(db, productId);
      const before = product.variants.find((variant) => variant.id === id);
      const onHand = await adjustStock(
        db,
        id,
        "delta" in body ? { delta: body.delta } : { onHand: body.onHand },
        { actorUserId: actor.id, note: body.note ?? null }
      );
      audit({
        action: "ecommerce.stock.adjust",
        after: { onHand },
        before: { onHand: before?.stock.onHand ?? 0 },
        target: {
          id,
          label: [product.title, before?.title].filter(Boolean).join(" / "),
        },
      });
      return c.json(await productBody(c, db, productId), 200);
    })
  )

  .post("/products/:id/images", shopGate, validImage, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const product = await mustGetProduct(db, id);
      const image = await addProductImage(db, { ...body, productId: id });
      audit({
        action: "ecommerce.image.create",
        after: { imageId: image.id, storageObjectId: image.storageObjectId },
        target: { id, label: product.title },
      });
      return c.json(await productBody(c, db, id), 201);
    })
  )

  .delete("/images/:id", shopGate, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const [image] = await db
        .select()
        .from(productImages)
        .where(eq(productImages.id, id));
      if (!image) {
        throw new EcommerceError("not_found", `No image ${id}.`);
      }
      const product = await mustGetProduct(db, image.productId);
      await removeProductImage(db, id);
      audit({
        action: "ecommerce.image.delete",
        before: { imageId: id, storageObjectId: image.storageObjectId },
        target: { id: product.id, label: product.title },
      });
      return c.json(await productBody(c, db, product.id), 200);
    })
  )

  // Categories ----------------------------------------------------------------------

  .get("/categories", shopGate, (c) =>
    staff(c, async (db) =>
      c.json({ categories: await listCategories(db) }, 200)
    )
  )

  .post("/categories", shopGate, validCategory, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const category = await createCategory(db, c.req.valid("json"));
      audit({
        action: "ecommerce.category.create",
        after: { name: category.name, slug: category.slug },
        target: { id: category.id, label: category.name },
      });
      return c.json(category, 201);
    })
  )

  // Orders --------------------------------------------------------------------------

  .get("/orders", shopGate, validOrderList, (c) =>
    staff(c, async (db) => {
      const query = c.req.valid("query");
      await cancelExpiredOrders(db);
      const page = await listOrders(db, {
        page: query.page,
        pageSize: shop().pageSize,
        paymentMethod: query.cod === true ? "cod" : undefined,
        status: query.status === "all" ? undefined : query.status,
      });
      return c.json(
        {
          orders: page.orders.map(orderRow),
          page: page.page,
          pageCount: page.pageCount,
          total: page.total,
        },
        200
      );
    })
  )

  // The sidebar badge on Orders: placed COD orders awaiting a call (`nav-counts`).
  .get("/orders/awaiting-call-count", shopGate, (c) =>
    staff(c, async (db) => c.json({ count: await countPlacedCod(db) }, 200))
  )

  .get("/orders/:id", shopGate, (c) =>
    staff(c, async (db) => {
      const id = c.req.param("id");
      await cancelExpiredOrders(db, { orderIds: [id] });
      const order = await getOrder(db, id);
      if (!order) {
        throw new EcommerceError("not_found", `No order ${id}.`);
      }
      return c.json(await orderDetail(db, order), 200);
    })
  )

  // The "New order" page (Q33 to Q35). A phone that belongs to a user links the order to
  // them; a new phone becomes a client user with the typed name and an unverified phone.
  // Line prices come from the catalog: a sent price is stripped by the validator. "Payment
  // already received" submits the transaction id and confirms through the payment core,
  // and the listener confirms the order, all inside this write's transaction.
  .post("/orders", shopGate, validManualOrder, (c) =>
    staffWrite(c, async ({ db, actor, audit }) => {
      const body = c.req.valid("json");
      const known = await findUserByPhone(db, body.phone);
      const customer =
        known ??
        (await createPhoneCustomer(db, {
          email: placeholderEmail(body.phone),
          name: body.name,
          phone: body.phone,
        }));
      const placed = await placeOrder(db, env(c), {
        actor: { type: "staff", userId: actor.id },
        contactName: body.name,
        contactPhone: body.phone,
        lines: body.lines,
        note: body.note ?? null,
        paymentMethod: body.paymentMethod,
        shippingAddress: body.address,
        userId: customer.id,
        zoneId: body.zoneId,
      });
      if (body.paymentReceived) {
        if (takesNoSubmission(placed.payment)) {
          return c.json(
            errorBody(
              "invalid_input",
              `paymentReceived: ${body.paymentMethod} takes no transaction id. Confirm it from the order when the cash comes in.`
            ),
            400
          );
        }
        const payments = createPayment(env(c));
        await payments.submit(placed.payment.id, {
          amount: placed.order.total,
          senderAccount: body.paymentReceived.senderAccount ?? body.phone,
          transactionId: body.paymentReceived.transactionId,
        });
        await payments.confirm(placed.payment.id, {
          actorUserId: actor.id,
          note: "Received when the order was taken.",
        });
      }
      const order = await mustGetOrder(db, placed.order.id);
      audit({
        action: "ecommerce.order.create",
        after: {
          customer: { existing: known !== null, userId: customer.id },
          paymentMethod: order.paymentMethod,
          paymentReceived: body.paymentReceived !== undefined,
          status: order.status,
          total: order.total,
        },
        target: { id: order.id, label: orderLabel(order) },
      });
      return c.json(
        {
          customer: { existing: known !== null, id: customer.id },
          next: placed.next,
          order: await orderDetail(db, order),
        },
        201
      );
    })
  )

  // A staff status action: confirm, ship, deliver, cancel or return. Ship converts the
  // holds into stock movements; return restocks when `restock` is set (grill Q8).
  .post("/orders/:id/status", shopGate, validOrderStatus, (c) =>
    staffWrite(c, async ({ db, actor, audit }) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const before = await mustGetOrder(db, id);
      const to: OrderStatus = body.status;
      const after = await moveOrder(db, env(c), {
        actor: { type: "staff", userId: actor.id },
        note: body.note ?? null,
        orderId: id,
        restock: to === "returned" ? body.restock : undefined,
        to,
      });
      audit({
        action: STATUS_ACTIONS[body.status],
        after: {
          status: after.status,
          ...(to === "returned" ? { restock: body.restock } : {}),
        },
        before: { status: before.status },
        target: { id, label: orderLabel(after) },
      });
      return c.json(await orderDetail(db, after), 200);
    })
  )

  // Put a returned order's items back, for an order the payment listener returned.
  .post("/orders/:id/restock", shopGate, (c) =>
    staffWrite(c, async ({ db, actor, audit }) => {
      const id = c.req.param("id");
      await restockReturnedOrder(db, id, { type: "staff", userId: actor.id });
      const order = await mustGetOrder(db, id);
      audit({
        action: "ecommerce.order.restock",
        after: { restocked: true },
        before: { restocked: false },
        target: { id, label: orderLabel(order) },
      });
      return c.json(await orderDetail(db, order), 200);
    })
  )

  // Customers -----------------------------------------------------------------------

  .get("/customers", shopGate, validCustomerList, (c) =>
    staff(c, async (db) => {
      const query = c.req.valid("query");
      const page = await listCustomers(db, {
        page: query.page,
        pageSize: shop().pageSize,
        query: query.q,
      });
      return c.json(page, 200);
    })
  )

  // The "New order" page's phone lookup (Q34): the user who owns the number, or null.
  .get("/customers/lookup", shopGate, validLookup, (c) =>
    staff(c, async (db) => {
      const user = await findUserByPhone(db, c.req.valid("query").phone);
      if (!user) {
        return c.json({ customer: null }, 200);
      }
      return c.json(
        { customer: { ...user, ...(await customerStats(db, user.id)) } },
        200
      );
    })
  )

  .get("/customers/:id", shopGate, (c) =>
    staff(c, async (db) => {
      const id = c.req.param("id");
      const customer = await getCustomer(db, id);
      if (!customer) {
        throw new EcommerceError("not_found", `No customer ${id}.`);
      }
      const orders = await listOrders(db, {
        pageSize: 50,
        userId: id,
      });
      return c.json({ ...customer, orders: orders.orders.map(orderRow) }, 200);
    })
  )

  // Zones ---------------------------------------------------------------------------

  .get("/zones", shopGate, (c) =>
    staff(c, async (db) => c.json({ zones: await listZones(db) }, 200))
  )

  .post("/zones", shopGate, validZone, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const zone = await createZone(db, {
        ...c.req.valid("json"),
        currency: shop().currency,
      });
      audit({
        action: "ecommerce.zone.create",
        after: { active: zone.active, name: zone.name, rate: zone.rate },
        target: { id: zone.id, label: zone.name },
      });
      return c.json(zone, 201);
    })
  )

  .patch("/zones/:id", shopGate, validZonePatch, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const before = await getZone(db, id);
      if (!before) {
        throw new EcommerceError("not_found", `No zone ${id}.`);
      }
      const zone = await updateZone(db, id, c.req.valid("json"));
      audit({
        action: "ecommerce.zone.update",
        after: {
          active: zone.active,
          name: zone.name,
          position: zone.position,
          rate: zone.rate,
        },
        before: {
          active: before.active,
          name: before.name,
          position: before.position,
          rate: before.rate,
        },
        target: { id, label: zone.name },
      });
      return c.json(zone, 200);
    })
  )

  .delete("/zones/:id", shopGate, (c) =>
    staffWrite(c, async ({ db, audit }) => {
      const id = c.req.param("id");
      const before = await getZone(db, id);
      if (!before) {
        throw new EcommerceError("not_found", `No zone ${id}.`);
      }
      await deleteZone(db, id);
      audit({
        action: "ecommerce.zone.delete",
        before: { active: before.active, name: before.name, rate: before.rate },
        target: { id, label: before.name },
      });
      return c.json({ id }, 200);
    })
  )

  // Reports -------------------------------------------------------------------------

  // Sales by day, top products, orders by status and the COD figures, for one range.
  .get("/reports", shopGate, validReport, (c) =>
    staff(c, async (db) => {
      const query = c.req.valid("query");
      let range;
      try {
        range = reportRange(query, new Date(), shop().timeZone);
      } catch (error) {
        return c.json(
          errorBody(
            "invalid_input",
            error instanceof Error ? error.message : String(error)
          ),
          400
        );
      }
      const [sales, top, statuses, cod] = await Promise.all([
        salesByDay(db, { ...range, timeZone: shop().timeZone }),
        topProducts(db, range),
        ordersByStatus(db, range),
        codReport(db, range),
      ]);
      const byDay = new Map(sales.map((day) => [day.day, day]));
      return c.json(
        {
          cod,
          currency: shop().currency,
          from: range.from.toISOString(),
          ordersByStatus: statuses,
          salesByDay: range.days.map(
            (day) => byDay.get(day) ?? { day, orders: 0, total: 0 }
          ),
          to: range.to.toISOString(),
          topProducts: top,
        },
        200
      );
    })
  );
