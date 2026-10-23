import type { ReactNode } from "react";

import { config } from "@repo/config";
import { siteName as defaultSiteName } from "@repo/ui";
import { landing, ui } from "@repo/ui/content/landing";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { interpolate } from "@repo/ui/lib/interpolate";

// Fully static, with one small inline script. A centred brand, one row of links, the
// social icons and the copyright, over a dashed rule.
//
// THE YEAR. A static build renders the year it was built in, so a page built in January
// would show last year's copyright for twelve months. The HTML keeps the build year
// inside a `data-year` span as the no-JavaScript fallback, and the script right after it
// writes the visitor's current year. It is the only script this block emits, it lives
// here so deleting the footer deletes it, and it needs no island.
//
// Words and outbound links come from ../content/landing.ts. The legal links point at this
// site's own pages, and `apps/web` has to agree with them page for page, so their paths
// come from `config.app.legal`. An empty label in content drops a link.

export interface FooterLink {
  label: string;
  href: string;
}

const defaultLinks: FooterLink[] = [
  ...landing.footer.links.map(({ label, href }) => ({ label, href })),
  { label: landing.footer.linkTerms, href: config.app.legal.termsPath },
  { label: landing.footer.linkPrivacy, href: config.app.legal.privacyPath },
].filter((link) => link.label !== "" && link.href !== "");

// CC0 marks from simple-icons (https://simpleicons.org). Each draws in `currentColor`.
const SOCIAL_MARKS: {
  key: string;
  label: string;
  href: string;
  mark: ReactNode;
}[] = [
  {
    key: "github",
    label: ui.footer.github,
    href: landing.footer.githubHref,
    mark: (
      // verify-content-disable-next-line an SVG path, not copy
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    ),
  },
  {
    key: "x",
    label: ui.footer.x,
    href: landing.footer.xHref,
    mark: (
      // verify-content-disable-next-line an SVG path, not copy
      <path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
    ),
  },
].filter((social) => social.href !== "");

// Runs where it is emitted, right after the span it writes into. Kept to one line on
// purpose: it is inlined into the HTML, not bundled.
const YEAR_SCRIPT =
  // verify-content-disable-next-line an inline script, not copy
  'document.querySelectorAll("[data-year]").forEach(function(e){e.textContent=String(new Date().getFullYear())})';

export interface FooterProps {
  siteName?: string;
  tagline?: string;
  links?: FooterLink[];
}

export function Footer({
  siteName = defaultSiteName,
  tagline = interpolate(landing.footer.tagline, { siteName }),
  links = defaultLinks,
}: FooterProps) {
  // Read at render, never at module scope: the Cloudflare adapter prerenders inside
  // workerd, which freezes `Date` outside a request, so a module-level year reads 1970.
  // A static page renders once, at build time, so this cannot drift between renders.
  // oxlint-disable-next-line react/purity
  const buildYear = new Date().getFullYear();
  // The copyright is split around `{year}` so the year can sit in its own span. Every
  // other token is filled first, so the split only ever sees the year.
  const [beforeYear = "", afterYear = ""] = interpolate(
    landing.footer.copyright,
    { siteName }
  ).split("{year}");

  return (
    <footer className="border-t-2 border-dashed py-16 md:py-24">
      <div className="section-container flex flex-col items-center gap-6 text-center">
        <a
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="bg-foreground size-6 rounded-md shadow-[inset_0_-6px_0_color-mix(in_oklch,var(--background)_30%,transparent)]"
          />
          {siteName}
        </a>
        {tagline && (
          <p className="text-muted-foreground max-w-sm text-sm text-pretty">
            {tagline}
          </p>
        )}

        {links.length > 0 && (
          <nav aria-label={ui.footer.navLabel}>
            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    {...externalLinkProps(link.href)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                    {newTabHint(link.href)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {SOCIAL_MARKS.length > 0 && (
          <ul className="flex gap-2">
            {SOCIAL_MARKS.map((social) => (
              <li key={social.key}>
                <a
                  href={social.href}
                  {...externalLinkProps(social.href)}
                  className="text-muted-foreground hover:text-foreground grid size-10 place-items-center transition-colors"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                    className="size-4"
                  >
                    {social.mark}
                  </svg>
                  <span className="sr-only">{social.label}</span>
                  {newTabHint(social.href)}
                </a>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground text-xs">
          {beforeYear}
          <span data-year="">{buildYear}</span>
          {afterYear}
        </p>
        {/* The script is a constant in this file, never content or input, so nothing
            user-controlled reaches the HTML. */}
        {/* oxlint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: YEAR_SCRIPT }} />
      </div>
    </footer>
  );
}
