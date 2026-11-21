import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { storageObjects } from "./file-uploads";

// The ecommerce tables. Postgres only: the module depends on `database-postgres`, so there
// is no SQLite twin (plan 0106, "Postgres only"). Checkout locks variant rows with
// `SELECT … FOR UPDATE`, which D1 has no form of.
//
//   product_categories      a flat list of categories
//   products                draft or active; the description as Tiptap JSON and rendered HTML
//   product_options         a product's option names, such as Size and Colour
//   product_option_values   each option's values, such as S, M, L
//   product_variants        one sellable combination, with its SKU and active flag
//   product_images          file-uploads objects shown on a product, or on one variant
//   variant_prices          one price per variant and currency; a second currency is rows
//   inventory_levels        on-hand stock per variant
//   stock_reservations      stock an order holds; `expires_at` null holds until shipped
//   stock_movements         every change to on hand: shipped, restock, staff adjustment
//   carts, cart_items       a guest cart (cookie, 30 days) or a user's cart
//   shipping_zones          flat-rate zones, such as inside and outside Dhaka
//   customer_addresses      a buyer's saved addresses
//   orders                  the order, with copies of the contact, address, zone and totals
//   order_items             copies of the product title, variant title, SKU and unit price
//   order_events            every status change, by a staff member or the system
//
// Money is an integer in the currency's minor unit beside an ISO 4217 `currency`, as in
// `payment`. Prices include tax. Dates are `timestamptz`, matching `auth.ts`.
//
// Available stock is `inventory_levels.on_hand` minus the sum of the variant's
// `stock_reservations` whose `expires_at` is null or still ahead. An expired hold stops
// counting the moment it expires, with no sweep job. On hand changes only through a
// `stock_movements` row: at `shipped`, on a restock, or on a staff edit.

const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

const createdAt = () => timestamptz("created_at").notNull().defaultNow();
/**
 * For an append-only log: `clock_timestamp()`, not `now()`, so two events one transaction
 * writes still sort in the order they happened.
 */
const loggedAt = () =>
  timestamptz("created_at")
    .notNull()
    .default(sql`clock_timestamp()`);
const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** The human order number. `orders.number` takes `nextval` from it; it never repeats. */
export const orderNumbers = pgSequence("order_numbers", { startWith: 1001 });

export const productCategories = pgTable(
  "product_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("product_categories_slug_uidx").on(table.slug)]
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    /** draft | active. Active needs one or more active variants (grill Q4). */
    status: text("status").notNull().default("draft"),
    /** The description as Tiptap JSON, edited with `@repo/cms/editor`. */
    description: jsonb("description"),
    /** The description rendered once on save, as the CMS does at publish. */
    descriptionHtml: text("description_html"),
    categoryId: text("category_id").references(() => productCategories.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("products_slug_uidx").on(table.slug),
    index("products_status_idx").on(table.status, table.createdAt),
    index("products_category_id_idx").on(table.categoryId),
    check("products_status_check", sql`${table.status} in ('draft', 'active')`),
  ]
);

export const productOptions = pgTable(
  "product_options",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    uniqueIndex("product_options_product_id_name_uidx").on(
      table.productId,
      table.name
    ),
  ]
);

export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: text("id").primaryKey(),
    optionId: text("option_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    uniqueIndex("product_option_values_option_id_value_uidx").on(
      table.optionId,
      table.value
    ),
  ]
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** The option values joined for a person, such as "Red / M". Empty for a single variant. */
    title: text("title").notNull().default(""),
    sku: text("sku"),
    /** The `product_option_values` ids this variant combines, one per option. */
    optionValueIds: jsonb("option_value_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Only an active variant is for sale. Active needs a store-currency price (grill Q4). */
    active: boolean("active").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("product_variants_sku_uidx")
      .on(table.sku)
      .where(sql`${table.sku} is not null`),
    index("product_variants_product_id_idx").on(table.productId),
  ]
);

export const productImages = pgTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Set when the image shows one variant, such as the red shirt. */
    variantId: text("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),
    /** The uploaded file, served through `file-uploads`' public image route. */
    storageObjectId: text("storage_object_id")
      .notNull()
      .references(() => storageObjects.id, { onDelete: "cascade" }),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("product_images_product_id_idx").on(table.productId, table.position),
  ]
);

export const variantPrices = pgTable(
  "variant_prices",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /** ISO 4217, upper case. */
    currency: text("currency").notNull(),
    /** Minor units, tax included. */
    amount: integer("amount").notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: "variant_prices_pkey",
      columns: [table.variantId, table.currency],
    }),
    check("variant_prices_amount_check", sql`${table.amount} >= 0`),
  ]
);

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    variantId: text("variant_id")
      .primaryKey()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /** Units on the shelf. Changes only with a `stock_movements` row. */
    onHand: integer("on_hand").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("inventory_levels_on_hand_check", sql`${table.onHand} >= 0`),
  ]
);

