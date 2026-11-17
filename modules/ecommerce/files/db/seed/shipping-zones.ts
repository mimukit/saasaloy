import { shippingZones as shippingZonesTable } from "../../schema/ecommerce";
import { defineSlice } from "../slice";

// The two flat-rate zones a Bangladesh shop starts with, in poisha.

export const shippingZones = defineSlice(shippingZonesTable, {
  rows: {
    "inside-dhaka": {
      currency: "BDT",
      name: "Inside Dhaka",
      position: 0,
      rate: 6000,
    },
    "outside-dhaka": {
      currency: "BDT",
      name: "Outside Dhaka",
      position: 1,
      rate: 12_000,
    },
  },
});
