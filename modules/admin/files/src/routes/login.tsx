import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { AuthCard } from "../components/auth-card";
import { safeRedirect, signIn } from "../lib/auth";

// Outside `_authed`, so no guard runs here and a signed-out visitor can actually
// reach it. `redirect` is the href the guard was trying to open; `validateSearch`
// narrows it to a string, and `safeRedirect` decides whether to honour it.
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { auth } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setPending(true);

    const result = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });

    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Could not sign in with those details.");
      return;
    }

    // The cookie is set; the cached "signed out" answer is now wrong. Resetting
    // before navigating is what makes `_authed`'s guard re-ask instead of bouncing
    // this new session straight back here.
    auth.reset();
    await navigate({ href: safeRedirect(search.redirect) });
  }

  return (
    <AuthCard
      title="Sign in"
      description="Use the email and password for your account."
      error={error}
      footer={{
        prompt: "No account yet?",
        label: "Create one",
        to: "/signup",
        // Signup honours `redirect` too. Dropping it here is what would send a visitor
        // who deep-linked into a guarded page, bounced to login, then chose "Create
        // one" to / instead of the page they asked for.
        search: { redirect: search.redirect },
      }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
