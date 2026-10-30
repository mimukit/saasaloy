import type { ReactNode } from "react";
import { ArrowRightIcon } from "lucide-react";

import { HeroLinkList } from "@web/blocks/hero";
import type { HeroLink } from "@web/blocks/hero";
import { CommandField } from "@web/components/command-field";
import { landing } from "@web/content/landing";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { inlineCode } from "@web/lib/inline-code";

// Static. The closing block after the FAQ, from mockup round 1 of report 0008
// (2026-10-30, option A): the title and the lead on the left from `lg` (64rem), and the
// command field, the hero's links and the line about this site's own source on the
// right. Below `lg` the copy comes first. It has no drawing, so it follows the FAQ with
// no side to keep.
//
// The command field's copy button is the one interactive part, and index.astro passes it
// in hydrated through the `commandField` slot, as it does for the hero.
//
// Every word comes from ../content/landing.ts. The links are the hero's.

export interface StartProps {
  id?: string;
  title?: string;
  description?: string;
  command?: string;
  links?: HeroLink[];
  source?: string;
  sourceLabel?: string;
  sourceHref?: string;
  /** A hydrated command field from index.astro. Defaults to a static one. */
  commandField?: ReactNode;
}

export function Start({
  id = "start",
  title = landing.start.title,
  description = landing.start.description,
  command = landing.start.command,
  links = landing.hero.links,
  source = landing.start.source,
  sourceLabel = landing.start.sourceLabel,
  sourceHref = landing.start.sourceHref,
  commandField,
}: StartProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container-wide grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="reveal min-w-0">
          <h2 className="text-section-title text-primary text-balance">
            {title}
          </h2>
          {description && (
            <p className="text-lead text-muted-foreground mt-6 max-w-xl text-pretty">
              {description}
            </p>
          )}
        </div>

        <div className="reveal flex min-w-0 flex-col gap-4">
          {commandField ?? <CommandField command={command} />}
          <HeroLinkList links={links} />
          {source && (
            <p className="text-muted-foreground mt-2 max-w-md text-sm text-pretty">
              {inlineCode(source)}{" "}
              {sourceHref && (
                <a
                  href={sourceHref}
                  {...externalLinkProps(sourceHref)}
                  className="text-highlight inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                >
                  {sourceLabel}
                  <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                  {newTabHint(sourceHref)}
                </a>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
