import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@web/components/button";
import { THEME_TOGGLE_LABEL } from "@web/lib/theme";
import { cn } from "@web/lib/utils";

// The light/dark control — and the one block that is deliberately INERT. There is
// no onClick here and no state: the button is chrome, and every behaviour it appears to
// have comes from THEME_INIT_SCRIPT (src/lib/theme.ts), which the host
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
// TWO STATES. A press flips light and dark. `system` is where a first-time visitor starts,
// and the button shows the palette `system` resolved to, so it has no third icon. The
// icons key off the `.dark` class through the `dark:` variant every theme file declares,
// so the swap is pure CSS off <html> and stays right when the OS flips under `system`.
//
// A press animates: the new theme grows as a circle from this button. The script starts
// a view transition, and globals.css holds the animation. Without view transitions, or
// with reduced motion requested, the theme changes at once.

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
      // The script names the painted palette the moment the DOM is ready. Until then the
      // palette is unknown, so this names the action only.
      aria-label={THEME_TOGGLE_LABEL}
      className={cn("hidden in-data-theme:inline-flex", className)}
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}
