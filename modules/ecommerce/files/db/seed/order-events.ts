import { orderEvents as orderEventsTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. An order event needs an order, and the seed writes none.

export const orderEvents = defineSlice(orderEventsTable, { rows: {} });
