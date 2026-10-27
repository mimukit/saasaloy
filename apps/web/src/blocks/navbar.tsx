import { useEffect, useRef, useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@web/site";
import { ThemeToggle } from "@web/blocks/theme-toggle";
import { Button } from "@web/components/button";
import { landing, ui } from "@web/content/landing";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { interpolate } from "@web/lib/interpolate";
import { cn } from "@web/lib/utils";

// Marketing blocks are self-contained on purpose: one file, one exported component, no
// shared block barrel — but the words all live in ../content/landing.ts. Astro renders
// each `client:*` component as its own React root, so a compound primitive split across
// the .astro boundary would throw "must be used within" — composing the whole block here
// is what avoids that.
//
// This is the only block above the fold that needs JS (the mobile menu), which is why
// index.astro hydrates it with `client:idle` while the static blocks ship none. The bar
// frosts and gains its bottom hairline once the page scrolls, through the `nav-float`
// utility in ../styles/web.css — a CSS scroll timeline, not a scroll listener.
//
// THE HEADER TAKES NO SPACE. `<header>` is sticky with zero height, and the bar overflows
// it, so the first section starts at the top of the page and the blueprint grid runs up
// behind the bar. The hero's top padding clears the bar; a page that puts another
// section first gives that section the same top padding.
//
// The bar is the round 10 mockup's: the lowercase wordmark in `highlight` on the left,
// then Docs, GitHub and Guide and the theme toggle on the right. Every link leaves the
// site, so each one spreads `externalLinkProps` and opens in a new tab. Below `lg` the
// links move into the menu panel and the toggle stays in the bar.
//
// The theme toggle renders inside the bar. It needs no React state: the pre-paint script
// Layout.astro emits drives every `[data-theme-toggle]` through one delegated listener,
// so hydrating this island neither helps nor hurts it.

export interface NavbarLink {
  label: string;
  href: string;
}

// The links and their hrefs come from content (shape rule 5a). An empty label drops one.
const defaultLinks: NavbarLink[] = landing.navbar.links
  .map(({ label, href }) => ({ label, href }))
  .filter((link) => link.label !== "" && link.href !== "");

// Everything inside the open header a keyboard can reach. Tab cycles through these and
// nothing else while the mobile panel is open.
const FOCUSABLE =
  // verify-content-disable-next-line a CSS selector, not copy
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface NavbarProps {
  siteName?: string;
  links?: NavbarLink[];
}

export function Navbar({
  siteName = defaultSiteName,
  links = defaultLinks,
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
    <header ref={headerRef} className="sticky top-0 z-50 h-0">
      <div
        className={cn(
          "nav-float border-b",
          open && "border-border bg-background"
        )}
      >
        <div className="section-container-wide flex h-14 items-center gap-6">
          <a
            href="/"
            aria-label={interpolate(ui.navbar.homeLabel, { siteName })}
            className="text-highlight text-2xl leading-8 font-semibold tracking-[-0.02em] lowercase"
          >
            <span aria-hidden="true">{siteName}</span>
          </a>

          <nav
            aria-label={ui.navbar.mainNavLabel}
            className="ml-auto hidden items-center gap-8 lg:flex"
          >
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                {...externalLinkProps(link.href)}
                className="text-highlight text-sm font-medium underline-offset-4 hover:underline"
              >
                {link.label}
                {newTabHint(link.href)}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <ThemeToggle />
            {/* The panel below is rendered conditionally, so `aria-controls` is set only
                while it exists — an idref pointing at nothing is invalid ARIA. */}
            <Button
              ref={toggleRef}
              variant="ghost"
              size="icon"
              className="lg:hidden"
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
              className="section-container-wide flex flex-col py-2"
            >
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  {...externalLinkProps(link.href)}
                  onClick={() => {
                    setOpen(false);
                  }}
                  className="text-highlight hover:bg-muted border-b px-2 py-3 text-sm font-medium last:border-b-0"
                >
                  {link.label}
                  {newTabHint(link.href)}
                </a>
              ))}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
