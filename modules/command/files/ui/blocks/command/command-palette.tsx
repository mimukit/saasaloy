import type * as React from "react";
import { useState } from "react";

import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/components/shell/command";
import { Kbd, KbdGroup } from "@repo/ui/components/shell/kbd";
import { Keycaps } from "@repo/ui/blocks/command/keycaps";
import { formatKeycaps } from "@repo/ui/lib/command/engine";
import { filterPalette, splitMatches } from "@repo/ui/lib/command/filter";
import type { FilteredGroup, FilteredRow } from "@repo/ui/lib/command/filter";
import type {
  PaletteGroup,
  Platform,
  ResolvedCommand,
} from "@repo/ui/lib/command/registry";

// The command palette: a search row, the commands in their fixed groups, and a footer of
// key hints. It is presentational. The container hands it the groups and runs the row a
// person picks; this file only filters, draws and reports.
//
// Placement follows the approved mockup (plan 0084, Phase 1): 576 px wide, 12vh from the
// top from 640 px up and 8 px from the top below it, never stuck to the bottom. The list
// stops at min(480px, 60vh) and scrolls.

/** The popup's own placement, on top of the shell `CommandDialogPopup` defaults. */
const POPUP_PLACEMENT =
  // The shell viewport pads max(16px, 4vh) above and 16px beside the popup below 640 px,
  // and 10vh above it from 640 px up. These margins move the popup to the mockup's 8px
  // and 12vh; the popup's height is the 48 px search row, the list and the 40 px footer.
  "max-h-[calc(min(30rem,60vh)+5.5rem)] max-sm:mt-[calc(--spacing(2)-max(--spacing(4),4vh))] max-sm:w-[calc(100%+--spacing(4))] max-sm:max-w-none sm:mt-[2vh]";

function Row({
  row,
  platform,
}: {
  row: FilteredRow;
  platform: Platform;
}): React.ReactElement {
  const { command, steps } = row.entry;
  const Icon = command.icon;
  return (
    <>
      {Icon === undefined ? (
        <span aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <Icon aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {splitMatches(command.title, row.ranges).map((part, index) =>
          part.matched ? (
            <span
              // Parts of one title never reorder, so the position is a stable key.
              key={`${String(index)}:${part.text}`}
              className="decoration-muted-foreground font-semibold underline underline-offset-3"
            >
              {part.text}
            </span>
          ) : (
            <span key={`${String(index)}:${part.text}`}>{part.text}</span>
          )
        )}
      </span>
      {command.active?.() === true ? (
        // The current choice of a set, such as the theme in use, in place of a keycap.
        <span className="text-muted-foreground text-xs">Current</span>
      ) : steps === null ? null : (
        <Keycaps steps={formatKeycaps(steps, platform)} />
      )}
    </>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  groups,
  platform,
  onRun,
  onShowShortcuts,
  pageExample,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly PaletteGroup[];
  platform: Platform;
  /** Runs the row a person picks. The container closes the palette first. */
  onRun: (entry: ResolvedCommand) => void;
  /** Opens the shortcut sheet, for `?` typed into an empty search. */
  onShowShortcuts: () => void;
  /** A page name the empty state suggests, such as "users". */
  pageExample?: string;
}): React.ReactElement {
  const [query, setQuery] = useState("");

  const all = filterPalette(groups, "");
  const filtered = filterPalette(groups, query);

  const changeOpen = (next: boolean): void => {
    if (!next) {
      setQuery("");
    }
    onOpenChange(next);
  };

  const changeQuery = (value: string): void => {
    // `?` on an empty search opens the sheet, as the footer and the empty state say.
    if (query === "" && value === "?") {
      setQuery("");
      onShowShortcuts();
      return;
    }
    setQuery(value);
  };

  const run = (entry: ResolvedCommand): void => {
    setQuery("");
    onRun(entry);
  };

  return (
    <CommandDialog open={open} onOpenChange={changeOpen}>
      <CommandDialogPopup
        aria-label="Command palette"
        className={POPUP_PLACEMENT}
        // The engine's dialog guard skips a popup that carries OVERLAY_ATTRIBUTE.
        data-command-overlay=""
      >
        <Command
          items={all}
          filteredItems={filtered}
          value={query}
          onValueChange={changeQuery}
        >
          <div className="border-border flex h-12 shrink-0 items-center border-b pe-3.5 *:first:flex-1 *:first:px-1.5 *:first:py-0">
            <CommandInput
              aria-label="Search commands"
              placeholder="Type a command or search…"
            />
            <Kbd className="max-sm:hidden">Esc</Kbd>
          </div>
          <CommandEmpty className="not-empty:px-4 not-empty:pt-9 not-empty:pb-10">
            <span className="text-foreground mb-1 block font-medium">
              No commands match “{query}”
            </span>
            {pageExample === undefined ? null : (
              <>Try a page name, such as “{pageExample}”, or press </>
            )}
            {pageExample === undefined ? <>Press </> : null}
            <Kbd>?</Kbd> for every shortcut.
          </CommandEmpty>
          <CommandList className="not-empty:p-1.5">
            {(group: FilteredGroup) => (
              <CommandGroup key={group.key} items={group.items}>
                <CommandGroupLabel className="px-2 pt-2 pb-1">
                  {group.label}
                </CommandGroupLabel>
                <CommandCollection>
                  {(row: FilteredRow) => (
                    <CommandItem
                      key={row.entry.command.id}
                      value={row}
                      onClick={() => {
                        run(row.entry);
                      }}
                      className="data-highlighted:[&>svg]:text-foreground [&>svg]:text-muted-foreground h-8.5 gap-2.5 py-0 sm:min-h-8.5 [&>svg]:size-4 [&>svg]:shrink-0"
                    >
                      <Row row={row} platform={platform} />
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            )}
          </CommandList>
          <CommandFooter className="h-10 shrink-0 justify-start gap-4 px-3.5 py-0">
            <span className="flex items-center gap-1.5">
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              Move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              Run
            </span>
            <span className="flex items-center gap-1.5 max-sm:hidden">
              <Kbd>Esc</Kbd>
              Close
            </span>
            <span className="flex-1" />
            <span className="flex items-center gap-1.5 max-sm:hidden">
              <Kbd>?</Kbd>
              All shortcuts
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
