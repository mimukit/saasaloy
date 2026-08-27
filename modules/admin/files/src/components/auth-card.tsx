import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";

// The frame the login and signup screens share: centred card, heading, error slot,
// and a link to the other screen. It lives outside `_authed`, so it carries none of
// the signed-in chrome. Keeping it in one place is what stops the two screens
// drifting apart the first time someone restyles one of them.

export interface AuthCardProps {
  title: string;
  description: string;
  /** Rendered above the form when the last submit failed. */
  error?: string | null;
  /** The form itself. */
  children: ReactNode;
  footer: {
    prompt: string;
    label: string;
    /** A route in this app — `/login` or `/signup`. */
    to: "/login" | "/signup";
    /**
     * Search to carry across. Both screens read `redirect` and finish the trip through
     * `safeRedirect`, so the hop between them has to forward it or a guarded deep link
     * loses its destination the moment the visitor switches screens.
     */
    search?: { redirect?: string };
  };
}

export function AuthCard({ title, description, error, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {children}
          <p className="text-sm text-muted-foreground">
            {footer.prompt}{" "}
            <Link
              to={footer.to}
              search={footer.search ?? {}}
              className="text-foreground underline underline-offset-4"
            >
              {footer.label}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
