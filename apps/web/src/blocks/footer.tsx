import { Fragment } from "react";
import type { ReactNode } from "react";
import { BookOpenIcon, HistoryIcon, ScaleIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@web/site";
import { landing, ui } from "@web/content/landing";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { GITHUB_MARK } from "@web/lib/github-mark";
import { analyticsToken } from "@web/lib/analytics";
import { interpolate } from "@web/lib/interpolate";

// Static, with one inline script. The round 10 footer: a blueprint rule on top, the large
// lowercase wordmark and the tagline on the left, and one row of links in `highlight` on
// the right, each with a small icon. The rows stack on mobile. A one-line privacy note
// sits under the tagline; it names the analytics only when the build loads them. Under
// the last rule, a centred monospace colophon carries the copyright and the credits
// (variant C of the footer credit mockup).
//
// The copyright year is the build year in the HTML. YEAR_SCRIPT sets it to the visitor's
// year, so a page built in December still reads right in January. Without JavaScript the
// build year stays, which is still a true year.
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

// The analytics sentence joins the privacy line only when the build loads the beacon.
const defaultPrivacy = [
  landing.footer.privacy,
  analyticsToken ? landing.footer.analytics : "",
]
  .filter((line) => line !== "")
  .join(" ");

// Read once when the module loads, so the render stays pure. In a static build that is
// the build year.
const BUILD_YEAR = new Date().getFullYear();

const YEAR_SCRIPT =
  'for(const e of document.querySelectorAll("[data-current-year]"))e.textContent=String(new Date().getFullYear())';

// Fill the `{token}` placeholders in a footer message with elements. interpolate() takes
// strings only, and the year and the two credit names render as elements. An unknown
// token stays as written, as it does in interpolate().
function fillNodes(
  message: string,
  values: Record<string, ReactNode>
): ReactNode[] {
  return message.split(/(\{\w+\})/).map((part, index) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    const node =
      key !== undefined && Object.hasOwn(values, key) ? values[key] : part;
    return <Fragment key={index}>{node}</Fragment>;
  });
}

function CreditLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      {...externalLinkProps(href)}
      className="text-foreground decoration-border hover:decoration-highlight underline underline-offset-4"
    >
      {label}
      {newTabHint(href)}
    </a>
  );
}

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
  /** The copyright line in the colophon. An empty string hides it. */
  copyright?: string;
  /** The credit line in the colophon. An empty string hides it. */
  credit?: string;
}

export function Footer({
  siteName = defaultSiteName,
  tagline = interpolate(landing.footer.tagline, { siteName }),
  privacy = interpolate(defaultPrivacy, { siteName }),
  links = defaultLinks,
  copyright = landing.footer.copyright,
  credit = landing.footer.credit,
}: FooterProps) {
  const { author, sponsor } = landing.footer;
  return (
    <footer>
      <div aria-hidden="true" className="blueprint-rule" />
      <div className="section-container-wide flex flex-col gap-8 py-12 md:flex-row md:items-end md:justify-between md:py-16">
        <div className="flex flex-col gap-2">
          <a
            href="/"
            className="text-primary text-section-title w-fit font-semibold lowercase"
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
      {(copyright || credit) && (
        <div className="section-container-wide text-muted-foreground flex flex-col gap-1 py-6 text-center font-mono text-xs tracking-wide">
          {copyright && (
            <p className="uppercase">
              {fillNodes(copyright, {
                year: <span data-current-year>{BUILD_YEAR}</span>,
                holder: landing.footer.copyrightHolder,
              })}
            </p>
          )}
          {credit && (
            <p>
              {fillNodes(credit, {
                heart: (
                  <>
                    <span aria-hidden="true" className="text-highlight">
                      ♥
                    </span>
                    <span className="sr-only">{ui.footer.heart}</span>
                  </>
                ),
                author: <CreditLink {...author} />,
                sponsor: <CreditLink {...sponsor} />,
              })}
            </p>
          )}
          {copyright.includes("{year}") && (
            // oxlint-disable-next-line react/no-danger -- YEAR_SCRIPT is a constant above; no input reaches it.
            <script dangerouslySetInnerHTML={{ __html: YEAR_SCRIPT }} />
          )}
        </div>
      )}
    </footer>
  );
}
