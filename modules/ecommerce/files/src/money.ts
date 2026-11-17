import { EcommerceError } from "./errors";

// Money is an integer in the currency's minor unit beside an ISO 4217 code, the same shape
// `payment` uses. A price of 1,250.50 taka is `{ amount: 125050, currency: "BDT" }`. No
// float ever holds a price: `toMinor` parses the decimal string digit by digit, and every
// sum and product is checked against the safe integer range.

const CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** An ISO 4217 code: three upper-case letters. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && CURRENCY.test(value);
}

export function assertCurrency(value: unknown): string {
  if (!isCurrencyCode(value)) {
    throw new EcommerceError(
      "invalid_currency",
      `"${String(value)}" is not an ISO 4217 code.`
    );
  }
  return value;
}

/** Digits after the decimal point in the currency's minor unit: 2 for BDT, 0 for JPY. */
export function minorExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      currency: assertCurrency(currency),
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** An amount in minor units: a non-negative safe integer. */
export function assertMinor(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new EcommerceError(
      "invalid_amount",
      `${amount} is not a non-negative whole number of minor units.`
    );
  }
  return amount;
}

/** Parse a decimal string such as `"1250.50"` into minor units, exactly. */
export function toMinor(major: string, currency: string): number {
  const exponent = minorExponent(currency);
  const match = DECIMAL.exec(major.trim());
  const [, whole = "", fraction = ""] = match ?? [];
  if (!match || fraction.length > exponent) {
    throw new EcommerceError(
      "invalid_amount",
      `"${major}" is not an amount in ${currency} with at most ${exponent} decimals.`
    );
  }
  return assertMinor(Number(whole + fraction.padEnd(exponent, "0")));
}

/** Minor units back to a fixed decimal string: `125050` BDT is `"1250.50"`. */
export function fromMinor(amount: number, currency: string): string {
  const exponent = minorExponent(currency);
  const digits = String(assertMinor(amount)).padStart(exponent + 1, "0");
  if (exponent === 0) {
    return digits;
  }
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** Format for a person: `formatMoney(125050, "BDT")` is `"BDT 1,250.50"` in `en`. */
export function formatMoney(
  amount: number,
  currency: string,
  locale = "en"
): string {
  const exponent = minorExponent(currency);
  return new Intl.NumberFormat(locale, {
    currency,
    style: "currency",
  }).format(assertMinor(amount) / 10 ** exponent);
}

/**
 * A price for a screen: the narrow sign (`৳`, `$`) and no decimals on a whole amount,
 * `formatPrice(145000, "BDT")` is `"৳1,450"`. An amount with a fraction keeps the
 * currency's own decimals (`"৳1,450.50"`), so no figure is ever rounded away. The decimals
 * come from `minorExponent`, so any currency formats with its own minor unit.
 */
export function formatPrice(
  amount: number,
  currency: string,
  locale = "en"
): string {
  const exponent = minorExponent(currency);
  const scale = 10 ** exponent;
  const digits = assertMinor(amount) % scale === 0 ? 0 : exponent;
  return new Intl.NumberFormat(locale, {
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: "currency",
  }).format(amount / scale);
}

/** The sum of amounts in one currency's minor units. */
export function addMinor(...amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) {
    total += assertMinor(amount);
  }
  return assertMinor(total);
}

/** A unit price times a whole quantity. */
export function multiplyMinor(amount: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new EcommerceError(
      "invalid_quantity",
      `${quantity} is not a whole quantity.`
    );
  }
  return assertMinor(assertMinor(amount) * quantity);
}
