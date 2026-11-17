import { z } from "zod";
import { bangladeshMobile } from "./phone";

// One file per feature, directly under `src/`, imported as `@repo/validators/ecommerce`.
//
// Isomorphic on purpose: no Workers types, no `@repo/db`, no `@repo/ecommerce`. These
// schemas check the envelope of a request. The order statuses and the money rules are
// written here and in `@repo/ecommerce` both, because this package may not import that one;
// `ecommerce.test.ts` holds the two lists together.
//
// No checkout or cart body carries a price. Zod strips unknown keys, so a `price`, `amount`
// or `total` the browser sends never reaches a handler: every figure comes from the catalog
// and the zone (plan 0106, "Payment at checkout").

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const E164 = /^\+[1-9]\d{6,14}$/;

/** The order statuses, the same six as `ORDER_STATUSES` in `@repo/ecommerce`. */
export const ECOMMERCE_ORDER_STATUSES = [
  "placed",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

/** A record id. */
const id = z.string().min(1).max(128);

/** A whole amount in minor units, tax included. */
export const minorAmount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** An ISO 4217 code: three upper-case letters. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, {
  message: "Use a three-letter ISO 4217 code, such as BDT.",
});

/** A slug: lower-case words joined by single hyphens, at most 96 characters. */
export const productSlug = z.string().max(96).regex(SLUG, {
  message: "Use lower-case letters, digits and single hyphens.",
});

/** A phone: a Bangladeshi mobile in any common form, or any E.164 number. */
export const shopPhone = z.union([
  bangladeshMobile,
  z.string().trim().regex(E164, {
    message: "Use a mobile number, such as +8801712345678.",
  }),
]);

/** A quantity in a cart or an order line. */
const quantity = z.number().int().min(1).max(999);

const page = z.coerce.number().int().min(1).default(1);

// Catalog -------------------------------------------------------------------------------

/** Body of a product create or edit. Status changes go through `productStatusInput`. */
export const productInput = z.object({
  title: z.string().trim().min(1).max(200),
  slug: productSlug,
  /** Tiptap JSON from `@repo/cms/editor`. The api renders it to HTML on save. */
  description: z.record(z.string(), z.unknown()).nullable().default(null),
  categoryId: id.nullable().default(null),
});
export type ProductInput = z.infer<typeof productInput>;

/** Body of a publish or unpublish. */
export const productStatusInput = z.object({
  status: z.enum(["draft", "active"]),
});
export type ProductStatusInput = z.infer<typeof productStatusInput>;

/** Body of an options save: up to three options, each with distinct values. */
export const productOptionsInput = z.object({
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(50),
        values: z
          .array(z.string().trim().min(1).max(50))
          .min(1)
          .max(50)
          .refine((values) => new Set(values).size === values.length, {
            message: "Each value appears once.",
          }),
      })
    )
    .max(3)
    .refine(
      (options) =>
        new Set(options.map((option) => option.name.toLowerCase())).size ===
        options.length,
      { message: "Each option name appears once." }
    ),
});
export type ProductOptionsInput = z.infer<typeof productOptionsInput>;

/** One variant row of the editor's grid. */
export const variantInput = z.object({
  sku: z.string().trim().min(1).max(64).nullable().default(null),
  /** In the store currency, minor units. Null leaves the variant unpriced and inactive. */
  price: minorAmount.nullable(),
  active: z.boolean(),
});
export type VariantInput = z.infer<typeof variantInput>;

/** Body of a staff stock change: a delta, or a counted on-hand figure. */
export const stockAdjustInput = z.union([
  z.object({
    delta: z
      .number()
      .int()
      .refine((value) => value !== 0, {
        message: "Change stock by 1 or more.",
      }),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    onHand: z.number().int().min(0),
    note: z.string().trim().max(500).optional(),
  }),
]);
export type StockAdjustInput = z.infer<typeof stockAdjustInput>;

/** Query of the public catalog and the admin product list. */
export const productListQuery = z.object({
  page,
  category: productSlug.optional(),
  status: z.enum(["draft", "active", "all"]).default("all"),
  /** The staff list's search: a part of the title or of a variant's SKU, any case. */
  q: z.string().trim().max(120).optional(),
});
export type ProductListQuery = z.infer<typeof productListQuery>;

// Cart ----------------------------------------------------------------------------------

/** Body of "add to cart". */
export const cartItemInput = z.object({ variantId: id, quantity });
export type CartItemInput = z.infer<typeof cartItemInput>;

/** Body of a cart line change. Zero removes the line. */
export const cartItemUpdateInput = z.object({
  quantity: z.number().int().min(0).max(999),
});
export type CartItemUpdateInput = z.infer<typeof cartItemUpdateInput>;

// Addresses and zones -------------------------------------------------------------------

