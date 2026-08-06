import { useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

import { Button, buttonVariants } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

// Marketing blocks are self-contained on purpose: one file, one exported component, its
// own copy defaults, no shared block barrel. Astro renders each `client:*` component as
// its own React root, so a compound primitive split across the .astro boundary would
// throw "must be used within" — composing the whole block here is what avoids that.
//
// This is the only block above the fold that needs JS (the mobile menu), which is why
// index.astro hydrates it with `client:idle` while the static blocks ship none.

export interface NavbarLink {
  label: string;
  href: string;
}

// Same-page anchors, matching the ids the other blocks render.
const defaultLinks: NavbarLink[] = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export interface NavbarProps {
  siteName?: string;
  links?: NavbarLink[];
  ctaLabel?: string;
  ctaHref?: string;
}

export function Navbar({
  siteName = "Acme",
  links = defaultLinks,
  ctaLabel = "Get started",
  ctaHref = "#cta",
}: NavbarProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <a href="/" className="text-sm font-semibold tracking-tight">
          {siteName}
        </a>

        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a href={ctaHref} className={cn(buttonVariants({ size: "sm" }), "hidden md:inline-flex")}>
            {ctaLabel}
          </a>
          {/* The one interactive control in the header. `aria-controls` points at the
              panel below, which is why the panel is rendered conditionally rather than
              hidden with a class — nothing to announce when it isn't there. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-controls="navbar-mobile-menu"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((previous) => !previous)}
          >
            {open ? <XIcon /> : <MenuIcon />}
          </Button>
        </div>
      </div>

      {open && (
        <div id="navbar-mobile-menu" className="border-t border-border/60 md:hidden">
          <nav
            aria-label="Mobile"
            className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-6 py-4"
          >
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <a
              href={ctaHref}
              onClick={() => setOpen(false)}
              className={cn(buttonVariants({ size: "sm" }), "mt-2")}
            >
              {ctaLabel}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
