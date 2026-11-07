import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { CodeInputCard } from "@repo/ui/blocks/auth/code-input";
import { NewPasswordCard } from "@repo/ui/blocks/auth/new-password";
import type { PhoneAlert } from "@repo/ui/blocks/auth/phone-sign-in";
import { PhoneSignUpCard } from "@repo/ui/blocks/auth/phone-sign-up";

import { auth, forgetSession } from "@app/lib/auth";
import {
  PHONE_PATHS,
  phoneAlert,
  phoneCall,
  phoneRules,
  toPhone,
  typedPhoneProblem,
  useRequestGate,
} from "@app/lib/phone-auth";
import { phoneResultText } from "@app/lib/phone-results";

// Sign-up by phone, in three steps on one route: the number, the code, the first password.
// `auth-phone` ships this route; `AUTH_SCREENS` in `src/lib/redirect.ts` lets an anonymous
// visitor open it.
//
// `verify` creates the account and opens a session, and the account has no password yet.
// The screen does not tell the router about that session until the password is saved: the
// root guard sends a signed-in visitor off this path, so a session check run in between
// would replace the password step with the home screen. The cached session stays as it
// was until `forgetSession()` at the end. A new account lands on `/`, as on `/sign-up`.
export const Route = createFileRoute("/phone/sign-up")({
  validateSearch: (search: Record<string, unknown>): { phone?: string } => ({
    phone: typeof search.phone === "string" ? search.phone : undefined,
  }),
  component: PhoneSignUpScreen,
});

type Step =
  | { name: "phone"; typed?: string }
  | { name: "code"; phone: string }
  | { name: "password"; phone: string };

function PhoneSignUpScreen() {
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
        auth.phoneNumber.sendOtp({ phoneNumber: phone }, fetchOptions)
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
      return phoneAlert(failure, phone);
    }
    gate.move();
    setStep({ name: "code", phone });
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
              auth.phoneNumber.verify(
                { phoneNumber: phone, code },
                fetchOptions
              )
            )
          );
          if (failure === undefined) {
            return undefined;
          }
          if (failure !== null) {
            return phoneResultText(failure.result, failure.retryAfter);
          }
          gate.move();
          setStep({ name: "password", phone });
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
    return (
      <NewPasswordCard
        username={step.phone}
        description="Your number is checked. From now on you sign in with it and this password."
        onSubmit={async (newPassword): Promise<string | undefined> => {
          const failure = await gate.run(() =>
            phoneCall((fetchOptions) =>
              auth.$fetch("/phone-number/set-password", {
                ...fetchOptions,
                body: { newPassword },
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
          forgetSession();
          await router.invalidate();
          await router.navigate({ to: "/" });
          return undefined;
        }}
      />
    );
  }

  return (
    <PhoneSignUpCard
      // Keyed on the number, so "Change number" opens the field with it.
      key={step.typed ?? ""}
      onSubmit={handlePhone}
      signInHref={PHONE_PATHS.signIn}
      defaultPhone={step.typed}
      defaultCountryCode={phoneRules.defaultCountryCode}
    />
  );
}