/** A shipping address. */
export const addressInput = z.object({
  name: z.string().trim().min(1).max(120),
  phone: shopPhone,
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().default(null),
  area: z.string().trim().max(120).nullable().default(null),
  city: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().max(20).nullable().default(null),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("BD"),
});
export type AddressInput = z.infer<typeof addressInput>;

/** Body of a shipping zone create or edit. */
export const shippingZoneInput = z.object({
  name: z.string().trim().min(1).max(120),
  rate: minorAmount,
  active: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
});
export type ShippingZoneInput = z.infer<typeof shippingZoneInput>;

// Checkout and orders -------------------------------------------------------------------

/** A payment method id, as `payment` names it: `cod`, `bkash`, `card`. */
const paymentMethod = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);

/** Body of `POST /shop/checkout`. Lines come from the caller's cart, never from here. */
export const checkoutInput = z
  .object({
    /** A saved address of the caller's, or a new one. */
    addressId: id.optional(),
    address: addressInput.optional(),
    saveAddress: z.boolean().default(false),
    zoneId: id,
    paymentMethod,
    note: z.string().trim().max(500).optional(),
    /** Where a hosted checkout sends the buyer back. `payment` checks its origin. */
    returnUrl: z.url().max(2000).optional(),
  })
  .refine(
    (body) => (body.addressId === undefined) !== (body.address === undefined),
    {
      message: "Send either addressId or address.",
      path: ["address"],
    }
  );
export type CheckoutInput = z.infer<typeof checkoutInput>;

/** Body of the staff "New order" page (Q33 to Q35). Line prices come from the catalog. */
export const manualOrderInput = z.object({
  phone: shopPhone,
  name: z.string().trim().min(1).max(120),
  lines: z
    .array(z.object({ variantId: id, quantity }))
    .min(1)
    .max(100),
  address: addressInput,
  zoneId: id,
  paymentMethod,
  /**
   * For a method with submit fields: the payment is already in, so confirm it at once.
   * `senderAccount` defaults to the order's phone, the usual sender of a wallet payment.
   */
  paymentReceived: z
    .object({
      transactionId: z.string().trim().min(1).max(100),
      senderAccount: z.string().trim().min(1).max(64).optional(),
    })
    .optional(),
  note: z.string().trim().max(500).optional(),
});
export type ManualOrderInput = z.infer<typeof manualOrderInput>;

/** Body of a staff status action. `restock` applies to `returned` only. */
export const orderStatusInput = z.object({
  status: z.enum([
    "confirmed",
    "shipped",
    "delivered",
    "cancelled",
    "returned",
  ]),
  note: z.string().trim().max(500).optional(),
  restock: z.boolean().default(true),
});
export type OrderStatusInput = z.infer<typeof orderStatusInput>;

/** Query of the admin order list. */
export const orderListQuery = z.object({
  page,
  status: z.enum([...ECOMMERCE_ORDER_STATUSES, "all"]).default("all"),
  cod: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuery>;

/** Body of "Pay again" on a placed order whose last payment failed (grill Q11). */
export const payAgainInput = z.object({
  /** Another method, or the order's own when left out. */
  paymentMethod: paymentMethod.optional(),
  returnUrl: z.url().max(2000).optional(),
});
export type PayAgainInput = z.infer<typeof payAgainInput>;

/** Body of a buyer's payment submission: what a manual method's fields ask for. */
export const paymentSubmitInput = z.object({
  transactionId: z.string().trim().min(1).max(100).optional(),
  senderAccount: z.string().trim().min(1).max(64).optional(),
  amount: minorAmount.optional(),
});
export type PaymentSubmitInput = z.infer<typeof paymentSubmitInput>;

/** Body of a category create. */
export const categoryInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: productSlug,
  position: z.number().int().min(0).default(0),
});
export type CategoryInput = z.infer<typeof categoryInput>;

/** Body of an image added to a product: an uploaded `file-uploads` object. */
export const productImageInput = z.object({
  storageObjectId: id,
  variantId: id.nullable().default(null),
  alt: z.string().trim().max(200).default(""),
  position: z.number().int().min(0).default(0),
});
export type ProductImageInput = z.infer<typeof productImageInput>;

/** Query of the staff customer list. `q` matches the name, the email or the phone. */
export const customerListQuery = z.object({
  page,
  q: z.string().trim().max(120).optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;

/** Query of the "New order" page's phone lookup (Q34). */
export const customerLookupQuery = z.object({ phone: shopPhone });
export type CustomerLookupQuery = z.infer<typeof customerLookupQuery>;

/** Query of the Reports screen: a preset, or a custom pair of dates, both included. */
export const reportQuery = z
  .object({
    range: z.enum(["today", "7d", "30d", "custom"]).default("7d"),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine(
    (query) =>
      query.range !== "custom" ||
      (query.from !== undefined && query.to !== undefined),
    { message: "A custom range needs from and to.", path: ["from"] }
  );
export type ReportQuery = z.infer<typeof reportQuery>;
