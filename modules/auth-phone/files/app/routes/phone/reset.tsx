import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { CodeInputCard } from "@repo/ui/blocks/auth/code-input";
import { NewPasswordCard } from "@repo/ui/blocks/auth/new-password";
import type { PhoneAlert } from "@repo/ui/blocks/auth/phone-sign-in";
import { PhoneResetCard } from "@repo/ui/blocks/auth/phone-reset";

import { auth, forgetSession } from "@app/lib/auth";
import {
  PHONE_PATHS,
  phoneAlert,
  phoneCall,
  phoneHref,
  phoneRules,
  toPhone,
  typedPhoneProblem,
  useRequestGate,
} from "@app/lib/phone-auth";
import { phoneResultText } from "@app/lib/phone-results";
import { resolveDestination, toInternalPath } from "@app/lib/redirect";

// "Set or reset your password" by phone, in three steps on one route: the number, the
// code, the new password. It sets the first password of an account that has none too.
// `auth-phone` ships this route; `AUTH_SCREENS` in `src/lib/redirect.ts` lets an anonymous
// visitor open it.
//
// The code is checked on the code step (`check-reset-code`), so a wrong code fails before
// the customer types a password. A right code stays valid for `reset-password`. Then the
// screen signs in with the new password and goes where `/phone/sign-in` would.
export const Route = createFileRoute("/phone/reset")({
  validateSearch: (
    search: Record<string, unknown>
  ): { phone?: string; reason?: string; redirect?: string } => ({
    phone: typeof search.phone === "string" ? search.phone : undefined,
    reason: search.reason === "no_password" ? "no_password" : undefined,
    redirect: toInternalPath(search.redirect),
  }),
  component: PhoneResetScreen,
});

type Step =
  | { name: "phone"; typed?: string }
  | { name: "code"; phone: string }
  | { name: "password"; phone: string; code: string };

function PhoneResetScreen() {
  const router = useRouter();
  const search = Route.useSearch();
  const gate = useRequestGate();
  const [step, setStep] = useState<Step>({
    name: "phone",
    typed: search.phone,
  });

  function sendCode(phone: string) {
    return gate.run(() =>
      phoneCall((fetchOptions) =>
        auth.phoneNumber.requestPasswordReset(
          { phoneNumber: phone },
          fetchOptions
        )
      )
    );
  }

  async function handlePhone(typed: string): Promise<PhoneAlert | undefined> {
    const phone = toPhone(typed);
    if (phone === null) {
      return typedPhoneProblem();
    }
    const failure = await sendCode(phone);
    if (failure === undefined) {
      return undefined;
    }
    if (failure !== null) {
      return phoneAlert(failure, phone, search.redirect);
    }
    gate.move();
    setStep({ name: "code", phone });
    return undefined;
  }

  async function handlePassword(
    phone: string,
    code: string,
    newPassword: string
  ): Promise<string | undefined> {
    const outcome = await gate.run(async () => {
      const reset = await phoneCall((fetchOptions) =>
        auth.phoneNumber.resetPassword(
          { phoneNumber: phone, otp: code, newPassword },
          fetchOptions
        )
      );
      if (reset !== null) {
        return { reset, signIn: null };
      }
      const signIn = await phoneCall((fetchOptions) =>
        auth.signIn.phoneNumber(
          { phoneNumber: phone, password: newPassword },
          fetchOptions
        )
      );
      return { reset: null, signIn };
    });
    if (outcome === undefined) {
      return undefined;
    }
    if (outcome.reset) {
      return phoneResultText(outcome.reset.result, outcome.reset.retryAfter);
    }
    if (outcome.signIn) {
      // The password is saved and the code is spent, so a second try here cannot work.
      // The sign-in screen takes over and shows its own answer, such as a suspended account.
      await router.navigate({
        href: phoneHref(PHONE_PATHS.signIn, {
          phone,
          redirect: search.redirect,
        }),
      });
      return undefined;
    }
    forgetSession();
    await router.invalidate();
    const destination = resolveDestination(
      search.redirect,
      (pathname) => router.getMatchedRoutes(pathname)[2] !== undefined
    );
    await router.navigate({ href: destination });
    return undefined;
  }

  if (step.name === "code") {
    const { phone } = step;
    return (
      <CodeInputCard
        sentTo={phone}
        length={phoneRules.codeLength}
        resendSeconds={phoneRules.resendSeconds}
        onSubmit={async (code): Promise<string | undefined> => {
          const failure = await gate.run(() =>
            phoneCall((fetchOptions) =>
              auth.$fetch("/phone-number/check-reset-code", {
                ...fetchOptions,
                body: { phoneNumber: phone, otp: code },
                method: "POST",
              })
            )
          );
          if (failure === undefined) {
            return undefined;
          }
          if (failure !== null) {
            return phoneResultText(failure.result, failure.retryAfter);
          }
          gate.move();
          setStep({ name: "password", phone, code });
          return undefined;
        }}
        onResend={async () => {
          const failure = await sendCode(phone);
          return failure === null || failure === undefined
            ? undefined
            : phoneResultText(failure.result, failure.retryAfter);
        }}
        onBack={() => {
          gate.move();
          setStep({ name: "phone", typed: phone });
        }}
      />
    );
  }

  if (step.name === "password") {
    const { phone, code } = step;
    return (
      <NewPasswordCard
        username={phone}
        title="Choose a new password"
        onSubmit={(newPassword) => handlePassword(phone, code, newPassword)}
        onBack={() => {
          gate.move();
          setStep({ name: "code", phone });
        }}
      />
    );
  }

  return (
    <PhoneResetCard
      key={step.typed ?? ""}
      onSubmit={handlePhone}
      signInHref={phoneHref(PHONE_PATHS.signIn, {
        phone: step.typed,
        redirect: search.redirect,
      })}
      defaultPhone={step.typed}
      defaultCountryCode={phoneRules.defaultCountryCode}
      notice={
        search.reason === "no_password"
          ? "This account has no password yet. We text you a code to set one."
          : undefined
      }
    />
  );
}