export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** The flat rate per order, in minor units. */
    rate: integer("rate").notNull(),
    currency: text("currency").notNull(),
    /** Checkout offers active zones only. */
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("shipping_zones_position_idx").on(table.position),
    check("shipping_zones_rate_check", sql`${table.rate} >= 0`),
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    /** From the `order_numbers` sequence. Shown with `config.ecommerce.orderNumberPrefix`. */
    number: bigint("number", { mode: "number" })
      .notNull()
      .default(sql`nextval('order_numbers')`),
    /** The buyer. Every order belongs to a user; orders are kept when a user is deleted. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** placed | confirmed | shipped | delivered | cancelled | returned. */
    status: text("status").notNull().default("placed"),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    /** A copy of the address at checkout. A later edit to the saved address leaves it. */
    shippingAddress: jsonb("shipping_address").notNull(),
    /** The zone the buyer chose. `set null` keeps the order when staff delete the zone. */
    zoneId: text("zone_id").references(() => shippingZones.id, {
      onDelete: "set null",
    }),
    zoneName: text("zone_name").notNull(),
    /** The payment method the buyer chose, such as `cod` or `bkash`. The admin list tags COD. */
    paymentMethod: text("payment_method"),
    /** ISO 4217. Every amount on the order and its items is in it. */
    currency: text("currency").notNull(),
    subtotal: integer("subtotal").notNull(),
    shipping: integer("shipping").notNull(),
    total: integer("total").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("orders_number_uidx").on(table.number),
    index("orders_user_id_idx").on(table.userId, table.createdAt),
    index("orders_status_idx").on(table.status, table.createdAt),
    check(
      "orders_status_check",
      sql`${table.status} in ('placed', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned')`
    ),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** `set null` keeps the line when the product or variant is deleted; the copies stay. */
    productId: text("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    variantId: text("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title").notNull(),
    sku: text("sku"),
    /** The catalog price at checkout, in the order's currency. Never a browser value. */
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotal: integer("line_total").notNull(),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.orderId),
    index("order_items_variant_id_idx").on(table.variantId),
    check("order_items_quantity_check", sql`${table.quantity} > 0`),
  ]
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Null on the row that records the order's creation. */
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    /** staff | system. */
    actorType: text("actor_type").notNull(),
    /** The staff member. Null for a `system` event. */
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: loggedAt(),
  },
  (table) => [
    index("order_events_order_id_idx").on(table.orderId, table.createdAt),
    check(
      "order_events_actor_type_check",
      sql`${table.actorType} in ('staff', 'system')`
    ),
  ]
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    /**
     * Null holds until the order ships or is cancelled: COD, a submitted payment, a
     * successful one. A time is an unpaid online payment's hold, which lapses then.
     */
    expiresAt: timestamptz("expires_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("stock_reservations_variant_id_idx").on(
      table.variantId,
      table.expiresAt
    ),
    index("stock_reservations_order_id_idx").on(table.orderId),
    check("stock_reservations_quantity_check", sql`${table.quantity} > 0`),
  ]
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /** The order that shipped or was restocked. Null for a staff adjustment. */
    orderId: text("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    /** The change to on hand: negative when stock leaves, positive when it comes back. */
    delta: integer("delta").notNull(),
    /** shipped | restock | adjustment. */
    reason: text("reason").notNull(),
    /** The staff member. Null for a movement the system wrote. */
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: loggedAt(),
  },
  (table) => [
    index("stock_movements_variant_id_idx").on(
      table.variantId,
      table.createdAt
    ),
    index("stock_movements_order_id_idx").on(table.orderId),
  ]
);

export const carts = pgTable(
  "carts",
  {
    id: text("id").primaryKey(),
    /** Null for a guest cart, which the cookie names by `id`. One cart per user. */
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    currency: text("currency").notNull(),
    /** A guest cart's end: created plus `config.ecommerce.guestCartDays`. Null for a user's. */
    expiresAt: timestamptz("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("carts_user_id_uidx")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
  ]
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("cart_items_cart_id_variant_id_uidx").on(
      table.cartId,
      table.variantId
    ),
    check("cart_items_quantity_check", sql`${table.quantity} > 0`),
  ]
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    area: text("area"),
    city: text("city").notNull(),
    postalCode: text("postal_code"),
    /** ISO 3166-1 alpha-2. */
    country: text("country").notNull().default("BD"),
    /** The zone checkout picks first for this address. */
    zoneId: text("zone_id").references(() => shippingZones.id, {
      onDelete: "set null",
    }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("customer_addresses_user_id_idx").on(table.userId)]
);
