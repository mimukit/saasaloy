import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { ui } from "@web/content/landing";
import { interpolate } from "@web/lib/interpolate";
import { cn } from "@web/lib/utils";

// The page's primary call to action: a bordered mono field holding one command, with a
// solid Copy button flush against its right edge (the `command-field` component in
// apps/web/DESIGN.md). Both share the 2.5rem height and square corners. `size="lg"` is
// the hero's field: 3rem tall, wider, with a larger command (`command-field-lg` in
// DESIGN.md).
//
// THE ONE ISLAND THIS FILE ADDS. index.astro renders it with `client:visible`, so the
// copy handler hydrates only once the field scrolls into view and never competes with
// the first paint. Rendered without a directive (a block's default) it is plain HTML:
// the command stays selectable text, and the button does nothing.
//
// The copied state swaps the icon and the label in place. The button keeps a minimum
// width that fits either label, so the field never moves. A polite live region
// announces the copy, and the button returns to rest after COPIED_MS.
//
// With `agentPrompt` the field gains two tabs, "Agent prompt" first and "CLI", over one
// Copy button whose label follows the tab. Both panels share one grid cell and the
// hidden one keeps its box, so switching tabs never changes the field's height. Below
// `sm` the button drops under the text as a full-width bar, because the prompt needs the
// width. Mockup round 1 of plan 0125, approved 2026-11-25.

const COPIED_MS = 2000;

// Each icon mounts fresh when the state flips, so it settles in from a little smaller.
const ICON_SWAP =
  "size-4 motion-safe:transition-[opacity,scale] motion-safe:duration-150 motion-safe:ease-out-soft motion-safe:starting:scale-75 motion-safe:starting:opacity-0";

type Tab = "agent" | "cli";

const TABS: Tab[] = ["agent", "cli"];

const TAB_LABELS: Record<Tab, string> = {
  agent: ui.commandField.agentTab,
  cli: ui.commandField.cliTab,
};

export interface CommandFieldProps {
  command: string;
  /** The glyph before the command. Decorative. */
  prompt?: string;
  /** A prompt for an AI agent. With one, the field opens on an "Agent prompt" tab. */
  agentPrompt?: string;
  /** `lg` is the hero's taller field. */
  size?: "md" | "lg";
  className?: string;
}

export function CommandField({
  command,
  prompt = ">",
  agentPrompt,
  size = "md",
  className,
}: CommandFieldProps) {
  const large = size === "lg";
  const [tab, setTab] = useState<Tab>(
    agentPrompt === undefined ? "cli" : "agent"
  );
  // The tab whose text is on the clipboard, so the announcement names what was copied.
  const [copied, setCopied] = useState<Tab | null>(null);
  const commandRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  function selectCommand() {
    const node = (tab === "agent" ? promptRef : commandRef).current;
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
    const copying = tab;
    try {
      await navigator.clipboard.writeText(
        copying === "agent" && agentPrompt !== undefined ? agentPrompt : command
      );
    } catch {
      // No clipboard access (an insecure origin, a denied permission): select the
      // command so the visitor can copy it by hand, and show no copied state.
      selectCommand();
      return;
    }
    setCopied(copying);
    // A second press restarts the delay. No unmount cleanup: an island lives as long as
    // the page, and a late setState on an unmounted component is a no-op in React 19.
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  }

  // A copied label left over from the other tab would name the wrong text.
  function select(next: Tab) {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    setCopied(null);
    setTab(next);
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.indexOf(tab);
    const targets: Record<string, Tab | undefined> = {
      ArrowLeft: TABS[(index + TABS.length - 1) % TABS.length],
      ArrowRight: TABS[(index + 1) % TABS.length],
      Home: TABS[0],
      End: TABS.at(-1),
    };
    const next = targets[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  }

  if (agentPrompt !== undefined) {
    const panels: Record<Tab, { text: string; ref: typeof commandRef }> = {
      agent: { text: agentPrompt, ref: promptRef },
      cli: { text: command, ref: commandRef },
    };
    let buttonLabel: string = ui.commandField.copied;
    if (copied === null) {
      buttonLabel =
        tab === "agent" ? ui.commandField.copyPrompt : ui.commandField.copy;
    }

    return (
      <div
        className={cn(
          "border-border bg-card flex w-full flex-col border",
          large ? "max-w-2xl" : "max-w-xl",
          className
        )}
      >
        <div
          role="tablist"
          aria-label={ui.commandField.tabsLabel}
          className="border-border flex border-b"
        >
          {TABS.map((name) => (
            <button
              key={name}
              ref={(node) => {
                tabRefs.current[name] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-${name}-tab`}
              aria-selected={tab === name}
              aria-controls={`${id}-${name}-panel`}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => select(name)}
              onKeyDown={onTabKey}
              className={cn(
                "border-border focus-visible:outline-ring motion-safe:ease-out-soft -mt-px -ml-px cursor-pointer border-r px-4 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 motion-safe:transition-colors motion-safe:duration-150",
                tab === name
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-highlight hover:text-foreground"
              )}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row">
          <div className="grid min-w-0 flex-1 grid-cols-1">
            {TABS.map((name) => (
              <p
                key={name}
                role="tabpanel"
                id={`${id}-${name}-panel`}
                aria-labelledby={`${id}-${name}-tab`}
                tabIndex={tab === name ? 0 : -1}
                className={cn(
                  "focus-visible:outline-ring flex min-w-0 gap-2 px-3 py-3 font-mono text-[0.8125rem] [grid-area:1/1] focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-4 sm:text-sm",
                  large ? "min-h-12 sm:gap-3" : "min-h-10",
                  name === "agent"
                    ? "items-start wrap-break-word"
                    : "items-center overflow-x-auto whitespace-nowrap",
                  tab !== name && "invisible"
                )}
              >
                <span aria-hidden="true" className="text-highlight select-none">
                  {prompt}
                </span>
                <code
                  ref={panels[name].ref}
                  className="text-foreground min-w-0"
                >
                  {panels[name].text}
                </code>
              </p>
            ))}
          </div>
          <button
            type="button"
            onClick={copy}
            aria-label={
              tab === "agent"
                ? ui.commandField.copyPromptLabel
                : interpolate(ui.commandField.copyLabel, { command })
            }
            className="bg-primary text-primary-foreground focus-visible:outline-ring press -mx-px -mb-px inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 px-4 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 sm:ml-0 sm:h-auto sm:min-w-36"
          >
            {copied === null ? (
              <CopyIcon aria-hidden="true" className={ICON_SWAP} />
            ) : (
              <CheckIcon aria-hidden="true" className={ICON_SWAP} />
            )}
            <span aria-hidden="true">{buttonLabel}</span>
          </button>
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {copied === "agent"
            ? ui.commandField.promptCopiedAnnouncement
            : copied === "cli"
              ? ui.commandField.copiedAnnouncement
              : ""}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-border bg-card flex w-full items-stretch border",
        large ? "h-12 max-w-lg" : "h-10 max-w-md",
        className
      )}
    >
      <p
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto font-mono whitespace-nowrap",
          large
            ? "px-3 text-[0.8125rem] sm:gap-3 sm:px-4 sm:text-base"
            : "px-3 text-[0.8125rem] sm:text-sm"
        )}
      >
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
        className={cn(
          "bg-primary text-primary-foreground focus-visible:outline-ring press -my-px -mr-px inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2",
          large
            ? "min-w-24 px-3 text-sm sm:min-w-28 sm:px-4"
            : "min-w-24 px-3 text-sm"
        )}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" className={ICON_SWAP} />
        ) : (
          <CopyIcon aria-hidden="true" className={ICON_SWAP} />
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
