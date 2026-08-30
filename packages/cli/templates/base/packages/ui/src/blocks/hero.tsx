import { ArrowRightIcon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { buttonVariants } from "@repo/ui/components/button";
import { landing } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// Fully static — no state, no effects, so index.astro renders it with no `client:*`
// directive and it ships zero JavaScript. Keep it that way: adding a hook here forces
// the whole above-the-fold block into a hydrated island.
//
// Every word comes from ../content/landing.ts. Edit the copy there, not here.

export interface HeroAction {
  label: string;
  href: string;
}

export interface HeroProps {
  siteName?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  primaryAction?: HeroAction;
  /** Pass `null` to render a single call to action. */
  secondaryAction?: HeroAction | null;
}

// Hoisted out of the parameter list: an object literal written as a default prop is a
// fresh object on every render, which defeats memoization downstream. The labels still
// come from the content module — only the wrapper object is stable.
const DEFAULT_PRIMARY_ACTION: HeroAction = {
  label: landing.hero.primaryActionLabel,
  href: "#cta",
};
const DEFAULT_SECONDARY_ACTION: HeroAction = {
  label: landing.hero.secondaryActionLabel,
  href: "#pricing",
};

export function Hero({
  siteName = "Acme",
  eyebrow = landing.hero.eyebrow,
  title = landing.hero.title,
  description = interpolate(landing.hero.description, { siteName }),
  primaryAction = DEFAULT_PRIMARY_ACTION,
  secondaryAction = DEFAULT_SECONDARY_ACTION,
}: HeroProps) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        {eyebrow && (
          <Badge variant="secondary" className="mb-6">
            {eyebrow}
          </Badge>
        )}
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-6 max-w-2xl text-base text-pretty sm:text-lg">
          {description}
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
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
