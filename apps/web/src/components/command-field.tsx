import { useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { ui } from "@web/content/landing";
import { interpolate } from "@web/lib/interpolate";
import { cn } from "@web/lib/utils";

// The page's primary call to action: a bordered mono field holding one command, with a
// solid Copy button flush against its right edge (the `command-field` component in
// apps/web/DESIGN.md). Both share the 2.5rem height and square corners.
//
// THE ONE ISLAND THIS FILE ADDS. index.astro renders it with `client:visible`, so the
// copy handler hydrates only once the field scrolls into view and never competes with
// the first paint. Rendered without a directive (a block's default) it is plain HTML:
// the command stays selectable text, and the button does nothing.
//
// The copied state swaps the icon and the label in place. The button keeps a minimum
// width that fits either label, so the field never moves. A polite live region
// announces the copy, and the button returns to rest after COPIED_MS.

const COPIED_MS = 2000;

export interface CommandFieldProps {
  command: string;
  /** The glyph before the command. Decorative. */
  prompt?: string;
  className?: string;
}

export function CommandField({
  command,
  prompt = ">",
  className,
}: CommandFieldProps) {
  const [copied, setCopied] = useState(false);
  const commandRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function selectCommand() {
    const node = commandRef.current;
    const selection = globalThis.getSelection();
    if (!node || !selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // No clipboard access (an insecure origin, a denied permission): select the
      // command so the visitor can copy it by hand, and show no copied state.
      selectCommand();
      return;
    }
    setCopied(true);
    // A second press restarts the delay. No unmount cleanup: an island lives as long as
    // the page, and a late setState on an unmounted component is a no-op in React 19.
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div
      className={cn(
        "border-border bg-card flex h-10 w-full max-w-md items-stretch border",
        className
      )}
    >
      <p className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3 font-mono text-[0.8125rem] whitespace-nowrap sm:text-sm">
        <span aria-hidden="true" className="text-highlight select-none">
          {prompt}
        </span>
        <code ref={commandRef} className="text-foreground">
          {command}
        </code>
      </p>
      <button
        type="button"
        onClick={copy}
        aria-label={interpolate(ui.commandField.copyLabel, { command })}
        className="bg-primary text-primary-foreground focus-visible:outline-ring -my-px -mr-px inline-flex min-w-24 shrink-0 cursor-pointer items-center justify-center gap-2 px-3 text-sm font-medium underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {copied ? (
          <CheckIcon aria-hidden="true" className="size-4" />
        ) : (
          <CopyIcon aria-hidden="true" className="size-4" />
        )}
        <span aria-hidden="true">
          {copied ? ui.commandField.copied : ui.commandField.copy}
        </span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? ui.commandField.copiedAnnouncement : ""}
      </span>
    </div>
  );
}
