import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { auth, forgetSession } from "@admin/lib/auth";

// The only route outside the shell. `__root.tsx`'s guard lets it render while anonymous and
// redirects away from it while signed in, so this file never has to check a session itself.
//
// Email and password only, matching `emailAndPassword` in the auth module's server config.
// There is deliberately no sign-up here: an admin account is created by promoting an
// existing user (see the auth module's skill), never by self-service at the backoffice door.
export const Route = createFileRoute("/login")({
  component: LoginScreen,
});

function LoginScreen() {
  const router = useRouter();
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
      const { error: signInError } = await auth.signIn.email({ email, password });

      if (signInError) {
        // better-auth answers a wrong password and an unknown address with the same message on
        // purpose; repeating it verbatim keeps this screen from becoming an account oracle.
        setError(signInError.message ?? "Sign-in failed. Check the email and password.");
        return;
      }

      // The cookie is set, so the cached session is now wrong. Drop it, re-run the root guard,
      // and let it decide where this account may go — the shell for an admin, the denied panel
      // for anyone else. This screen deliberately does not make that call.
      forgetSession();
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch {
      setError(
        "Could not reach the api. Check that apps/api is running on the origin PUBLIC_API_URL names (http://localhost:4000 in dev).",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>The admin app is open to admin accounts only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {/* `role="alert"` announces the failure to a screen reader without moving focus,
                so the caret stays in the field the visitor is about to correct. */}
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
