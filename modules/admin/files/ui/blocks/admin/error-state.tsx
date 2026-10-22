import { CircleAlertIcon } from "lucide-react";

import { Button, buttonVariants } from "@repo/ui/components/admin/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/admin/empty";
import { errors } from "@repo/ui/content/errors";
import { cn } from "@repo/ui/lib/utils";

// The admin app's error screen: its not-found screen, its error boundary, and the router
// default every route falls back to. It is the admin twin of blocks/error-state.tsx, with
// the same props, built on the admin primitive set so it matches the panel it sits in.
//
// The words still come from ../../content/errors.ts, so both apps say the same thing.
// The web app keeps the base block, which renders a full page; this one renders inside
// the shell's content panel, so it fills its container rather than the viewport.

/** A destination. Renders as an anchor. */
export interface ErrorStateLinkAction {
  label: string;
  href: string;
}

/** An in-place action, such as the router's `reset`. Renders as a button. */
export interface ErrorStateButtonAction {
  label: string;
  onClick: () => void;
}

export type ErrorStateAction = ErrorStateLinkAction | ErrorStateButtonAction;

export interface ErrorStateProps {
  /**
   * The status label above the title, such as "404" or "500". Required: a screen that
   * shows the wrong number is worse than one that shows none.
   */
  code: string;
  title?: string;
  description?: string;
  /**
   * The underlying message, such as the api's error text, shown small under the
   * description. Leave it out when it would only repeat the description.
   */
  detail?: string;
  /** The main way out. Pass `null` to render no action at all. */
  primaryAction?: ErrorStateAction | null;
  /** An optional second way out, shown after the primary one. */
  secondaryAction?: ErrorStateAction | null;
  className?: string;
}

// Hoisted so the default is one stable object rather than a fresh one per render.
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
  detail,
  primaryAction = DEFAULT_PRIMARY_ACTION,
  secondaryAction = null,
  className,
}: ErrorStateProps) {
  const actions = [primaryAction, secondaryAction].filter(
    (action) => action !== null
  );

  return (
    <Empty className={cn("min-h-full", className)}>
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="text-destructive-foreground bg-destructive/8"
        >
          <CircleAlertIcon />
        </EmptyMedia>
        <p className="text-muted-foreground font-mono text-xs tracking-widest">
          {code}
        </p>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription className="text-pretty">
          {description}
        </EmptyDescription>
        {detail === undefined || detail === "" ? null : (
          <p className="text-muted-foreground mt-3 max-w-full font-mono text-xs break-words">
            {detail}
          </p>
        )}
      </EmptyHeader>

      {actions.length > 0 && (
        <EmptyContent className="flex-row flex-wrap justify-center">
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

            // Bound to a local first: the linter wants a `handle*` name in the JSX
            // attribute rather than a bare property access.
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
        </EmptyContent>
      )}
    </Empty>
  );
}
