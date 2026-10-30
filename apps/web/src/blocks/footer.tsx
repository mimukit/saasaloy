import { Fragment } from "react";
import type { ReactNode } from "react";
import { BookOpenIcon, HistoryIcon, ScaleIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@web/site";
import { landing, ui } from "@web/content/landing";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { GITHUB_MARK } from "@web/lib/github-mark";
import { analyticsToken } from "@web/lib/analytics";
import { interpolate } from "@web/lib/interpolate";

// Static, with one inline script. Option B of the footer layout mockup: a blueprint rule
// on top, then one row with the tagline on the left and the links in `highlight` on the
// right, each with a small icon. Under it, the lowercase wordmark runs the full width of
// the container at `wordmark-display`. A dimension line under the wordmark carries the
// notice, and it names the analytics only when the build loads them. Under the line, a
// monospace colophon puts the copyright on the left and the credit on the right. The
// rows stack on mobile.
//
// The copyright year is the build year in the HTML. YEAR_SCRIPT sets it to the visitor's
// year, so a page built in December still reads right in January. Without JavaScript the
// build year stays, which is still a true year.
//
// Words and links come from ../content/landing.ts. An empty label in content drops a
// link. Every link leaves the site, except the wordmark, so each one opens in a new tab.

// The construction guides drawn over the large wordmark (option 1 of the footer pattern
// mockup): the x-height and baseline, the side bearings, a construction circle on the
// first "s" and on the "y", and a crosshair at each corner. The viewBox is the wordmark's
// box, 1210 by 308 at 308px, and the box keeps that ratio at every size, because
// `wordmark-display` sets both from one value. The guides sit in hairlines of `highlight`
// and stay still.
const LETTER_GUIDES = (
  <svg
    aria-hidden="true"
    viewBox="0 0 1210 308"
    preserveAspectRatio="none"
    className="text-highlight pointer-events-none absolute inset-0 size-full overflow-visible"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
  >
    <g opacity="0.55" strokeDasharray="4 4" vectorEffect="non-scaling-stroke">
      <path d="M-10 93H1220M-30 265H1240M10 -24V332M1200 -24V332" />
      <circle cx="95" cy="180" r="112" />
      <circle cx="1150" cy="250" r="88" />
    </g>
    <g opacity="0.7">
      <circle cx="10" cy="93" r="5" />
      <circle cx="10" cy="265" r="5" />
      <circle cx="1200" cy="265" r="5" />
      <path d="M-28 -16H-4M-16 -28V-4M1214 -16H1238M1226 -28V-4M-28 324H-4M-16 312V336M1214 324H1238M1226 312V336" />
    </g>
  </svg>
);

export interface FooterLink {
  /** Picks the icon. An id with no icon below renders the label alone. */
  id: string;
  label: string;
  href: string;
}

const defaultLinks: FooterLink[] = landing.footer.links.filter(
  (link) => link.label !== "" && link.href !== ""
);

// The analytics label joins the notice only when the build loads the beacon.
const defaultNotice = [
  landing.footer.notice,
  analyticsToken ? landing.footer.analytics : "",
]
  .filter((line) => line !== "")
  .join(" · ");

// Read once when the module loads, so the render stays pure. In a static build that is
// the build year.
const BUILD_YEAR = new Date().getFullYear();

const YEAR_SCRIPT =
  'for(const e of document.querySelectorAll("[data-current-year]"))e.textContent=String(new Date().getFullYear())';

// Fill the `{token}` placeholders in a footer message with elements. interpolate() takes
// strings only, and the year and the two credit links render as elements. An unknown
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
  /** The label on the dimension line. An empty string hides it. */
  notice?: string;
  links?: FooterLink[];
  /** The copyright line in the colophon. An empty string hides it. */
  copyright?: string;
  /** The credit line in the colophon. An empty string hides it. */
  credit?: string;
}

export function Footer({
  siteName = defaultSiteName,
  tagline = interpolate(landing.footer.tagline, { siteName }),
  notice = interpolate(defaultNotice, { siteName }),
  links = defaultLinks,
  copyright = landing.footer.copyright,
  credit = landing.footer.credit,
}: FooterProps) {
  const { copyrightHolder, sponsor } = landing.footer;
  return (
    <footer>
      <div aria-hidden="true" className="blueprint-rule" />
      <div className="section-container-wide pt-12 md:pt-16">
        <div className="flex flex-col gap-6 md:flex-row md:items-baseline md:justify-between">
          {tagline && (
            <p className="text-muted-foreground text-lg">{tagline}</p>
          )}
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

        <div className="relative mt-10 w-fit md:mt-14">
          <a
            href="/"
            className="text-primary text-wordmark-display block lowercase"
          >
            {siteName}
          </a>
          {LETTER_GUIDES}
        </div>

        <div className="text-highlight mt-8 flex items-center gap-3 font-mono text-xs tracking-wide uppercase">
          <span aria-hidden="true" className="dimension-arm" />
          {notice && (
            <p className="text-center text-balance">
              {notice.split(" · ").map((part, index) => (
                <Fragment key={index}>
                  {index > 0 && " · "}
                  <span className="whitespace-nowrap">{part}</span>
                </Fragment>
              ))}
            </p>
          )}
          <span aria-hidden="true" className="dimension-arm" />
        </div>

        {(copyright || credit) && (
          <div className="text-muted-foreground flex flex-col gap-2 py-6 font-mono text-xs tracking-wide md:flex-row md:justify-between md:gap-8">
            {copyright && (
              <p>
                {fillNodes(copyright, {
                  year: <span data-current-year>{BUILD_YEAR}</span>,
                  holder: <CreditLink {...copyrightHolder} />,
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
      </div>
    </footer>
  );
}
