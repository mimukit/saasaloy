import { createFileRoute, useRouter } from "@tanstack/react-router";

import { siteName } from "@repo/ui";
import { SignInCard } from "@repo/ui/blocks/auth/sign-in";
import type { SignInValues } from "@repo/ui/blocks/auth/sign-in";

import { auth, forgetSession } from "@admin/lib/auth";
import { resolveDestination, toInternalPath } from "@admin/lib/redirect";

// The only route outside the shell. `__root.tsx`'s guard lets it render while anonymous and
// redirects away from it while signed in, so this file never has to check a session itself.
//
// The card is the auth module's `SignInCard`, the same block `app` renders on `/sign-in`.
// This file owns the call: it signs in on the admin instance, then hands the decision of
// where to go back to the root guard. There is deliberately no sign-up here, so the card
// gets no `signUpHref`: an admin account is created by promoting an existing user (see the
// auth module's skill), never by self-service at the backoffice door.
export const Route = createFileRoute("/login")({
  // `redirect` is where the root guard turned an anonymous visitor away from. It is raw
  // address-bar input, so it is narrowed to a path on this origin before it is ever a
  // typed search param; a hostile value is dropped here and the screen behaves as if the
  // visitor had opened /login directly.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: toInternalPath(search.redirect),
  }),
  component: LoginScreen,
});

function LoginScreen() {
  const router = useRouter();
  const search = Route.useSearch();

  async function handleSignIn({
    email,
    password,
  }: SignInValues): Promise<string | undefined> {
    try {
      // Two different failures, and only one of them arrives as a value. A rejected password
      // resolves with `{ error }`; a request that never reaches the api — down Worker, wrong
      // PUBLIC_API_URL, CORS refusal — rejects instead, because better-auth leaves the fetch
      // layer's `catchAllError` off. Without the catch below, that second case would leave
      // the visitor with nothing on screen to explain it.
      const { error } = await auth.signIn.email({ email, password });

      if (error) {
        // better-auth answers a wrong password and an unknown address with the same message on
        // purpose; repeating it verbatim keeps this screen from becoming an account oracle.
        return error.message ?? "Sign-in failed. Check the email and password.";
      }
    } catch {
      return "Could not reach the api. Check that apps/api is running on the origin PUBLIC_API_URL names (http://localhost:4000 in dev).";
    }

    // The cookie is set, so the cached session is now wrong. Drop it, re-run the root guard,
    // and let it decide where this account may go — the shell for an admin, the denied panel
    // for anyone else. This screen deliberately does not make that call.
    forgetSession();
    await router.invalidate();

    // Back to the page the guard interrupted, or / when there was none. The second gate
    // is the router's own route tree: `getMatchedRoutes` returns an undefined third
    // element for a path no route claims, so a value that survived the shape check but
    // names nothing real still lands on /. The guard runs again on arrival, so this
    // navigation grants no access on its own.
    const destination = resolveDestination(
      search.redirect,
      (pathname) => router.getMatchedRoutes(pathname)[2] !== undefined
    );
    await router.navigate({ href: destination });
  }

  // The card on the shell's canvas. Signing in swaps it for the full layout on the same
  // surface rather than changing the surface under it.
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-4">
      <SignInCard
        onSubmit={handleSignIn}
        title={`Sign in to ${siteName} admin`}
        description="Use an account with the admin role."
      />
    </main>
  );
}
