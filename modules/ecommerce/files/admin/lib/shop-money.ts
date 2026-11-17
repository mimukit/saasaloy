import { formatPrice } from "@repo/ecommerce";

import { SHOP_LOCALE } from "@admin/lib/shop-dates";

// Every amount the shop screens show: the narrow sign and no decimals on a whole amount
// ("৳1,450"), the currency's own decimals otherwise. `formatPrice` in `@repo/ecommerce`
// holds the rule and its tests, so the admin app and the storefront show one format.

/** An amount in minor units for a person, in the project's locale. */
export function money(
  amount: number,
  currency: string,
  locale: string = SHOP_LOCALE
): string {
  return formatPrice(amount, currency, locale);
}
