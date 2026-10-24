import { createFileRoute, useRouter } from "@tanstack/react-router";

import { SignUpCard } from "@repo/ui/blocks/auth/sign-up";
import type { SignUpValues } from "@repo/ui/blocks/auth/sign-up";

import { auth, forgetSession } from "@app/lib/auth";

// The sign-up screen. The card is the `auth` module's `SignUpCard`. A new account lands on
// the home screen, never on a `redirect` target: a first visit has nothing to return to.
//
// Better Auth signs the new account in as it creates it, so no second sign-in call is
// needed. The password rule (12 characters) is the server's `minPasswordLength`; the card
// checks the same number in the browser.
export const Route = createFileRoute("/sign-up")({
  component: SignUpScreen,
});

function SignUpScreen() {
  const router = useRouter();

  async function handleSignUp({
    name,
    email,
    password,
  }: SignUpValues): Promise<string | undefined> {
    try {
      const { error } = await auth.signUp.email({ name, email, password });
      if (error) {
        return (
          error.message ?? "Sign-up failed. Check the details and try again."
        );
      }
    } catch {
      return "Could not reach the api. Check that apps/api is running on the origin PUBLIC_API_URL names (http://localhost:4000 in dev).";
    }

    forgetSession();
    await router.invalidate();
    await router.navigate({ to: "/" });
    return undefined;
  }

  return <SignUpCard onSubmit={handleSignUp} signInHref="/sign-in" />;
}
