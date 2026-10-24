import { KeyboardIcon, SearchIcon } from "lucide-react";
import type * as React from "react";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

import { CommandPalette } from "@repo/ui/blocks/command/command-palette";
import { Keycaps } from "@repo/ui/blocks/command/keycaps";
import { ShortcutHelp } from "@repo/ui/blocks/command/shortcut-help";
import { Button } from "@repo/ui/components/shell/button";
import {
  formatKeycaps,
  usePlatform,
  useShortcutEngine,
} from "@repo/ui/lib/command/engine";
import type { EngineBinding } from "@repo/ui/lib/command/engine";
import {
  isAvailable,
  mergeRegistrations,
  paletteGroups,
  parseShortcut,
  resolveBindings,
  shortcutSections,
} from "@repo/ui/lib/command/registry";
import type {
  Chord,
  Platform,
  ResolvedCommand,
} from "@repo/ui/lib/command/registry";
import { CommandRegistryContext } from "@repo/ui/lib/shell/commands";
import type {
  Command,
  CommandRegistration,
  CommandRegistry,
} from "@repo/ui/lib/shell/commands";
import type { ShellExtension } from "@repo/ui/lib/shell/extensions";

// The `command` module's root: the provider every `useCommands` call registers with, the
// two key bindings that open its views, the palette and the shortcut sheet, and the header
// trigger. An app mounts it through its shell extension list:
//
//   export const shellExtensions = defineShellExtensions({ extensions: [commandExtension()] });
//
// which the app's descriptor writes with a `plugin-array` patch when `command` is installed.

// Vite replaces `process.env.NODE_ENV` in client code at dev and build time. The
// declaration types it without pulling Node's types into a browser package.
declare const process: { env: { NODE_ENV?: string } };

/** In development a binding conflict throws; in production it warns once. */
const MODE: "development" | "production" =
  process.env.NODE_ENV === "production" ? "production" : "development";

const OPEN_PALETTE = "command.open-palette";
const SHOW_SHORTCUTS = "command.show-shortcuts";

/** The palette never lists the command that opens it. */
const HIDDEN_FROM_PALETTE: ReadonlySet<string> = new Set([OPEN_PALETTE]);

/** The conflict pairs already warned about, so each warns once per page load. */
const WARNED = new Set<string>();

type Overlay = "palette" | "shortcuts" | null;

interface CommandUi {
  openPalette: () => void;
  platform: Platform;
  /** The palette shortcut's parsed steps, for the trigger's keycaps. */
  paletteSteps: readonly Chord[];
}

const CommandUiContext = createContext<CommandUi | null>(null);

const PALETTE_SHORTCUT = "Mod+K";
const SHORTCUTS_SHORTCUT = "?";

/** "Go to Users" → "users": the page the empty state suggests. */
function pageExampleOf(
  groups: ReturnType<typeof paletteGroups>
): string | undefined {
  const navigation = groups.find((group) => group.key === "navigation");
  const title = navigation?.items[0]?.command.title;
  return title?.replace(/^Go to /, "").toLowerCase();
}

function binding(
  entry: ResolvedCommand & { steps: readonly Chord[] }
): EngineBinding {
  return {
    id: entry.command.id,
    steps: entry.steps,
    available: () => isAvailable(entry.command),
    run: () => {
      entry.command.run({ source: "shortcut" });
    },
  };
}

function CommandProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const [registrations, setRegistrations] = useState<
    readonly CommandRegistration[]
  >([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const platform = usePlatform();

  // `register` keeps a registration's place when the same `useCommands` call registers
  // again, so the palette order follows the order the screens mounted in.
  const registry = useMemo<CommandRegistry>(
    () => ({
      register: (registration) => {
        setRegistrations((current) =>
          current.some((entry) => entry.id === registration.id)
            ? current.map((entry) =>
                entry.id === registration.id ? registration : entry
              )
            : [...current, registration]
        );
        return () => {
          setRegistrations((current) =>
            current.filter((entry) => entry !== registration)
          );
        };
      },
    }),
    []
  );

  // The module's own two commands. They are commands like any other, so the palette, the
  // sheet and the conflict check all see them.
  const own = useMemo<CommandRegistration>(() => {
    const commands: Command[] = [
      {
        id: OPEN_PALETTE,
        title: "Open the command palette",
        group: "actions",
        keywords: ["search", "commands"],
        icon: SearchIcon,
        shortcut: PALETTE_SHORTCUT,
        run: () => {
          setOverlay((current) => (current === "palette" ? null : "palette"));
        },
      },
      {
        id: SHOW_SHORTCUTS,
        title: "Show keyboard shortcuts",
        group: "actions",
        keywords: ["help", "keys", "hotkeys"],
        icon: KeyboardIcon,
        shortcut: SHORTCUTS_SHORTCUT,
        run: () => {
          setOverlay("shortcuts");
        },
      },
    ];
    return { id: "command", scope: "global", commands };
  }, []);

  const resolved = useMemo(
    () => mergeRegistrations([own, ...registrations]),
    [own, registrations]
  );
  const bound = useMemo(
    () =>
      resolveBindings(resolved, {
        mode: MODE,
        warn: (message) => {
          // oxlint-disable-next-line no-console -- a production conflict is a warning by design (plan 0084).
          console.warn(message);
        },
        warned: WARNED,
      }),
    [resolved]
  );

  const groups = paletteGroups(resolved, HIDDEN_FROM_PALETTE);
  const sections = shortcutSections(bound);

  const paletteSteps = useMemo(() => parseShortcut(PALETTE_SHORTCUT), []);
  const shortcutsSteps = useMemo(() => parseShortcut(SHORTCUTS_SHORTCUT), []);

  useShortcutEngine({
    bindings: bound.flatMap((entry) =>
      entry.steps === null ? [] : [binding({ ...entry, steps: entry.steps })]
    ),
    overlay: {
      open: overlay !== null,
      bindings: [
        {
          id: OPEN_PALETTE,
          steps: paletteSteps,
          available: () => true,
          run: () => {
            setOverlay((current) => (current === "palette" ? null : "palette"));
          },
        },
        {
          id: SHOW_SHORTCUTS,
          steps: shortcutsSteps,
          available: () => true,
          run: () => {
            setOverlay((current) =>
              current === "shortcuts" ? null : "shortcuts"
            );
          },
        },
      ],
    },
  });

  const ui = useMemo<CommandUi>(
    () => ({
      openPalette: () => {
        setOverlay("palette");
      },
      platform,
      paletteSteps,
    }),
    [platform, paletteSteps]
  );

  return (
    <CommandRegistryContext value={registry}>
      <CommandUiContext value={ui}>
        {children}
        <CommandPalette
          open={overlay === "palette"}
          onOpenChange={(open) => {
            setOverlay(open ? "palette" : null);
          }}
          groups={groups}
          platform={platform}
          pageExample={pageExampleOf(groups)}
          onRun={(entry) => {
            setOverlay(null);
            entry.command.run({ source: "palette" });
          }}
          onShowShortcuts={() => {
            setOverlay("shortcuts");
          }}
        />
        <ShortcutHelp
          open={overlay === "shortcuts"}
          onOpenChange={(open) => {
            setOverlay(open ? "shortcuts" : null);
          }}
          sections={sections}
          platform={platform}
        />
      </CommandUiContext>
    </CommandRegistryContext>
  );
}

/**
 * The header trigger. From 640 px up it is a 240 px field that reads "Search commands…"
 * with the palette's keycaps; below 640 px it is a 32 px icon button.
 */
function CommandTrigger(): React.ReactElement | null {
  const ui = useContext(CommandUiContext);
  if (ui === null) {
    return null;
  }
  return (
    <>
      <Button
        variant="outline"
        className="text-muted-foreground hidden w-60 justify-start gap-2 ps-2.5 pe-1.5 font-normal sm:inline-flex"
        onClick={() => {
          ui.openPalette();
        }}
      >
        <SearchIcon aria-hidden="true" />
        <span className="flex-1 text-start">Search commands…</span>
        <Keycaps steps={formatKeycaps(ui.paletteSteps, ui.platform)} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 sm:hidden"
        aria-label="Search commands"
        onClick={() => {
          ui.openPalette();
        }}
      >
        <SearchIcon aria-hidden="true" />
      </Button>
    </>
  );
}

/**
 * The `command` module's shell extension. An app appends a bare `commandExtension()` call
 * to its `shellExtensions` list; the descriptor's `plugin-array` patch writes it.
 */
export function commandExtension(): ShellExtension {
  return { id: "command", Provider: CommandProvider, header: CommandTrigger };
}
