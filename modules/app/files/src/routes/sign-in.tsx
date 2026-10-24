import { createFileRoute, useRouter } from "@tanstack/react-router";

import { SignInCard } from "@repo/ui/blocks/auth/sign-in";
import type { SignInValues } from "@repo/ui/blocks/auth/sign-in";

import { auth, forgetSession } from "@app/lib/auth";
import { resolveDestination, toInternalPath } from "@app/lib/redirect";

// The sign-in screen. The card is the `auth` module's `SignInCard`, the block the admin
// login renders too. This file owns the call: it signs in on the client instance, then
// hands the decision of where to go to the root guard.
export const Route = createFileRoute("/sign-in")({
  // `redirect` is where the root guard turned an anonymous visitor away from. It is raw
  // address-bar input, so it is narrowed to a path on this origin before it is ever a
  // typed search param.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: toInternalPath(search.redirect),
  }),
  component: SignInScreen,
});

function SignInScreen() {
  const router = useRouter();
  const search = Route.useSearch();

  async function handleSignIn({
    email,
    password,
  }: SignInValues): Promise<string | undefined> {
    try {
      // A wrong password resolves with `{ error }`. A request that never reaches the api
      // (a stopped Worker, a wrong PUBLIC_API_URL, a CORS refusal) rejects instead, so the
      // catch turns it into a message rather than a silent card.
      const { error } = await auth.signIn.email({ email, password });
      if (error) {
        // Better Auth answers a wrong password and an unknown address with the same
        // message, so the screen never tells anyone which addresses have accounts.
        return error.message ?? "Sign-in failed. Check the email and password.";
      }
    } catch {
      return "Could not reach the api. Check that apps/api is running on the origin PUBLIC_API_URL names (http://localhost:4000 in dev).";
    }

    // The cookie is set, so the cached session is now wrong. Drop it and run the guard.
    forgetSession();
    await router.invalidate();

    // Back to the page the guard interrupted, or / when there was none or it names no
    // route. The guard runs again on arrival, so this navigation grants no access itself.
    const destination = resolveDestination(
      search.redirect,
      (pathname) => router.getMatchedRoutes(pathname)[2] !== undefined
    );
    await router.navigate({ href: destination });
    return undefined;
  }

  return <SignInCard onSubmit={handleSignIn} signUpHref="/sign-up" />;
}
