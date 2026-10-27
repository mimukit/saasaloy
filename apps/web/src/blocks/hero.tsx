import type { ReactNode } from "react";
import { ArrowRightIcon, BookOpenIcon } from "lucide-react";

import { CommandField } from "@web/components/command-field";
import { landing } from "@web/content/landing";
import { AppWireframe } from "@web/illustrations/app-wireframe";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { GITHUB_MARK } from "@web/lib/github-mark";

// Static. The command field's copy button is the one interactive part, and index.astro
// passes it in hydrated through the `commandField` slot. Rendered on its own, the hero
// draws a static field: the command stays selectable and the page ships no JavaScript
// for it. The motion is CSS: `blur-in` from ../styles/web.css, staggered with
// `--blur-in-delay`, and still under reduced motion.
//
// The round 9/10 hero: the copy on the left and the application wireframe on the right
// from `lg` (64rem); below it the drawing follows the copy at full width. The title's
// first sentence is `foreground`, the second `highlight`.
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
  /** A hydrated command field from index.astro. Defaults to a static one. */
  commandField?: ReactNode;
}

export function Hero({
  titleLead = landing.hero.titleLead,
  titleAccent = landing.hero.titleAccent,
  description = landing.hero.description,
  command = landing.hero.command,
  links = landing.hero.links,
  note = landing.hero.note,
  commandField,
}: HeroProps) {
  return (
    <section className="pt-24 pb-16 md:pt-28">
      <div className="section-container-wide grid items-center gap-12 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <h1 className="text-display blur-in lg:text-[3.25rem]">
            <span className="text-foreground block">{titleLead}</span>
            <span className="text-highlight block">{titleAccent}</span>
          </h1>
          <p className="text-lead text-muted-foreground blur-in max-w-md text-balance [--blur-in-delay:100ms]">
            {description}
          </p>
          <div className="blur-in flex flex-col gap-4 [--blur-in-delay:200ms]">
            {commandField ?? <CommandField command={command} />}
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              {links.map((link) => (
                <li key={link.id}>
                  <a
                    href={link.href}
                    {...externalLinkProps(link.href)}
                    className="text-highlight inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline"
                  >
                    {link.id === "github" ? (
                      GITHUB_MARK
                    ) : (
                      <BookOpenIcon aria-hidden="true" className="size-4" />
                    )}
                    {link.label}
                    <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                    {newTabHint(link.href)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          {note && (
            <p className="text-muted-foreground blur-in text-xs [--blur-in-delay:300ms]">
              {note}
            </p>
          )}
        </div>

        <AppWireframe className="text-highlight blur-in w-full [--blur-in-delay:300ms]" />
      </div>
    </section>
  );
}
