import { defineColumnClasses } from "../column-class";
import { customerAddresses as customerAddressesTable } from "../schema/ecommerce";

// How the production read-only role reads `customer_addresses`. See `../column-class.ts`.

export const customerAddresses = defineColumnClasses(customerAddressesTable, {
  id: "plain",
  userId: "plain",
  // The recipient's name.
  name: "pii",
  // The recipient's phone number.
  phone: "pii",
  // The street address.
  line1: "pii",
  // The street address.
  line2: "pii",
  // The area of the address.
  area: "pii",
  // The city or district of the address.
  city: "pii",
  // The postal code of the address.
  postalCode: "pii",
  country: "plain",
  zoneId: "plain",
  isDefault: "plain",
  createdAt: "plain",
  updatedAt: "plain",
});
