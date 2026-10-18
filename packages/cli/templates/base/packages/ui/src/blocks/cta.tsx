import { siteName as defaultSiteName } from "@repo/ui";
import { buttonVariants } from "@repo/ui/components/button";
import { landing } from "@repo/ui/content/landing";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// Fully static. The closing ask: a centred title and line, an optional command shown as a
// code chip, and the same ringed button pair the hero uses. No form: the base template
// has no backend to post to. A module that ships one (waitlist) brings its own block.
//
// Every word comes from ../content/landing.ts. The two hrefs leave the page, so they live
// there too (content shape rule 5c).

export interface CtaAction {
  label: string;
  href: string;
}

export interface CtaProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  /** Shown as a code chip. An empty string hides it. */
  command?: string;
  primaryAction?: CtaAction;
  /** Pass `null` to render a single call to action. */
  secondaryAction?: CtaAction | null;
}

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
  siteName = defaultSiteName,
  title = interpolate(landing.cta.title, { siteName }),
  description = interpolate(landing.cta.description, { siteName }),
  command = landing.cta.command,
  primaryAction = DEFAULT_PRIMARY_ACTION,
  secondaryAction = DEFAULT_SECONDARY_ACTION,
}: CtaProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container-narrow reveal flex flex-col items-center gap-4 text-center">
        <h2 className="text-section-title text-balance">{title}</h2>
        <p className="text-lead text-muted-foreground text-balance">
          {description}
        </p>
        {command && (
          <code className="bg-muted mt-2 rounded-lg border px-4 py-2 font-mono text-sm">
            <span aria-hidden="true" className="text-muted-foreground">
              ${" "}
            </span>
            {command}
          </code>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <span className="bg-foreground/5 rounded-[calc(var(--radius)+4px)] border p-0.5">
            <a
              href={primaryAction.href}
              {...externalLinkProps(primaryAction.href)}
              className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}
            >
              {primaryAction.label}
              {newTabHint(primaryAction.href)}
            </a>
          </span>
          {secondaryAction && (
            <a
              href={secondaryAction.href}
              {...externalLinkProps(secondaryAction.href)}
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                "h-10 px-4"
              )}
            >
              {secondaryAction.label}
              {newTabHint(secondaryAction.href)}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
