import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import type { Command } from "@repo/ui/lib/shell/commands";
import type { Theme } from "@repo/ui/lib/theme";

// Relative, not `@app/components/nav`: commands.test.ts loads this file under
// `node --test`, and that runner resolves no workspace alias.
import { NAV_AREAS, navShortcut } from "./nav";
import type { NavItem } from "./nav";

// The app's own commands: one "Go to …" per NAV_AREAS row, sign out, and the three
// theme choices. app-shell.tsx declares them in the `global` scope through `useCommands`.
// A screen declares its own with `useCommands(commands, { scope: "route", label })`, where
// `label` is the page title the palette groups them under.
//
// With no `command` module installed, nothing reads them, and the app behaves as it did.
// With it, each one is a palette row, and a row's `shortcut` is its key binding.
//
// The builder is pure on purpose. It takes the three side effects as arguments and
// imports no router, no session and no DOM, so commands.test.ts can walk NAV_AREAS and
// check that every row has a command and that no two shortcuts are equal.

/** The side effects the commands call. app-shell.tsx passes the real ones in. */
export interface AppCommandActions {
  navigate: (to: NavItem["to"]) => void;
  signOut: () => void;
  setTheme: (theme: Theme) => void;
}

/** "Recent signups" → "recent-signups", the tail of a "Go to" command id. */
export function commandSlug(label: string): string {
  return label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

const THEMES: readonly {
  value: Theme;
  label: string;
  icon: Command["icon"];
}[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

export function appCommands({
  navigate,
  signOut,
  setTheme,
}: AppCommandActions): Command[] {
  const items: readonly NavItem[] = NAV_AREAS.flatMap((area) =>
    area.groups.flatMap((group) => group.items)
  );

  const goTo = items.map((item): Command => ({
    id: `app.go-to-${commandSlug(item.label)}`,
    title: `Go to ${item.label}`,
    group: "navigation",
    icon: item.icon,
    shortcut: navShortcut(item),
    run: () => {
      navigate(item.to);
    },
  }));

  const themes = THEMES.map(({ value, label, icon }): Command => ({
    id: `app.theme-${value}`,
    title: `Theme: ${label}`,
    group: "preferences",
    keywords: ["appearance", "color scheme"],
    icon,
    run: () => {
      setTheme(value);
    },
  }));

  return [
    ...goTo,
    {
      id: "app.sign-out",
      title: "Sign out",
      group: "actions",
      keywords: ["log out"],
      icon: LogOutIcon,
      run: () => {
        signOut();
      },
    },
    ...themes,
  ];
}
