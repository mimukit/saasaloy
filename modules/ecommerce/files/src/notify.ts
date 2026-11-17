// The words an order shows a person: its number with the configured prefix, and the buyer
// SMS with its placeholders filled. The api reads the prefix and the templates from
// `config.ecommerce`; this file only applies them, so a plain `node --test` covers it.

/** The values an order SMS template may name. */
export interface OrderMessageValues {
  orderNumber: string;
  shopName: string;
}

/** `prefix` before the sequence number: `("ORD-", 1001)` is `ORD-1001`. */
export function formatOrderNumber(prefix: string, number: number): string {
  return `${prefix}${number}`;
}

/**
 * Fill `{orderNumber}` and `{shopName}` in a template, each as often as it appears. Any
 * other `{name}` stays as written, so a typo shows in the text rather than vanishing.
 */
export function fillOrderMessage(
  template: string,
  values: OrderMessageValues
): string {
  return template.replaceAll(/\{(orderNumber|shopName)\}/g, (_match, key) =>
    key === "orderNumber" ? values.orderNumber : values.shopName
  );
}
