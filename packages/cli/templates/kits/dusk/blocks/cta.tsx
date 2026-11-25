import { siteName as defaultSiteName } from "@repo/ui";
import { buttonVariants } from "@repo/ui/components/button";
import { landing } from "@repo/ui/content/landing";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// The dusk kit's closing call to action (Saasaloy UI, plan 0121). Fully static. One
// full-width panel in the primary colour: a centred title and line, an optional command
// chip and the two actions. The text and the buttons take the primary's foreground, so
// the panel reads in every theme, light or dark. No form: the base template has no
// backend to post to.
//
// Every word comes from ../content/landing.ts. The props match the ink CTA, so the two
// files swap for each other.

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
      <div className="section-container-wide">
        <div className="reveal bg-primary text-primary-foreground flex flex-col items-center gap-4 rounded-[calc(var(--radius)*2.4)] px-6 py-12 text-center md:px-12">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-balance opacity-85">{description}</p>
          {command && (
            <code className="bg-primary-foreground/10 mt-2 rounded-[calc(var(--radius)*1.6)] px-4 py-2 font-mono text-sm">
              <span aria-hidden="true" className="opacity-70">
                ${" "}
              </span>
              {command}
            </code>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <a
              href={primaryAction.href}
              {...externalLinkProps(primaryAction.href)}
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-primary-foreground text-primary hover:bg-primary-foreground/90 h-11 rounded-[calc(var(--radius)*1.6)] px-5"
              )}
            >
              {primaryAction.label}
              {newTabHint(primaryAction.href)}
            </a>
            {secondaryAction && (
              <a
                href={secondaryAction.href}
                {...externalLinkProps(secondaryAction.href)}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10 h-11 rounded-[calc(var(--radius)*1.6)] bg-transparent px-5"
                )}
              >
                {secondaryAction.label}
                {newTabHint(secondaryAction.href)}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
