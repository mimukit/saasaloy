import type { ReactNode } from "react";
import { BookOpenIcon, HistoryIcon, ScaleIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@web/site";
import { landing, ui } from "@web/content/landing";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { GITHUB_MARK } from "@web/lib/github-mark";
import { interpolate } from "@web/lib/interpolate";

// Fully static, no script. The round 10 footer: a blueprint rule on top, the large
// lowercase wordmark and the tagline on the left, and one row of links in `highlight` on
// the right, each with a small icon. The rows stack on mobile. A one-line privacy note
// sits under the tagline.
//
// Words and links come from ../content/landing.ts. An empty label in content drops a
// link. Every link leaves the site, so each one opens in a new tab.

export interface FooterLink {
  /** Picks the icon. An id with no icon below renders the label alone. */
  id: string;
  label: string;
  href: string;
}

const defaultLinks: FooterLink[] = landing.footer.links.filter(
  (link) => link.label !== "" && link.href !== ""
);

const LINK_ICONS: Record<string, ReactNode> = {
  github: GITHUB_MARK,
  "getting-started": <BookOpenIcon aria-hidden="true" className="size-4" />,
  changelog: <HistoryIcon aria-hidden="true" className="size-4" />,
  license: <ScaleIcon aria-hidden="true" className="size-4" />,
};

export interface FooterProps {
  siteName?: string;
  tagline?: string;
  /** The privacy line under the tagline. An empty string hides it. */
  privacy?: string;
  links?: FooterLink[];
}

export function Footer({
  siteName = defaultSiteName,
  tagline = interpolate(landing.footer.tagline, { siteName }),
  privacy = interpolate(landing.footer.privacy, { siteName }),
  links = defaultLinks,
}: FooterProps) {
  return (
    <footer>
      <div aria-hidden="true" className="blueprint-rule" />
      <div className="section-container-wide flex flex-col gap-8 py-12 md:flex-row md:items-end md:justify-between md:py-16">
        <div className="flex flex-col gap-2">
          <a
            href="/"
            className="text-highlight text-section-title w-fit font-semibold lowercase"
          >
            {siteName}
          </a>
          {tagline && <p className="text-muted-foreground">{tagline}</p>}
          {privacy && (
            <p className="text-muted-foreground max-w-md text-xs">{privacy}</p>
          )}
        </div>

        {links.length > 0 && (
          <nav aria-label={ui.footer.navLabel}>
            <ul className="flex flex-col gap-3 text-sm md:flex-row md:flex-wrap md:gap-x-8">
              {links.map((link) => (
                <li key={link.id}>
                  <a
                    href={link.href}
                    {...externalLinkProps(link.href)}
                    className="text-highlight inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline"
                  >
                    {LINK_ICONS[link.id]}
                    {link.label}
                    {newTabHint(link.href)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      <div aria-hidden="true" className="blueprint-rule" />
    </footer>
  );
}
