import { defineSection } from "@repo/config/define";

// `ecommerce`'s config section, installed by `saasaloy add ecommerce` into
// `packages/config/src/sections/`. These are `config` values, not `env` values: two
// deployments of one shop sell in the same currency, under the same name, with the same
// hold lifetimes (ADR 0052). Override any key in `packages/config/src/project.ts`.
//
// The keys are flat on purpose. `project.ts` overrides one leaf below the section, so each
// value here can be changed alone.

/** The `ecommerce` section: the store, its holds, and the buyer SMS. */
export function ecommerceConfig() {
  return defineSection("ecommerce", {
    /** The store currency, ISO 4217. A variant needs a price in it before it can be active. */
    currency: "BDT" as string,
    /** The shop's name, in the page titles and the `{shopName}` placeholder of each SMS. */
    shopName: "Shop" as string,
    /** The storefront's URL prefix on `apps/web`. A product lives at `<basePath>/<slug>`. */
    basePath: "/shop" as string,
    /** Products per page in the catalog and the public list route. */
    pageSize: 24,
    /**
     * Whether a buyer signed in on a verified email must still verify a phone by OTP at
     * checkout. A buyer with a verified phone never repeats it.
     */
    requirePhoneOtp: false as boolean,
    /** How long an unpaid online-payment order holds its stock, in hours. */
    unpaidHoldHours: 24,
    /** How long a guest cart lives on its cookie, in days. */
    guestCartDays: 30,
    /** Available stock at or below this shows the low-stock tone in the admin. */
    lowStockThreshold: 5,
    /**
     * The IANA time zone a report day starts in, such as `Asia/Dhaka`. "Today" in the
     * Reports screen is today here, not in UTC.
     */
    timeZone: "Asia/Dhaka" as string,
    /** Put before the sequence number: prefix `"ORD-"` makes order `ORD-1001`. */
    orderNumberPrefix: "ORD-" as string,
    /** Send the buyer an SMS when the order moves to `confirmed`. */
    notifyOnConfirmed: true as boolean,
    /** Send the buyer an SMS when the order moves to `shipped`. */
    notifyOnShipped: true as boolean,
    /** The `confirmed` SMS. `{orderNumber}` and `{shopName}` are filled in. */
    confirmedMessage:
      "{shopName}: your order {orderNumber} is confirmed. We will text you when it ships." as string,
    /** The `shipped` SMS. `{orderNumber}` and `{shopName}` are filled in. */
    shippedMessage:
      "{shopName}: your order {orderNumber} is on its way." as string,
  });
}
