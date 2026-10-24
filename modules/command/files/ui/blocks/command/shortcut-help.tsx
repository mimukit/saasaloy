import type * as React from "react";

import {
  Dialog,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/shell/dialog";
import { Keycaps } from "@repo/ui/blocks/command/keycaps";
import { formatKeycaps } from "@repo/ui/lib/command/engine";
import type { Platform, ShortcutSection } from "@repo/ui/lib/command/registry";

// The `?` sheet: every live binding, in sections. It is presentational; the container
// hands it the sections the registry built.
//
// From 640 px up it has two columns: the Data table section on the right while a table
// is mounted, every other section on the left. Below 640 px it is one column. A sequence
// reads `G then U`.

/**
 * Inside this popup a keycap takes the 1px `input` hairline and no fill, as it does in the
 * palette: the shell `Kbd` fill is `muted`, which equals `popover` on admin dark.
 */
const POPUP_CLASSES =
  "max-w-160 max-sm:w-[calc(100%+--spacing(4))] max-sm:max-w-none **:data-[slot=kbd]:bg-transparent **:data-[slot=kbd]:inset-ring **:data-[slot=kbd]:inset-ring-input";

function Section({
  section,
  platform,
}: {
  section: ShortcutSection;
  platform: Platform;
}): React.ReactElement {
  return (
    <section>
      <h3 className="text-muted-foreground mt-3.5 mb-1 text-xs font-medium">
        {section.label}
      </h3>
      <ul>
        {section.items.map((entry) => (
          <li
            key={entry.command.id}
            className="border-border flex h-8 items-center justify-between gap-4 border-b text-sm last:border-b-0"
          >
            <span className="min-w-0 truncate">{entry.command.title}</span>
            <Keycaps steps={formatKeycaps(entry.steps, platform)} then />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ShortcutHelp({
  open,
  onOpenChange,
  sections,
  platform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: readonly ShortcutSection[];
  platform: Platform;
}): React.ReactElement {
  const right = sections.filter((section) => section.key === "data-table");
  const left = sections.filter((section) => section.key !== "data-table");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        bottomStickOnMobile={false}
        className={POPUP_CLASSES}
        // The engine's dialog guard skips a popup that carries this attribute.
        data-command-overlay=""
      >
        <div className="border-border flex h-13 shrink-0 items-center border-b ps-5 pe-12">
          <DialogTitle className="text-base leading-6 font-semibold">
            Keyboard shortcuts
          </DialogTitle>
        </div>
        <DialogPanel className="grid gap-x-8 px-5 pt-2 pb-5 sm:grid-cols-2">
          <div>
            {left.map((section) => (
              <Section
                key={section.key}
                section={section}
                platform={platform}
              />
            ))}
          </div>
          <div>
            {right.map((section) => (
              <Section
                key={section.key}
                section={section}
                platform={platform}
              />
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
