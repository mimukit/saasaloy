import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { THEME_LABELS } from "@repo/ui/lib/theme";
import { cn } from "@repo/ui/lib/utils";

// The light/dark/system control — and the one block that is deliberately INERT. There is
// no onClick here and no state: the button is chrome, and every behaviour it appears to
// have comes from THEME_INIT_SCRIPT (packages/ui/src/lib/theme.ts), which the host
// document inlines in its <head>:
//
//   - Astro   apps/web/src/layouts/Layout.astro, `<script is:inline set:html={…} />`
//   - Vite    a `transformIndexHtml` plugin injecting the same constant at `head-prepend`
//
// Drop this block into a document that does NOT inline that script and it renders
// nothing at all — which is the point, not a bug. `data-theme` on <html> is set by the
// script and by nothing else, so it doubles as the JavaScript-present marker: the CSS
// below keeps the button hidden until the attribute exists. With JS off the control is
// absent rather than dead, and because the attribute lands pre-paint (before this button
// is even parsed) there is no reveal-on-mount flicker to pay for.
//
// That is what buys the landing page ZERO additional JavaScript for theme switching:
// index.astro renders this with no `client:*` directive. Adding one would ship React for
// a button that does not use it.
//
// The `in-data-[theme=…]` variants compile to `:where([data-theme=…]) &` — an ancestor
// match, so the icon swap is pure CSS off <html>. They live here rather than in
// globals.css so the block travels to another app self-contained.

export interface ThemeToggleProps {
  /** Positioning and chrome for the host page — the block itself is position-neutral. */
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-theme-toggle=""
      // The script rewrites this the moment the DOM is ready; the value here is the
      // truthful one for a first-time visitor, whose stored theme is unset.
      aria-label={THEME_LABELS.system}
      className={cn("hidden in-data-theme:inline-flex", className)}
    >
      <SunIcon className="hidden in-data-[theme=light]:block" />
      <MoonIcon className="hidden in-data-[theme=dark]:block" />
      <MonitorIcon className="hidden in-data-[theme=system]:block" />
    </Button>
  );
}
