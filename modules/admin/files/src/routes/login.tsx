import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { siteName } from "@repo/ui";
import { BrandMark } from "@repo/ui/blocks/admin/brand-mark";
import { Button } from "@repo/ui/components/admin/button";
import { Field, FieldLabel } from "@repo/ui/components/admin/field";
import { Input } from "@repo/ui/components/admin/input";

import { auth, forgetSession } from "@admin/lib/auth";
import { resolveDestination, toInternalPath } from "@admin/lib/redirect";

// The only route outside the shell. `__root.tsx`'s guard lets it render while anonymous and
// redirects away from it while signed in, so this file never has to check a session itself.
//
// Email and password only, matching `emailAndPassword` in the auth module's server config.
// There is deliberately no sign-up here: an admin account is created by promoting an
// existing user (see the auth module's skill), never by self-service at the backoffice door.
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      // Two different failures, and only one of them arrives as a value. A rejected password
      // resolves with `{ error }`; a request that never reaches the api — down Worker, wrong
      // PUBLIC_API_URL, CORS refusal — rejects instead, because better-auth leaves the fetch
      // layer's `catchAllError` off. Without the catch below, that second case would leave
      // the button stuck on "Signing in…" with nothing on screen to explain it.
      const { error: signInError } = await auth.signIn.email({
        email,
        password,
      });

      if (signInError) {
        // better-auth answers a wrong password and an unknown address with the same message on
        // purpose; repeating it verbatim keeps this screen from becoming an account oracle.
        setError(
          signInError.message ?? "Sign-in failed. Check the email and password."
        );
      } else {
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
    } catch {
      setError(
        "Could not reach the api. Check that apps/api is running on the origin PUBLIC_API_URL names (http://localhost:4000 in dev)."
      );
    }

    // Not a `finally` block: the React Compiler cannot lower one, so it bails out of the
    // whole component. The `catch` above is unconditional and nothing returns early, so
    // control always reaches here.
    setPending(false);
  }

  // One card on the shell's canvas, with the brand mark the sidebar carries. Signing in
  // swaps this card for the full layout on the same surface rather than changing the
  // surface under it.
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-4">
      <div className="bg-card text-card-foreground border-border w-full max-w-sm rounded-2xl border p-6 shadow-xs/5 sm:p-7">
        <BrandMark className="mb-5" />
        <h1 className="text-lg font-semibold tracking-tight">
          Sign in to {siteName} admin
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Use an account with the admin role.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Field>
            <FieldLabel>Email</FieldLabel>
            <Input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>Password</FieldLabel>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {/* `role="alert"` announces the failure to a screen reader without moving focus,
              so the caret stays in the field the visitor is about to correct. */}
          {error ? (
            <p role="alert" className="text-destructive-foreground text-sm">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" loading={pending} className="mt-1">
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
