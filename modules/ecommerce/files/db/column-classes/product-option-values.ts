import { defineColumnClasses } from "../column-class";
import { productOptionValues as productOptionValuesTable } from "../schema/ecommerce";

// How the production read-only role reads `product_option_values`. See `../column-class.ts`.

export const productOptionValues = defineColumnClasses(
  productOptionValuesTable,
  {
    id: "plain",
    optionId: "plain",
    value: "plain",
    position: "plain",
  }
);
