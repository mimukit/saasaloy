import { orders as ordersTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. An order comes from checkout or the New order page. The seed writes none, so the order number sequence starts at 1001 in every fresh database.

export const orders = defineSlice(ordersTable, { rows: {} });
