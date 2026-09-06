import { CircleAlertIcon } from "lucide-react";

import { Button, buttonVariants } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { errors } from "@repo/ui/content/errors";
import { cn } from "@repo/ui/lib/utils";

// The one error screen every app in this repo renders: the web app's 404 and 500 pages,
// the admin app's not-found screen, and the admin app's error boundary. No app writes its
// own error markup — a second copy is a second thing to restyle when the theme moves.
//
// Fully static by default. No state, no effects, no `client:*` directive: an Astro page
// renders `<ErrorState code="404" />` and ships zero JavaScript for it. The only thing
// that can pull the browser in is a caller passing an action with `onClick` instead of
// `href`, which is what the admin error boundary does for its retry. An .astro page must
// never do that — Astro serializes island props, and a function does not survive the
// crossing.
//
// Every word comes from ../content/errors.ts. The defaults are the not-found case, since
// it is the one screen with no second sensible reading; the render-failure and
// server-failure callers pass their own strings from the same module. Edit the words
// there, not here.

/** A destination. Renders as an anchor, so it costs no JavaScript. */
export interface ErrorStateLinkAction {
  label: string;
  href: string;
}

/** An in-place action, such as the router's `reset`. Renders as a button, so it hydrates. */
export interface ErrorStateButtonAction {
  label: string;
  onClick: () => void;
}

export type ErrorStateAction = ErrorStateLinkAction | ErrorStateButtonAction;

export interface ErrorStateProps {
  /**
   * The status label above the title — "404", "500". Required, and deliberately not
   * defaulted: a screen that shows the wrong number is worse than one that shows none,
   * and every caller already knows which case it is rendering.
   *
   * It is a display label, not a claim about the response status. The admin not-found
   * screen shows "404" over a soft 200, by decision.
   */
  code: string;
  title?: string;
  description?: string;
  /** The main way out. Pass `null` to render no action at all. */
  primaryAction?: ErrorStateAction | null;
  /** An optional second way out, shown after the primary one. */
  secondaryAction?: ErrorStateAction | null;
  /** Merged onto the wrapping `<main>`, for a caller that supplies its own page frame. */
  className?: string;
}

// Hoisted out of the parameter list: an object literal written as a default prop is a
// fresh object on every render, which defeats memoization downstream. The label and the
// destination still come from the content module — only the wrapper is stable.
const DEFAULT_PRIMARY_ACTION: ErrorStateLinkAction = {
  label: errors.notFound.homeLabel,
  href: "/",
};

function isLinkAction(
  action: ErrorStateAction
): action is ErrorStateLinkAction {
  return "href" in action;
}

export function ErrorState({
  code,
  title = errors.notFound.title,
  description = errors.notFound.description,
  primaryAction = DEFAULT_PRIMARY_ACTION,
  secondaryAction = null,
  className,
}: ErrorStateProps) {
  const actions = [primaryAction, secondaryAction].filter(
    (action) => action !== null
  );

  return (
    <main
      className={cn(
        "mx-auto flex min-h-dvh max-w-lg items-center px-6",
        className
      )}
    >
      <Card className="w-full">
        <CardHeader>
          <CircleAlertIcon className="text-muted-foreground size-5" />
          <p className="text-muted-foreground font-mono text-xs tracking-widest">
            {code}
          </p>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="text-pretty">
            {description}
          </CardDescription>
        </CardHeader>
        {actions.length > 0 && (
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            {actions.map((action, index) => {
              const variant = index === 0 ? "default" : "outline";

              if (isLinkAction(action)) {
                return (
                  <a
                    key={action.label}
                    href={action.href}
                    className={cn(buttonVariants({ variant }))}
                  >
                    {action.label}
                  </a>
                );
              }

              // Bound to a local first: the linter reads the JSX attribute value, and it
              // wants a `handle*` name there rather than a bare property access.
              const handleClick = action.onClick;

              return (
                <Button
                  key={action.label}
                  onClick={handleClick}
                  variant={variant}
                >
                  {action.label}
                </Button>
              );
            })}
          </CardContent>
        )}
      </Card>
    </main>
  );
}
