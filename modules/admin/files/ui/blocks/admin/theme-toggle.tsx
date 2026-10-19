import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@repo/ui/components/admin/button";
import { THEME_TOGGLE_LABEL } from "@repo/ui/lib/theme";
import { cn } from "@repo/ui/lib/utils";

// The admin twin of blocks/theme-toggle.tsx, on the admin primitive set. It is inert in
// the same way: no onClick and no state. The admin app's src/main.tsx installs the one
// delegated handler that flips light and dark for every `[data-theme-toggle]`, and
// animates the change as a circle from the button. The icons key off the `.dark` class
// through the `dark:` variant, so they stay right when the OS flips under `system`.
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
      // The handler names the painted palette once the DOM is ready. Until then the
      // palette is unknown, so this names the action only.
      aria-label={THEME_TOGGLE_LABEL}
      className={cn("hidden in-data-theme:inline-flex", className)}
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}
