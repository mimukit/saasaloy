import { accounts as accountsTable } from "../../schema/auth";
import { seedId } from "../id";
import { defineSlice } from "../slice";

// One email-and-password account for each seed user in `./users.ts`.
//
// The password is `saasaloy-dev-password` for every one of them. It is stored the way Better
// Auth stores it (scrypt, `salt:key` in hex), precomputed so the seed never loads Better
// Auth. It is a development password: never seed a database anyone else can reach.

const DEV_PASSWORD = "saasaloy-dev-password";

const DEV_PASSWORD_HASH =
  "e16c549d3561c681928e9d911d68d09b:8db6ed8e7e1349c09b704431774f5d545d607fdc8cbb619cabb89fe0f677a1dcdd033d943e01746f8a134d41b36db8660516db782fac24b486ef311faac2dd3b";

function credential(user: string) {
  const userId = seedId("users", user);
  return {
    accountId: userId,
    password: DEV_PASSWORD_HASH,
    providerId: "credential",
    userId,
  };
}

export const accounts = defineSlice(accountsTable, {
  message: `Every seeded user signs in with the password "${DEV_PASSWORD}": superadmin@example.test, admin@example.test, member@example.test and banned@example.test (refused, it is banned).`,
  rows: {
    admin: credential("admin"),
    banned: credential("banned"),
    member: credential("member"),
    superadmin: credential("superadmin"),
  },
});
