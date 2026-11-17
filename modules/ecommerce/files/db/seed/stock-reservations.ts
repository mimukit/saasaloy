import { stockReservations as stockReservationsTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. An order holds stock, and the seed writes no order.

export const stockReservations = defineSlice(stockReservationsTable, {
  rows: {},
});
