import { useEffect, useRef, useState } from "react";
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
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
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
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape is the expected way out of an open menu, and focus has to go back to the
  // toggle — the panel unmounts under the user's cursor otherwise, dropping focus to
  // the document and sending the next Tab to the top of the page.
  useEffect(() => {
    // The `open` guard lives inside the handler rather than in front of the
    // subscription, so the effect always returns a cleanup of the same shape.
    function handleKeyDown(event: KeyboardEvent) {
      if (!open || event.key !== "Escape") {
        return;
      }
      setOpen(false);
      toggleRef.current?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-50 w-full border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <a href="/" className="text-sm font-semibold tracking-tight">
          {siteName}
        </a>

        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={ctaHref}
            className={cn(
              buttonVariants({ size: "sm" }),
              "hidden md:inline-flex"
            )}
          >
            {ctaLabel}
          </a>
          {/* The one interactive control in the header. The panel below is rendered
              conditionally, so `aria-controls` is set only while it exists — an idref
              pointing at nothing is invalid ARIA. */}
          <Button
            ref={toggleRef}
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-controls={open ? "navbar-mobile-menu" : undefined}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => {
              setOpen((previous) => !previous);
            }}
          >
            {open ? <XIcon /> : <MenuIcon />}
          </Button>
        </div>
      </div>

      {open && (
        <div
          id="navbar-mobile-menu"
          className="border-border/60 border-t md:hidden"
        >
          <nav
            aria-label="Mobile"
            className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-6 py-4"
          >
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => {
                  setOpen(false);
                }}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-2 py-2 text-sm transition-colors"
              >
                {link.label}
              </a>
            ))}
            <a
              href={ctaHref}
              onClick={() => {
                setOpen(false);
              }}
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
