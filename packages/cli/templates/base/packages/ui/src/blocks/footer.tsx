import { Separator } from "@repo/ui/components/separator";
import { landing, ui } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
// It carries the legal links the base template ships pages for (/terms, /privacy);
// the navbar keeps only same-page anchors.
//
// The words come from ../content/landing.ts; the hrefs stay here, because a URL is
// structure rather than copy. Blanking a label in the content file drops that link, and a
// group whose links are all blank disappears — that is how a removed section loses its
// footer entry without editing this file.

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterGroup {
  heading: string;
  links: FooterLink[];
}

const defaultGroups: FooterGroup[] = [
  {
    heading: landing.footer.groupProduct,
    links: [
      { label: landing.footer.linkFeatures, href: "#features" },
      { label: landing.footer.linkPricing, href: "#pricing" },
      { label: landing.footer.linkFaq, href: "#faq" },
    ],
  },
  {
    heading: landing.footer.groupLegal,
    links: [
      { label: landing.footer.linkTerms, href: "/terms" },
      { label: landing.footer.linkPrivacy, href: "/privacy" },
    ],
  },
]
  .map((group) => ({
    ...group,
    links: group.links.filter((link) => link.label !== ""),
  }))
  .filter((group) => group.heading !== "" && group.links.length > 0);

export interface FooterProps {
  siteName?: string;
  tagline?: string;
  groups?: FooterGroup[];
  /** Defaults to the current year at render time. */
  year?: number;
}

export function Footer({
  siteName = "Acme",
  tagline = landing.footer.tagline,
  groups = defaultGroups,
  year = new Date().getFullYear(),
}: FooterProps) {
  return (
    <footer className="border-border/60 mt-8 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-sm font-semibold tracking-tight">{siteName}</p>
            <p className="text-muted-foreground mt-2 max-w-xs text-sm text-pretty">
              {tagline}
            </p>
          </div>

          {groups.map((group) => (
            <nav key={group.heading} aria-label={group.heading}>
              <p className="text-sm font-medium">{group.heading}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <Separator className="my-10" />

        <p className="text-muted-foreground text-sm">
          {interpolate(ui.footer.copyright, { year, siteName })}
        </p>
      </div>
    </footer>
  );
}
