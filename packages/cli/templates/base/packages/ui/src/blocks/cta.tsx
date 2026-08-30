import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@repo/ui/components/button";
import { landing } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
// It is also the anchor (`#cta`) every other block's call to action points at.
//
// Every word comes from ../content/landing.ts, and so do both destinations: these two
// buttons leave the page, and where they go is a fact about the product rather than about
// the layout (content shape rule 5c). Edit them there, not here.

export interface CtaAction {
  label: string;
  href: string;
}

export interface CtaProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  primaryAction?: CtaAction;
  /** Pass `null` to render a single call to action. */
  secondaryAction?: CtaAction | null;
}

// Hoisted out of the parameter list: an object literal written as a default prop is a
// fresh object on every render, which defeats memoization downstream. Both labels and
// both destinations still come from the content module — only the wrapper is stable.
const DEFAULT_PRIMARY_ACTION: CtaAction = {
  label: landing.cta.primaryActionLabel,
  href: landing.cta.primaryActionHref,
};
const DEFAULT_SECONDARY_ACTION: CtaAction = {
  label: landing.cta.secondaryActionLabel,
  href: landing.cta.secondaryActionHref,
};

export function Cta({
  id = "cta",
  siteName = "Acme",
  title = landing.cta.title,
  description = interpolate(landing.cta.description, { siteName }),
  primaryAction = DEFAULT_PRIMARY_ACTION,
  secondaryAction = DEFAULT_SECONDARY_ACTION,
}: CtaProps) {
  return (
    <section
      id={id}
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20"
    >
      <div className="bg-muted ring-foreground/10 flex flex-col items-center gap-6 rounded-2xl px-6 py-16 text-center ring-1">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-xl text-base text-pretty">
          {description}
        </p>
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={primaryAction.href}
            className={cn(buttonVariants({ size: "lg" }))}
          >
            {primaryAction.label}
            <ArrowRightIcon data-icon="inline-end" />
          </a>
          {secondaryAction && (
            <a
              href={secondaryAction.href}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              {secondaryAction.label}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
