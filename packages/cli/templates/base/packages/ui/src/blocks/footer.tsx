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
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
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
    <footer className="mt-8 border-t border-border/60">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-sm font-semibold tracking-tight">{siteName}</p>
            <p className="mt-2 max-w-xs text-sm text-pretty text-muted-foreground">{tagline}</p>
          </div>

          {groups.map((group) => (
            <nav key={group.heading} aria-label={group.heading}>
              <p className="text-sm font-medium">{group.heading}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
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

        <p className="text-sm text-muted-foreground">
          © {year} {siteName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
