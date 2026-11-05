import { createFileRoute, useRouter } from "@tanstack/react-router";

import { PhoneSignInCard } from "@repo/ui/blocks/auth/phone-sign-in";
import type {
  PhoneAlert,
  PhoneSignInValues,
} from "@repo/ui/blocks/auth/phone-sign-in";

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
import { resolveDestination, toInternalPath } from "@app/lib/redirect";

// Sign-in by phone and password. `auth-phone` ships this route; `AUTH_SCREENS` in
// `src/lib/redirect.ts` lets an anonymous visitor open it. It follows `/sign-in`: the
// call, then `forgetSession()`, then the root guard decides where to go, and `redirect`
// goes through `resolveDestination()`.
//
// The api tells the answers apart, so each gets its own alert: no account (with a link to
// sign-up), no password (with a link to the reset that keeps the number), suspended, too
// many tries (with the wait), and Better Auth's one answer for a wrong password.
export const Route = createFileRoute("/phone/sign-in")({
  validateSearch: (
    search: Record<string, unknown>
  ): { redirect?: string; phone?: string } => ({
    redirect: toInternalPath(search.redirect),
    phone: typeof search.phone === "string" ? search.phone : undefined,
  }),
  component: PhoneSignInScreen,
});

function PhoneSignInScreen() {
  const router = useRouter();
  const search = Route.useSearch();
  const gate = useRequestGate();

  async function handleSignIn({
    phone: typed,
    password,
  }: PhoneSignInValues): Promise<PhoneAlert | undefined> {
    const phone = toPhone(typed);
    if (phone === null) {
      return typedPhoneProblem();
    }
    const failure = await gate.run(() =>
      phoneCall((fetchOptions) =>
        auth.signIn.phoneNumber({ phoneNumber: phone, password }, fetchOptions)
      )
    );
    if (failure === undefined) {
      return undefined;
    }
    if (failure !== null) {
      return phoneAlert(failure, phone, search.redirect);
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

  return (
    <PhoneSignInCard
      onSubmit={handleSignIn}
      signUpHref={PHONE_PATHS.signUp}
      resetHref={(typed) =>
        phoneHref(PHONE_PATHS.reset, {
          phone: typed.trim(),
          redirect: search.redirect,
        })
      }
      defaultPhone={search.phone}
      defaultCountryCode={phoneRules.defaultCountryCode}
    />
  );
}
