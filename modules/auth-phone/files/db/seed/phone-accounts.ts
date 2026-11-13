import type { users as usersTable } from "../schema/auth";
import { seedId } from "./id";
import type { SliceOptions } from "./slice";
import type { ExtraAccounts } from "./slices/accounts";

// `auth-phone`'s seed rows. They join `auth`'s `users` and `accounts` slices through the
// `extraUsers` and `extraAccounts` patch points there, because the seed takes one slice
// per table. Two phone accounts, one for each way the sign-in screens treat a number:
//
// - `+12025550101` signs in with the dev password.
// - `+12025550102` has no password and a phone not yet proven, as an account an admin
//   opened would. Sign-in sends it to "Set or reset your password".
//
// Both numbers are in the 555-0100 to 555-0199 range set aside for fiction, so no real
// handset gets a seeded code.

const DEV_PASSWORD = "saasaloy-dev-password";

// The scrypt hash of `DEV_PASSWORD`, the same value `./slices/accounts.ts` stores. A
// copy, because that file imports this one and a cycle would leave it undefined here.
const DEV_PASSWORD_HASH =
  "e16c549d3561c681928e9d911d68d09b:8db6ed8e7e1349c09b704431774f5d545d607fdc8cbb619cabb89fe0f677a1dcdd033d943e01746f8a134d41b36db8660516db782fac24b486ef311faac2dd3b";

export const PHONE_WITH_PASSWORD = "+12025550101";
export const PHONE_WITHOUT_PASSWORD = "+12025550102";

type UserRows = SliceOptions<typeof usersTable>["rows"];

function phoneUser(phone: string, verified: boolean) {
  return {
    email: `${phone.slice(1)}@phone.invalid`,
    emailVerified: false,
    name: phone,
    phoneNumber: phone,
    phoneNumberVerified: verified,
    role: "user",
  };
}

/** The two phone users, for `extraUsers` in `./slices/users.ts`. */
export function phoneUsers(): UserRows {
  return {
    "phone-member": phoneUser(PHONE_WITH_PASSWORD, true),
    "phone-no-password": phoneUser(PHONE_WITHOUT_PASSWORD, false),
  };
}

/** The one password account, for `extraAccounts` in `./slices/accounts.ts`. */
export function phoneAccounts(): ExtraAccounts {
  const userId = seedId("users", "phone-member");
  return {
    message: `Phone sign-in: ${PHONE_WITH_PASSWORD} signs in with "${DEV_PASSWORD}". ${PHONE_WITHOUT_PASSWORD} has no password and sets one with the reset code the api log prints.`,
    rows: {
      "phone-member": {
        accountId: userId,
        password: DEV_PASSWORD_HASH,
        providerId: "credential",
        userId,
      },
    },
  };
}
