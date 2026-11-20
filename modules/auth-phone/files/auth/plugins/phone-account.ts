import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { config } from "@repo/config";
import {
  PHONE_RESET_CHECK_PATH,
  PHONE_RESET_PATH,
  PHONE_SEND_PATH,
  PHONE_SET_PASSWORD_PATH,
  PHONE_VERIFY_PATH,
} from "../phone";

// The rules that make the phone code a sign-up step and not a second way to sign in. It
// sits on `auth` after `phoneNumberPlugin()`, through a row of the same `auth.plugins`
// table.
//
// - A sign-up code (`send-otp`) and its check (`verify`) answer 409 `PHONE_NUMBER_EXIST`
//   for a number that already has an account, before a code goes out or a session opens.
//   That customer signs in with the password, or sets one through the reset endpoints. A
//   `verify` that adds a number to the signed-in account (`updatePhoneNumber`) passes.
// - Code sign-in: with `codeSignIn` on, a `send-otp` and a `verify` that carry
//   `signIn: true` pass for a known number, so `verify` opens a session on that account.
//   The flag keeps the app's sign-up screen as it was: it sends no flag, so a known number
//   still gets the 409 there. A banned account gets 403 `BANNED_USER` before a code goes
//   out; Better Auth's `admin()` session hook answers the same if a ban lands between the
//   send and the check. This reaches no account a reset code does not already reach: both
//   send a code to the number and act on the account that owns it.
// - `check-reset-code` checks a reset code before the customer types a new password, so a
//   wrong code fails on the code screen. It keeps a right code for `reset-password` and
//   spends one of the same tries on a wrong one, so it adds no extra guesses.
// - A password set with a reset code marks the phone verified, because the code went to it.
// - `set-password` gives a signed-in account its first password: the sign-up step after
//   `verify`, which opens a session on an account with no password. Better Auth's own
//   `setPassword` is server-only, so the browser has no other way to it. An account that
//   has a password already gets 409 `PASSWORD_ALREADY_SET`, and changes it with the
//   current one on `/change-password` or with a code on the reset endpoints.
//
// A phone sign-up gets role `user`, the `admin()` plugin's default, even on an empty
// table. `auth.ts` has no hook that writes a role, so nothing here has to keep one off.

/** The `phoneNumber` field of a request body, or `null`. */
function phoneOf(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "phoneNumber" in body &&
    typeof body.phoneNumber === "string"
  ) {
    return body.phoneNumber;
  }
  return null;
}

/** Whether the body asks for a code sign-in (`signIn: true`). */
function asksForSignIn(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "signIn" in body &&
    body.signIn === true
  );
}

/** Whether a user row carries a ban that still holds, read as `admin()` reads it. */
function isBanned(user: {
  banned?: boolean | null;
  banExpires?: Date | string | null;
}): boolean {
  if (user.banned !== true) {
    return false;
  }
  return !user.banExpires || new Date(user.banExpires).getTime() >= Date.now();
}

function addsNumberToSession(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "updatePhoneNumber" in body &&
    body.updatePhoneNumber === true
  );
}

/** The `phoneNumber` and `otp` strings of a check body, or `null`. */
function resetCheckOf(body: unknown): { phone: string; otp: string } | null {
  const phone = phoneOf(body);
  if (
    phone === null ||
    typeof body !== "object" ||
    body === null ||
    !("otp" in body) ||
    typeof body.otp !== "string"
  ) {
    return null;
  }
  return { phone, otp: body.otp };
}

/** The tries a stored `<code>:<tries>` value has spent, read as the plugin reads it. */
function triesOf(value: string | undefined): number {
  const tries = Number(value ?? 0);
  return Number.isSafeInteger(tries) && tries > 0 ? tries : 0;
}

// The plugin's own code check in better-auth 1.7.7 (`verifyPhoneNumberOTP`), with one
// change: a right code stays in place for `reset-password`.
const checkResetCode = createAuthEndpoint(
  PHONE_RESET_CHECK_PATH,
  { method: "POST" },
  async (context) => {
    const check = resetCheckOf(context.body);
    if (check === null) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_BODY",
        message: "Send phoneNumber and otp.",
      });
    }
    const identifier = `${check.phone}-request-password-reset`;
    const adapter = context.context.internalAdapter;
    const stored = await adapter.findVerificationValue(identifier);
    if (!stored) {
      throw APIError.from("BAD_REQUEST", {
        code: "OTP_NOT_FOUND",
        message: "No code was sent to this number.",
      });
    }
    if (stored.expiresAt < new Date()) {
      await adapter.deleteVerificationByIdentifier(identifier);
      throw APIError.from("BAD_REQUEST", {
        code: "OTP_EXPIRED",
        message: "The code has expired.",
      });
    }
    const [code, tries] = stored.value.split(":");
    if (triesOf(tries) >= config["auth-phone"].codeAttempts) {
      await adapter.deleteVerificationByIdentifier(identifier);
      throw APIError.from("FORBIDDEN", {
        code: "TOO_MANY_ATTEMPTS",
        message: "Too many wrong codes. Ask for a new one.",
      });
    }
    if (code === check.otp) {
      return context.json({ status: true });
    }
    // Consuming the row is the race gate, as in the plugin: two wrong guesses at once
    // cannot both write the old count back.
    const consumed = await adapter.consumeVerificationValue(identifier);
    if (consumed) {
      const [kept, spent] = consumed.value.split(":");
      await adapter.createVerificationValue({
        expiresAt: consumed.expiresAt,
        identifier,
        value: `${kept ?? ""}:${String(triesOf(spent) + 1)}`,
      });
    }
    throw APIError.from("BAD_REQUEST", {
      code: "INVALID_OTP",
      message: "The code is wrong.",
    });
  }
);

