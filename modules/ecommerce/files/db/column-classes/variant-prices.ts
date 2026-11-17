import { defineColumnClasses } from "../column-class";
import { variantPrices as variantPricesTable } from "../schema/ecommerce";

// How the production read-only role reads `variant_prices`. See `../column-class.ts`.

export const variantPrices = defineColumnClasses(variantPricesTable, {
  variantId: "plain",
  currency: "plain",
  amount: "plain",
  updatedAt: "plain",
});
