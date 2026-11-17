import { cartItems as cartItemsTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. A cart line needs a cart, and the seed writes none.

export const cartItems = defineSlice(cartItemsTable, { rows: {} });
