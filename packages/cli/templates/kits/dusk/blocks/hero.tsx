import { siteName as defaultSiteName } from "@repo/ui";
import { buttonVariants } from "@repo/ui/components/button";
import { landing } from "@repo/ui/content/landing";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// The dusk kit's hero (Saasaloy UI, plan 0121). Fully static: no state and no effects, so
// index.astro renders it with no `client:*` directive and it ships zero JavaScript.
//
// A 5:7 split: the pill, the headline, the line and the two actions on the left, the
// product frame on the right, with a soft glow of the primary colour behind the frame.
// The frame draws a terminal from `landing.hero.terminalLines`. The kit's corners follow
// the theme: every radius is a multiple of `--radius`, so a theme with sharper corners
// gives a sharper hero.
//
// Every word comes from ../content/landing.ts. Edit the copy there, not here. The props
// match the ink hero, so the two files swap for each other; this one does not draw
// `tree`, the ink hero's project tree.

type TerminalLine = (typeof landing.hero.terminalLines)[number];
type TreeEntry = (typeof landing.hero.tree)[number];

export interface HeroAction {
  label: string;
  href: string;
}

export interface HeroProps {
  siteName?: string;
  announcement?: string;
  announcementHref?: string;
  title?: string;
  description?: string;
  primaryAction?: HeroAction;
  /** Pass `null` to render a single call to action. */
  secondaryAction?: HeroAction | null;
  terminalLines?: TerminalLine[];
  /** Accepted for the ink hero's props; the dusk frame shows the terminal only. */
  tree?: TreeEntry[];
}

// Hoisted out of the parameter list, so a render does not build a fresh default object.
const DEFAULT_PRIMARY_ACTION: HeroAction = {
  label: landing.hero.primaryActionLabel,
  href: landing.hero.primaryActionHref,
};
const DEFAULT_SECONDARY_ACTION: HeroAction = {
  label: landing.hero.secondaryActionLabel,
  href: landing.hero.secondaryActionHref,
};

export function Hero({
  siteName = defaultSiteName,
  announcement = landing.hero.announcement,
  announcementHref = landing.hero.announcementHref,
  title = interpolate(landing.hero.title, { siteName }),
  description = interpolate(landing.hero.description, { siteName }),
  primaryAction = DEFAULT_PRIMARY_ACTION,
  secondaryAction = DEFAULT_SECONDARY_ACTION,
  terminalLines = landing.hero.terminalLines,
}: HeroProps) {
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-16 md:pt-40 md:pb-24">
      <div className="section-container-wide grid items-center gap-12 lg:grid-cols-12">
        <div className="flex flex-col items-start gap-6 lg:col-span-5">
          {announcement && (
            <a
              href={announcementHref}
              {...externalLinkProps(announcementHref)}
              className="blur-in bg-primary/10 text-primary hover:bg-primary/15 rounded-full px-3 py-1 text-sm font-medium transition-colors"
            >
              {announcement}
              {newTabHint(announcementHref)}
            </a>
          )}
          <h1 className="blur-in text-4xl font-semibold tracking-tight text-balance [--blur-in-delay:100ms] md:text-5xl">
            {title}
          </h1>
          <p className="text-lead text-muted-foreground blur-in text-pretty [--blur-in-delay:200ms]">
            {description}
          </p>
          <div className="blur-in flex flex-wrap items-center gap-3 [--blur-in-delay:300ms]">
            <a
              href={primaryAction.href}
              {...externalLinkProps(primaryAction.href)}
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 rounded-[calc(var(--radius)*1.6)] px-5"
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
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 rounded-[calc(var(--radius)*1.6)] px-5"
                )}
              >
                {secondaryAction.label}
                {newTabHint(secondaryAction.href)}
              </a>
            )}
          </div>
        </div>

        <div className="blur-in relative [--blur-in-delay:450ms] lg:col-span-7">
          {/* The glow: the primary colour, faded to nothing. Decoration only. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-12 -z-10 bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)] dark:bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_30%,transparent),transparent)]"
          />
          <figure className="bg-foreground text-background dark:bg-card dark:text-card-foreground overflow-hidden rounded-[calc(var(--radius)*2.4)] border shadow-[0_30px_60px_-24px_color-mix(in_oklch,var(--foreground)_35%,transparent)]">
            <figcaption className="sr-only">
              {interpolate(landing.hero.terminalLabel, { siteName })}
            </figcaption>
            <div aria-hidden="true" className="flex gap-2 px-5 pt-5">
              <span className="size-3 rounded-full bg-current opacity-30" />
              <span className="size-3 rounded-full bg-current opacity-30" />
              <span className="size-3 rounded-full bg-current opacity-30" />
            </div>
            <pre className="overflow-x-auto px-6 pt-4 pb-7 font-mono text-[0.8125rem] leading-[1.9] whitespace-pre-wrap">
              <code>
                <span aria-hidden="true" className="block opacity-60">
                  {landing.hero.terminalTitle}
                </span>
                {terminalLines.map((line) =>
                  line.kind === "command" ? (
                    <span key={line.id} className="block">
                      <span aria-hidden="true" className="opacity-60">
                        ${" "}
                      </span>
                      {line.text}
                    </span>
                  ) : (
                    <span key={line.id} className="block pl-4 opacity-60">
                      {line.text}
                    </span>
                  )
                )}
              </code>
            </pre>
          </figure>
        </div>
      </div>
    </section>
  );
}
