import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
// It is also the anchor (`#cta`) every other block's call to action points at.

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

export function Cta({
  id = "cta",
  siteName = "Acme",
  title = "Start building today",
  description = `Set up ${siteName} in a couple of minutes. No credit card, no sales call, no lock-in.`,
  primaryAction = { label: "Get started", href: "/" },
  secondaryAction = { label: "Read the docs", href: "/" },
}: CtaProps) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-muted px-6 py-16 text-center ring-1 ring-foreground/10">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="max-w-xl text-base text-pretty text-muted-foreground">{description}</p>
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
          <a href={primaryAction.href} className={cn(buttonVariants({ size: "lg" }))}>
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