/** The `newPassword` string of a set body, or `null`. */
function newPasswordOf(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "newPassword" in body &&
    typeof body.newPassword === "string"
  ) {
    return body.newPassword;
  }
  return null;
}

// `setPassword` from better-auth 1.7.7 (`api/routes/update-user`), reachable from the
// browser and with a 409 for a password that is already set. `sensitiveSessionMiddleware`
// asks for a fresh session, as Better Auth's own does, so a stolen old cookie cannot
// put a password on an account.
const setFirstPassword = createAuthEndpoint(
  PHONE_SET_PASSWORD_PATH,
  { method: "POST", use: [sensitiveSessionMiddleware] },
  async (context) => {
    const newPassword = newPasswordOf(context.body);
    if (newPassword === null) {
      throw APIError.from("BAD_REQUEST", {
        code: "INVALID_BODY",
        message: "Send newPassword.",
      });
    }
    const { minPasswordLength, maxPasswordLength } =
      context.context.password.config;
    if (newPassword.length < minPasswordLength) {
      throw APIError.from("BAD_REQUEST", {
        code: "PASSWORD_TOO_SHORT",
        message: `Use at least ${String(minPasswordLength)} characters.`,
      });
    }
    if (newPassword.length > maxPasswordLength) {
      throw APIError.from("BAD_REQUEST", {
        code: "PASSWORD_TOO_LONG",
        message: `Use ${String(maxPasswordLength)} characters or fewer.`,
      });
    }
    const userId = context.context.session.user.id;
    const adapter = context.context.internalAdapter;
    const account = await adapter.findCredentialAccount(userId);
    if (account?.password) {
      throw APIError.from("CONFLICT", {
        code: "PASSWORD_ALREADY_SET",
        message: "This account has a password already.",
      });
    }
    const hash = await context.context.password.hash(newPassword);
    await (account
      ? adapter.updateAccount(account.id, { password: hash })
      : adapter.linkAccount({
          accountId: userId,
          password: hash,
          providerId: "credential",
          userId,
        }));
    return context.json({ status: true });
  }
);

export function phoneAccount() {
  return {
    id: "phone-account",
    endpoints: { checkResetCode, setFirstPassword },
    hooks: {
      before: [
        {
          matcher: (context) =>
            (context.path === PHONE_SEND_PATH ||
              context.path === PHONE_VERIFY_PATH) &&
            !addsNumberToSession(context.body),
          handler: createAuthMiddleware(async (context) => {
            const phone = phoneOf(context.body);
            if (phone === null) {
              return;
            }
            const user = await context.context.adapter.findOne<{
              banned?: boolean | null;
              banExpires?: Date | string | null;
            }>({
              model: "user",
              where: [{ field: "phoneNumber", value: phone }],
            });
            if (!user) {
              return;
            }
            if (
              config["auth-phone"].codeSignIn &&
              asksForSignIn(context.body)
            ) {
              if (isBanned(user)) {
                throw APIError.from("FORBIDDEN", {
                  code: "BANNED_USER",
                  message: "You have been banned from this application",
                });
              }
              return;
            }
            throw APIError.from("CONFLICT", {
              code: "PHONE_NUMBER_EXIST",
              message:
                "This number already has an account. Sign in with the password, or set a new one.",
            });
          }),
        },
      ],
      after: [
        {
          matcher: (context) => context.path === PHONE_RESET_PATH,
          handler: createAuthMiddleware(async (context) => {
            if (context.context.returned instanceof APIError) {
              return;
            }
            const phone = phoneOf(context.body);
            if (phone === null) {
              return;
            }
            const user = await context.context.adapter.findOne<{
              id: string;
              phoneNumberVerified?: boolean | null;
            }>({
              model: "user",
              where: [{ field: "phoneNumber", value: phone }],
            });
            if (user && user.phoneNumberVerified !== true) {
              await context.context.internalAdapter.updateUser(user.id, {
                phoneNumberVerified: true,
              });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
