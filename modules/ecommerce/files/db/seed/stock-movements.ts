import { stockMovements as stockMovementsTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. A movement records a shipment, a restock or a staff edit, and the seed has none.

export const stockMovements = defineSlice(stockMovementsTable, { rows: {} });
