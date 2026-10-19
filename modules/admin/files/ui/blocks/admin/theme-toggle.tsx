import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@repo/ui/components/admin/button";
import { THEME_LABELS } from "@repo/ui/lib/theme";
import { cn } from "@repo/ui/lib/utils";

// The admin twin of blocks/theme-toggle.tsx, on the admin primitive set. It is inert in
// the same way: no onClick and no state. The admin app's src/main.tsx installs the one
// delegated handler that cycles light → dark → system for every `[data-theme-toggle]`,
// and the icon swap is pure CSS off `<html data-theme>`, from @repo/ui/lib/theme.
//
// The button stays hidden until `data-theme` exists on <html>, so a document that never
// runs the theme script renders no control rather than a dead one.

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      data-theme-toggle=""
      // The handler rewrites this once the DOM is ready; the value here is the truthful
      // one for a first-time visitor, whose stored theme is unset.
      aria-label={THEME_LABELS.system}
      className={cn("hidden in-data-theme:inline-flex", className)}
    >
      <SunIcon className="hidden in-data-[theme=light]:block" />
      <MoonIcon className="hidden in-data-[theme=dark]:block" />
      <MonitorIcon className="hidden in-data-[theme=system]:block" />
    </Button>
  );
}
