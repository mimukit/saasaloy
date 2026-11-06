import type { ReactNode } from "react";
import { ArrowDownIcon, ArrowRightIcon, BookOpenIcon } from "lucide-react";

import { CommandField } from "@web/components/command-field";
import { landing } from "@web/content/landing";
import { SourceTree } from "@web/illustrations/source-tree";
import { cliVersion } from "@web/lib/cli-version";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { GITHUB_MARK } from "@web/lib/github-mark";
import { interpolate } from "@web/lib/interpolate";
import { cn } from "@web/lib/utils";

// Static. The command field's copy button is the one interactive part, and index.astro
// passes it in hydrated through the `commandField` slot. Rendered on its own, the hero
// draws a static field: the command stays selectable and the page ships no JavaScript
// for it. The motion is CSS: `blur-in` from ../styles/web.css on the command field and
// the note, staggered with `--blur-in-delay`, and still under reduced motion. The title
// and the description paint at once: the description is the page's LCP element, and an
// entry that starts at `opacity: 0` held LCP at 2.7 s (docs/seo/0002). The drawing plays
// its own entry through `drawing-load`, then loops. LOOP_SCRIPT in ../layouts/Layout.astro marks the
// drawing `data-offscreen` while it is out of view, and the CSS pauses every loop in it
// then. Without JavaScript the loops never pause.
//
// The hero is the two-column mockup the owner approved on 2026-11-06. It fills the first
// viewport, the navbar included: `min-h-svh`, a minimum and never a fixed height, so
// nothing clips when the text needs more room. Copy on the left and the drawing on the
// right from `lg` (64rem); below it the drawing follows the copy at full width, and the
// section grows past the viewport. A hairline under the navbar spans the container, and
// the foot holds the link down to the catalog over a `blueprint-rule` at the bottom of the
// viewport. The title's first sentence is `foreground`, the second `primary`, and its
// size follows the copy column (`text-display` reads `cqi`). The drawing is the source
// workspace in ../illustrations/source-tree.tsx.
//
// Every word comes from ../content/landing.ts. Edit the copy there, not here.

export interface HeroLink {
  /** `github` draws the GitHub mark, any other id the book icon. */
  id: string;
  label: string;
  href: string;
}

export interface HeroProps {
  titleLead?: string;
  titleAccent?: string;
  description?: string;
  command?: string;
  links?: HeroLink[];
  note?: string;
  /** The label of the link down to the module catalog. Empty hides the link. */
  explore?: string;
  /** A hydrated command field from index.astro. Defaults to a static one. */
  commandField?: ReactNode;
}

/**
 * The hero's links, one per row item. ./start.tsx shows the same list. `size="lg"` is the
 * hero's: mono labels, larger icons and no trailing arrow, as the approved mockup shows.
 */
export function HeroLinkList({
  links,
  size = "md",
}: {
  links: HeroLink[];
  size?: "md" | "lg";
}) {
  const large = size === "lg";
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-y-2",
        large ? "gap-x-10 font-mono text-sm sm:text-base" : "gap-x-6 text-sm"
      )}
    >
      {links.map((link) => (
        <li key={link.id}>
          <a
            href={link.href}
            {...externalLinkProps(link.href)}
            className={cn(
              "text-highlight inline-flex items-center font-medium underline-offset-4 hover:underline",
              large ? "gap-3" : "gap-2"
            )}
          >
            {link.id === "github" ? (
              GITHUB_MARK
            ) : (
              <BookOpenIcon
                aria-hidden="true"
                className={large ? "size-5" : "size-4"}
              />
            )}
            {link.label}
            {!large && (
              <ArrowRightIcon aria-hidden="true" className="size-3.5" />
            )}
            {newTabHint(link.href)}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Hero({
  titleLead = landing.hero.titleLead,
  titleAccent = landing.hero.titleAccent,
  description = landing.hero.description,
  command = landing.hero.command,
  links = landing.hero.links,
  note = interpolate(landing.hero.note, { version: cliVersion }),
  explore = landing.hero.explore,
  commandField,
}: HeroProps) {
  return (
    <section className="flex min-h-svh flex-col pt-14">
      <div aria-hidden="true" className="section-container-hero">
        <div className="border-border border-t" />
      </div>
      <div className="section-container-hero grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-8 lg:py-10 min-[90rem]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="@container flex flex-col gap-7">
          <h1 className="text-display">
            <span className="text-foreground block">{titleLead}</span>
            <span className="text-primary block">{titleAccent}</span>
          </h1>
          <p className="text-lead text-muted-foreground max-w-xl text-pretty">
            {description}
          </p>
          <div className="blur-in mt-2 flex flex-col gap-6">
            {commandField ?? <CommandField size="lg" command={command} />}
            <HeroLinkList links={links} size="lg" />
          </div>
          {note && (
            <p className="text-muted-foreground blur-in font-mono text-xs [--blur-in-delay:100ms] sm:text-sm">
              {note}
            </p>
          )}
        </div>

        <SourceTree className="text-highlight drawing-load w-full" />
      </div>
      {explore && (
        <div className="section-container-hero flex justify-center pt-2 pb-3">
          <a
            href="#catalog"
            className="text-foreground hover:text-highlight inline-flex items-center gap-2 font-mono text-sm underline-offset-4 transition-colors hover:underline"
          >
            {explore}
            <ArrowDownIcon aria-hidden="true" className="size-4" />
          </a>
        </div>
      )}
      <div
        aria-hidden="true"
        className="blueprint-rule [--rule-inset:1.5rem] lg:[--rule-inset:3rem]"
      />
    </section>
  );
}
