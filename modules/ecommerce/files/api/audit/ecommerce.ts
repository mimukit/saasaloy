import type { AuditActionMap } from "../lib/audit-actions";

// The ecommerce module's audit actions, one per staff write under `/admin/shop` (plan 0106,
// Q20). The descriptor's `plugin-array` patch appends `ecommerceAuditActions()` into
// `AUDIT_ACTIONS` in `../lib/audit-actions.ts`, so `saasaloy remove ecommerce` takes these
// with it, and `../routes/audit-coverage.test.ts` fails on a shop write route not named here.
//
// Each action is `ecommerce.<object>.<verb>` and every one sits in the "Shop" area. A route
// that makes several kinds of change names one action per kind: the status route carries
// confirm, ship, deliver, cancel and return, and the product status route carries publish
// and unpublish.
export function ecommerceAuditActions() {
  return {
    "ecommerce.product.create": {
      area: "shop",
      areaLabel: "Shop",
      label: "Created a product",
      route: "POST /admin/shop/products",
      target: "product",
    },
    "ecommerce.product.update": {
      area: "shop",
      label: "Edited a product",
      route: "PATCH /admin/shop/products/:id",
      target: "product",
    },
    "ecommerce.product.publish": {
      area: "shop",
      label: "Published a product",
      route: "POST /admin/shop/products/:id/status",
      target: "product",
    },
    "ecommerce.product.unpublish": {
      area: "shop",
      label: "Unpublished a product",
      route: "POST /admin/shop/products/:id/status",
      target: "product",
    },
    "ecommerce.product.delete": {
      area: "shop",
      label: "Deleted a product",
      route: "DELETE /admin/shop/products/:id",
      target: "product",
    },
    "ecommerce.product.options": {
      area: "shop",
      label: "Changed a product's options and variants",
      route: "PUT /admin/shop/products/:id/options",
      target: "product",
    },
    "ecommerce.variant.update": {
      area: "shop",
      label: "Edited a variant",
      route: "PUT /admin/shop/variants/:id",
      target: "variant",
    },
    "ecommerce.stock.adjust": {
      area: "shop",
      label: "Changed stock",
      route: "POST /admin/shop/variants/:id/stock",
      target: "variant",
    },
    "ecommerce.image.create": {
      area: "shop",
      label: "Added a product image",
      route: "POST /admin/shop/products/:id/images",
      target: "product",
    },
    "ecommerce.image.delete": {
      area: "shop",
      label: "Removed a product image",
      route: "DELETE /admin/shop/images/:id",
      target: "product",
    },
    "ecommerce.category.create": {
      area: "shop",
      label: "Created a category",
      route: "POST /admin/shop/categories",
      target: "category",
    },
    "ecommerce.order.create": {
      area: "shop",
      label: "Created an order",
      route: "POST /admin/shop/orders",
      target: "order",
    },
    "ecommerce.order.confirm": {
      area: "shop",
      label: "Confirmed an order",
      route: "POST /admin/shop/orders/:id/status",
      target: "order",
    },
    "ecommerce.order.ship": {
      area: "shop",
      label: "Marked an order shipped",
      route: "POST /admin/shop/orders/:id/status",
      target: "order",
    },
    "ecommerce.order.deliver": {
      area: "shop",
      label: "Marked an order delivered",
      route: "POST /admin/shop/orders/:id/status",
      target: "order",
    },
    "ecommerce.order.cancel": {
      area: "shop",
      label: "Cancelled an order",
      route: "POST /admin/shop/orders/:id/status",
      target: "order",
    },
    "ecommerce.order.return": {
      area: "shop",
      label: "Marked an order returned",
      route: "POST /admin/shop/orders/:id/status",
      target: "order",
    },
    "ecommerce.order.restock": {
      area: "shop",
      label: "Restocked a returned order",
      route: "POST /admin/shop/orders/:id/restock",
      target: "order",
    },
    "ecommerce.zone.create": {
      area: "shop",
      label: "Added a shipping zone",
      route: "POST /admin/shop/zones",
      target: "zone",
    },
    "ecommerce.zone.update": {
      area: "shop",
      label: "Edited a shipping zone",
      route: "PATCH /admin/shop/zones/:id",
      target: "zone",
    },
    "ecommerce.zone.delete": {
      area: "shop",
      label: "Deleted a shipping zone",
      route: "DELETE /admin/shop/zones/:id",
      target: "zone",
    },
  } as const satisfies AuditActionMap;
}
