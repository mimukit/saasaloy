import { useRef, useState } from "react";
import type React from "react";

import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@repo/ui/components/shell/tooltip";
import { cn } from "@repo/ui/lib/utils";

// One line of text that truncates with an ellipsis, and shows the whole text in a tooltip
// on hover, but only while the ellipsis is showing. Text that fits opens nothing.
// Wrap it in a heading or a cell for the meaning; it renders a `<span>`.

export function OverflowTooltip({
  children,
  content,
  className,
  side = "bottom",
  align = "start",
}: {
  children: React.ReactNode;
  /** The tooltip's text, when it differs from the children. */
  content?: React.ReactNode;
  className?: string;
  side?: React.ComponentProps<typeof TooltipPopup>["side"];
  align?: React.ComponentProps<typeof TooltipPopup>["align"];
}): React.ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const element = ref.current;
        setOpen(
          next && element !== null && element.scrollWidth > element.clientWidth
        );
      }}
    >
      <TooltipTrigger
        ref={(node) => {
          ref.current = node;
        }}
        render={<span />}
        className={cn("block truncate", className)}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side={side} align={align} className="max-w-sm">
        {content ?? children}
      </TooltipPopup>
    </Tooltip>
  );
}
