import { defineSection } from "@repo/config/define";

// `auth-phone`'s config section. Read it as `config["auth-phone"]`: the key is the module
// name, and a hyphen in a key needs the bracket form.
//
// These are `config` values, not `env` values: two deployments of one project send the
// same code to the same numbers. Change any of them in `packages/config/src/project.ts`.

/** The `auth-phone` section: the code, its limits, and which numbers may sign in. */
export function authPhoneConfig() {
  return defineSection("auth-phone", {
    /** Digits in a sign-in or reset code. */
    codeLength: 6,
    /** How long a code stays valid, in seconds. The SMS says it in minutes. */
    codeTtlSeconds: 300,
    /** Wrong tries allowed before the code is thrown away and a new one must be sent. */
    codeAttempts: 3,
    /** The wait before a second code to one number, in seconds. */
    resendSeconds: 60,
    /** Codes one number may get in an hour, sign-up and reset together. */
    codesPerHour: 5,
    /**
     * E.164 prefixes the server takes, such as `["+880"]`. Empty allows every E.164
     * number. The list is replaced whole by an override.
     */
    allowedPrefixes: [] as readonly string[],
    /**
     * The country code a screen puts in place of a leading `0`, such as `"+880"`. Unset,
     * the screen asks for a number that starts with `+`.
     */
    defaultCountryCode: undefined as string | undefined,
  });
}
