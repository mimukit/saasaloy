import { useEffect, useRef, useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

import { Button, buttonVariants } from "@repo/ui/components/button";
import { landing, ui } from "@repo/ui/content/landing";
import { cn } from "@repo/ui/lib/utils";

// Marketing blocks are self-contained on purpose: one file, one exported component, no
// shared block barrel — but the words all live in ../content/landing.ts. Astro renders
// each `client:*` component as its own React root, so a compound primitive split across
// the .astro boundary would throw "must be used within" — composing the whole block here
// is what avoids that.
//
// This is the only block above the fold that needs JS (the mobile menu), which is why
// index.astro hydrates it with `client:idle` while the static blocks ship none.

export interface NavbarLink {
  label: string;
  href: string;
}

// Same-page anchors, matching the ids the other blocks render. The anchor is structure and
// stays here; the label comes from content, and blanking it there drops the link — which
// is how a removed section loses its nav entry without editing this file.
//
// The CTA button is the exception, and its href comes from content too: it is the one
// control here that may point off the page, at a signup or a waitlist (content shape
// rule 5c).
const defaultLinks: NavbarLink[] = [
  { label: landing.navbar.linkFeatures, href: "#features" },
  { label: landing.navbar.linkPricing, href: "#pricing" },
  { label: landing.navbar.linkFaq, href: "#faq" },
].filter((link) => link.label !== "");

export interface NavbarProps {
  siteName?: string;
  links?: NavbarLink[];
  ctaLabel?: string;
  ctaHref?: string;
}

export function Navbar({
  siteName = "Acme",
  links = defaultLinks,
  ctaLabel = landing.navbar.ctaLabel,
  ctaHref = landing.navbar.ctaHref,
}: NavbarProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape is the expected way out of an open menu, and focus has to go back to the
  // toggle — the panel unmounts under the user's cursor otherwise, dropping focus to
  // the document and sending the next Tab to the top of the page.
  // The listener stays attached while the menu is closed and exits on the first line
  // instead — one early `return` plus a cleanup `return` in the same effect is two
  // return shapes, which `consistent-return` rejects.
  useEffect(() => {
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

        <nav
          aria-label={ui.navbar.mainNavLabel}
          className="hidden items-center gap-6 md:flex"
        >
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
            aria-label={open ? ui.navbar.closeMenu : ui.navbar.openMenu}
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
            aria-label={ui.navbar.mobileNavLabel}
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
