import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@web/components/button";
import { landing } from "@web/content/landing";
import { AgentCrew } from "@web/illustrations/agent-crew";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { inlineCode } from "@web/lib/inline-code";
import { cn } from "@web/lib/utils";

// First class support for coding agents: the project instructions and the skill files
// every module brings, beside the agent session drawing. The drawing loops while it is in
// view: `drawing-load` and `data-loop-in-view` on its <svg>, and LOOP_SCRIPT in
// ../layouts/Layout.astro pauses it off screen.

export interface SiteSourceProps {
  id?: string;
  title?: string;
  description?: string;
  detail?: string;
  sourceLabel?: string;
  sourceHref?: string;
}

export function SiteSource({
  id = "agent-support",
  title = landing.siteSource.title,
  description = landing.siteSource.description,
  detail = landing.siteSource.detail,
  sourceLabel = landing.siteSource.sourceLabel,
  sourceHref = landing.siteSource.sourceHref,
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
          <p className="text-lead text-muted-foreground max-w-md text-pretty">
            {inlineCode(detail)}
          </p>
          <a
            href={sourceHref}
            {...externalLinkProps(sourceHref)}
            className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
          >
            {sourceLabel}
            <ArrowRightIcon aria-hidden="true" className="size-3.5" />
            {newTabHint(sourceHref)}
          </a>
        </div>

        <AgentCrew className="text-highlight drawing-load mx-auto w-full max-w-xl" />
      </div>
    </section>
  );
}
