import type { ReactNode } from "react";
import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@web/components/button";
import { CommandField } from "@web/components/command-field";
import { landing } from "@web/content/landing";
import { SiteLayers } from "@web/illustrations/site-layers";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { GITHUB_MARK } from "@web/lib/github-mark";
import { inlineCode } from "@web/lib/inline-code";
import { cn } from "@web/lib/utils";

// Static. The round 10 "this site" section: the title, a lead, the command field again,
// and an outlined secondary link to this site's source on GitHub, with the drawing of the
// site's layers beside it from `lg` (64rem). index.astro passes a hydrated command field
// through the `commandField` slot; on its own the block draws a static one.
//
// The copy states what is true: the site began as the base template's landing page and
// lives at `apps/web`. It is a fork, so `saasaloy update` does not reach it.
//
// Every word comes from ../content/landing.ts.

export interface SiteSourceProps {
  id?: string;
  title?: string;
  description?: string;
  command?: string;
  sourceLabel?: string;
  sourceHref?: string;
  /** A hydrated command field from index.astro. Defaults to a static one. */
  commandField?: ReactNode;
}

export function SiteSource({
  id = "site-source",
  title = landing.siteSource.title,
  description = landing.siteSource.description,
  command = landing.siteSource.command,
  sourceLabel = landing.siteSource.sourceLabel,
  sourceHref = landing.siteSource.sourceHref,
  commandField,
}: SiteSourceProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container-wide grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="reveal flex flex-col gap-6">
          <h2 className="text-section-title text-primary max-w-[14ch] text-balance">
            {title}
          </h2>
          <p className="text-lead text-muted-foreground max-w-md text-pretty">
            {inlineCode(description)}
          </p>
          {commandField ?? <CommandField command={command} prompt="$" />}
          <a
            href={sourceHref}
            {...externalLinkProps(sourceHref)}
            className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
          >
            {GITHUB_MARK}
            {sourceLabel}
            <ArrowRightIcon aria-hidden="true" className="size-3.5" />
            {newTabHint(sourceHref)}
          </a>
        </div>

        <SiteLayers className="text-highlight drawing mx-auto w-full max-w-xl" />
      </div>
    </section>
  );
}
