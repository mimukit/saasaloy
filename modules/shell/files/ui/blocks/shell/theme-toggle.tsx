import { MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Badge } from "@repo/ui/components/shell/badge";
import {
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "@repo/ui/components/shell/menu";
import type { MenuPrimitive } from "@repo/ui/components/shell/menu";
import {
  THEME_ATTRIBUTE,
  THEME_CHOICE_KEY,
  isTheme,
  revealTheme,
  setTheme,
} from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";

// The shell twin of blocks/theme-toggle.tsx: a "Theme" submenu in the sidebar's account
// menu, not a button in the header. It lists every theme as a radio item, with a check on
// the current choice, and the trigger names that choice.
//
// Unlike the base toggle it offers `system` as a choice of its own, so a person can go
// back to following the OS. That is why it is a picker and not a flip: it calls
// `setTheme` with the chosen value, through `revealTheme` for the same circle animation,
// and it does not use the delegated `[data-theme-toggle]` handler, which only flips.
//
// TO ADD A THEME, add an entry to THEME_OPTIONS. Its value must be a `Theme` that
// `@repo/ui/lib/theme` knows how to apply, so a custom theme starts there.
//
// It renders inside a Menu's popup and nowhere else.

interface ThemeOption {
  value: Theme;
  label: string;
  icon: LucideIcon;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

// `setTheme` writes the choice to `data-theme` on <html>, `system` included, so that
// attribute is the current choice. Each shell app's src/main.tsx applies a theme before
// React mounts, so the attribute is always there by the time this renders.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });

  return () => {
    observer.disconnect();
  };
}

function currentChoice(): Theme {
  const value = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return isTheme(value) ? value : "system";
}

function choiceOnServer(): Theme {
  return "system";
}

function chooseTheme(
  value: unknown,
  details: MenuPrimitive.RadioGroup.ChangeEventDetails
): void {
  if (typeof value !== "string" || !isTheme(value)) {
    return;
  }

  // The circle grows from the item that was picked. A change with no element behind it
  // grows from the page's centre.
  const { target } = details.event;
  const origin = target instanceof Element ? target : document.documentElement;

  revealTheme(origin, () => {
    setTheme(value);
  });

  // The same marker the base toggle writes, so the app's starting theme respects
  // this choice on the next load, `system` included.
  try {
    localStorage.setItem(THEME_CHOICE_KEY, "1");
  } catch {
    // Unwritable storage costs persistence, not the current page.
  }
}

export function ThemeMenuItem() {
  const choice = useSyncExternalStore(subscribe, currentChoice, choiceOnServer);
  const current = THEME_OPTIONS.find((option) => option.value === choice);

  return (
    <MenuSub>
      <MenuSubTrigger>
        <PaletteIcon />
        {/* The label takes the free space, so the current theme's pill sits against the
            chevron that MenuSubTrigger adds. */}
        <span className="flex-1">Theme</span>
        <Badge variant="outline" size="sm" className="rounded-full px-2">
          {current?.label}
        </Badge>
      </MenuSubTrigger>
      <MenuSubPopup className="min-w-36">
        <MenuRadioGroup value={choice} onValueChange={chooseTheme}>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <MenuRadioItem key={value} value={value}>
              <span className="flex items-center gap-2">
                <Icon className="size-4 opacity-80" />
                {label}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
