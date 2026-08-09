import { Separator } from "@repo/ui/components/separator";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
// It carries the legal links the base template ships pages for (/terms, /privacy);
// the navbar keeps only same-page anchors.

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
    heading: "Product",
    links: [
      { href: "#features", label: "Features" },
      { href: "#pricing", label: "Pricing" },
      { href: "#faq", label: "FAQ" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

export interface FooterProps {
  siteName?: string;
  tagline?: string;
  groups?: FooterGroup[];
  /** Defaults to the current year at render time. */
  year?: number;
}

export function Footer({
  siteName = "Acme",
  tagline = "A Cloudflare-native SaaS, scaffolded with Saasaloy.",
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
          © {year} {siteName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
