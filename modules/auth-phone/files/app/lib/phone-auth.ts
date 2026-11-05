import { useRef } from "react";

import { toE164 } from "@repo/auth/phone-rules";
import { config } from "@repo/config";
import type { PhoneAlert } from "@repo/ui/blocks/auth/phone-sign-in";

import {
  phoneResultOf,
  phoneResultText,
  retryAfterSeconds,
} from "@app/lib/phone-results";
import type { PhoneResult } from "@app/lib/phone-results";

// What the three phone routes under `src/routes/phone/` share: the number rule, one
// wrapper for a client call, the alert for each answer, and the gate that runs one request
// at a time. `auth-phone` ships this file with the routes.

/** The `auth-phone` config section: code length, resend wait, country code. */
export const phoneRules = config["auth-phone"];

/** The paths of the three phone screens. `AUTH_SCREENS` in `./redirect.ts` lists them. */
export const PHONE_PATHS = {
  reset: "/phone/reset",
  signIn: "/phone/sign-in",
  signUp: "/phone/sign-up",
} as const;

/** The typed number as E.164, by the same rule the server checks, or `null`. */
export function toPhone(typed: string): string | null {
  return toE164(typed, phoneRules.defaultCountryCode);
}

/** The message for a number `toPhone()` refused. */
export function typedPhoneProblem(): string {
  return phoneRules.defaultCountryCode === undefined
    ? "Enter the number with + and the country code."
    : `Enter the number with 0 or with ${phoneRules.defaultCountryCode} in front.`;
}

/** A failed call: what it answered and the wait a 429 named. */
export interface PhoneFailure {
  result: PhoneResult;
  retryAfter: number | null;
}

/** The hook a client call takes in its fetch options, to read `Retry-After`. */
export interface PhoneFetchOptions {
  onError: (context: { response: Response }) => void;
}

/**
 * Run one Better Auth client call. Resolves to `null` on success, or to the failure. A
 * request that never reached the api (a stopped Worker, a CORS refusal) resolves to
 * `unreachable`, so a screen never stays silent.
 */
export async function phoneCall(
  call: (options: PhoneFetchOptions) => Promise<{ error: unknown }>
): Promise<PhoneFailure | null> {
  let retryAfter: number | null = null;
  try {
    const { error } = await call({
      onError: ({ response }) => {
        retryAfter = retryAfterSeconds(response.headers.get("Retry-After"));
      },
    });
    if (error === null || error === undefined) {
      return null;
    }
    return { result: phoneResultOf(error), retryAfter };
  } catch {
    return { result: "unreachable", retryAfter: null };
  }
}

/** A phone screen's address, with the number, the reason and the return path it carries. */
export function phoneHref(
  path: string,
  search: { phone?: string; reason?: string; redirect?: string }
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}

/**
 * The alert for a failure on `phone`. Three answers carry a link that keeps the number:
 * no account opens sign-up, no password opens the reset, a known number opens sign-in.
 */
export function phoneAlert(
  failure: PhoneFailure,
  phone: string,
  redirect?: string
): PhoneAlert {
  const message = phoneResultText(failure.result, failure.retryAfter);
  if (failure.result === "no_account") {
    return {
      message,
      link: {
        label: "Create an account",
        href: phoneHref(PHONE_PATHS.signUp, { phone }),
      },
    };
  }
  if (failure.result === "no_password") {
    return {
      message,
      link: {
        label: "Set a password",
        href: phoneHref(PHONE_PATHS.reset, {
          phone,
          reason: "no_password",
          redirect,
        }),
      },
    };
  }
  if (failure.result === "exists") {
    return {
      message,
      link: {
        label: "Sign in",
        href: phoneHref(PHONE_PATHS.signIn, { phone }),
      },
    };
  }
  return message;
}

/**
 * One request at a time, and no late answer after the screen moved on. `run()` refuses a
 * second task while one is in flight, and resolves to `undefined` when `move()` ran
 * during the task: the customer took another step, and the old answer must not replace
 * it. Call `move()` on every step change the customer makes.
 */
export function useRequestGate() {
  const busy = useRef(false);
  const revision = useRef(0);

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (busy.current) {
      return undefined;
    }
    busy.current = true;
    const request = ++revision.current;
    let value: T;
    try {
      value = await task();
    } catch (error) {
      // After a `move()` the gate may belong to a newer task already.
      if (request === revision.current) {
        busy.current = false;
      }
      throw error;
    }
    if (request !== revision.current) {
      return undefined;
    }
    busy.current = false;
    return value;
  }

  function move(): void {
    revision.current += 1;
    busy.current = false;
  }

  return { run, move };
}
