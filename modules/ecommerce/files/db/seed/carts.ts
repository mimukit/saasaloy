import { carts as cartsTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. A cart belongs to a browser or a signed-in buyer, and the seed has neither.

export const carts = defineSlice(cartsTable, { rows: {} });
