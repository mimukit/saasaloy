import { orderItems as orderItemsTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. An order line needs an order, and the seed writes none.

export const orderItems = defineSlice(orderItemsTable, { rows: {} });
