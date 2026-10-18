import { useEffect, useRef, useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@repo/ui";
import { ThemeToggle } from "@repo/ui/blocks/theme-toggle";
import { Button, buttonVariants } from "@repo/ui/components/button";
import { landing, ui } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// Marketing blocks are self-contained on purpose: one file, one exported component, no
// shared block barrel — but the words all live in ../content/landing.ts. Astro renders
// each `client:*` component as its own React root, so a compound primitive split across
// the .astro boundary would throw "must be used within" — composing the whole block here
// is what avoids that.
//
// This is the only block above the fold that needs JS (the mobile menu), which is why
// index.astro hydrates it with `client:idle` while the static blocks ship none. The bar
// narrows and frosts once the page scrolls through the `nav-float` utility in
// ../styles/globals.css — a CSS scroll timeline, not a scroll listener.
//
// The theme toggle renders inside the bar. It needs no React state: the pre-paint script
// Layout.astro emits drives every `[data-theme-toggle]` through one delegated listener,
// so hydrating this island neither helps nor hurts it.

export interface NavbarLink {
  label: string;
  href: string;
}

// Same-page anchors, matching the ids the other blocks render. The anchor is structure and
// stays here; the label comes from content, and blanking it there drops the link — which
// is how a removed section loses its nav entry without editing this file.
//
// The two buttons are the exception, and their hrefs come from content too: they point off
// the page, at a signup, the docs or the source (content shape rule 5c).
const defaultLinks: NavbarLink[] = [
  { label: landing.navbar.linkFeatures, href: "#features" },
  { label: landing.navbar.linkHowItWorks, href: "#how-it-works" },
  { label: landing.navbar.linkShowcase, href: "#showcase" },
  { label: landing.navbar.linkPricing, href: "#pricing" },
  { label: landing.navbar.linkFaq, href: "#faq" },
].filter((link) => link.label !== "");

// Everything inside the open header a keyboard can reach. Tab cycles through these and
// nothing else while the mobile panel is open.
const FOCUSABLE =
  // verify-content-disable-next-line a CSS selector, not copy
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface NavbarProps {
  siteName?: string;
  links?: NavbarLink[];
  ctaLabel?: string;
  ctaHref?: string;
  secondaryLabel?: string;
  /** An empty string hides the secondary button. */
  secondaryHref?: string;
}

export function Navbar({
  siteName = defaultSiteName,
  links = defaultLinks,
  ctaLabel = landing.navbar.ctaLabel,
  ctaHref = landing.navbar.ctaHref,
  secondaryLabel = landing.navbar.secondaryLabel,
  secondaryHref = landing.navbar.secondaryHref,
}: NavbarProps) {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // While the panel is open: the page behind it does not scroll, Tab stays inside the
  // header, Escape closes it and puts focus back on the toggle, and a press outside the
  // header closes it. The listeners stay attached while the menu is closed and exit on the
  // first line instead — an early `return` plus a cleanup `return` in the same effect is
  // two return shapes, which `consistent-return` rejects.
  useEffect(() => {
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    if (open) {
      root.style.overflow = "hidden";
    }

    function close(restoreFocus: boolean) {
      setOpen(false);
      if (restoreFocus) {
        toggleRef.current?.focus();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!open) {
        return;
      }
      if (event.key === "Escape") {
        close(true);
        return;
      }
      const header = headerRef.current;
      if (event.key !== "Tab" || !header) {
        return;
      }
      const focusable = [
        ...header.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((element) => element.offsetParent !== null);
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        open &&
        event.target instanceof Node &&
        headerRef.current?.contains(event.target) !== true
      ) {
        close(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <header ref={headerRef} className="sticky top-0 z-50 px-2">
      <div
        className={cn(
          "nav-float max-w-wide mx-auto mt-2 rounded-2xl border border-transparent",
          open && "border-border bg-background"
        )}
      >
        <div className="flex h-14 items-center gap-4 px-4">
          <a
            href="/"
            aria-label={interpolate(ui.navbar.homeLabel, { siteName })}
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="bg-foreground size-6 rounded-md shadow-[inset_0_-6px_0_color-mix(in_oklch,var(--background)_30%,transparent)]"
            />
            <span aria-hidden="true">{siteName}</span>
          </a>

          <nav
            aria-label={ui.navbar.mainNavLabel}
            className="mx-auto hidden items-center gap-8 lg:flex"
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

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <ThemeToggle />
            {secondaryHref && (
              <a
                href={secondaryHref}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "hidden lg:inline-flex"
                )}
              >
                {secondaryLabel}
              </a>
            )}
            <a
              href={ctaHref}
              className={cn(buttonVariants(), "hidden lg:inline-flex")}
            >
              {ctaLabel}
            </a>
            {/* The panel below is rendered conditionally, so `aria-controls` is set only
                while it exists — an idref pointing at nothing is invalid ARIA. */}
            <Button
              ref={toggleRef}
              variant="ghost"
              size="icon"
              className="size-10 lg:hidden"
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
          <div id="navbar-mobile-menu" className="border-t lg:hidden">
            <nav
              aria-label={ui.navbar.mobileNavLabel}
              className="flex flex-col gap-1 p-4"
            >
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => {
                    setOpen(false);
                  }}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-2 py-2.5 text-sm transition-colors"
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-3 flex flex-col gap-2">
                {secondaryHref && (
                  <a
                    href={secondaryHref}
                    className={buttonVariants({
                      variant: "outline",
                      size: "lg",
                    })}
                  >
                    {secondaryLabel}
                  </a>
                )}
                <a href={ctaHref} className={buttonVariants({ size: "lg" })}>
                  {ctaLabel}
                </a>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
