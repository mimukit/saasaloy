import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { AuthCard } from "../components/auth-card";
import { safeRedirect, signUp } from "../lib/auth";

// Self-serve signup, and the way a fresh project gets its first user. The server
// allows it: packages/auth/src/auth.ts sets `emailAndPassword.enabled` with
// `requireEmailVerification: false` (verification needs the `email` capability, which
// auth deliberately does not depend on). Better Auth signs the new user in as part of
// the same call, so success lands on the dashboard rather than back on /login.
export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: SignupPage,
});

function SignupPage() {
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

    const result = await signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });

    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Could not create that account.");
      return;
    }

    auth.reset();
    await navigate({ href: safeRedirect(search.redirect) });
  }

  return (
    <AuthCard
      title="Create your account"
      description="The first account you create is this project's first user."
      error={error}
      footer={{
        prompt: "Already have an account?",
        label: "Sign in",
        to: "/login",
        search: { redirect: search.redirect },
      }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required />
        </div>
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
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
