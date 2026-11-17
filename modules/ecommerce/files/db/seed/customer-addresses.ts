import { customerAddresses as customerAddressesTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// Empty on purpose. A buyer saves an address at checkout.

export const customerAddresses = defineSlice(customerAddressesTable, {
  rows: {},
});
