import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { ui } from "@web/content/landing";
import type { CommandData } from "@web/lib/docs-blocks-data";
import { interpolate } from "@web/lib/interpolate";
import { cn } from "@web/lib/utils";

// The `saasaloy-command` block's island (plan 0125 Phase 4): the landing page's tabbed
// command field (components/command-field.tsx) in the docs, with the same tabs, labels and
// copied state. The Copy button sits at the right end of the tab strip, because the CLI
// tab holds several lines and a button beside them would stretch to their height. Mockup
// round 1 of plan 0125, approved 2026-11-25. Without JavaScript the plugin's paragraph and
// code block say the same (lib/docs-blocks.ts).

const COPIED_MS = 2000;

const ICON_SWAP =
  "size-4 motion-safe:transition-[opacity,scale] motion-safe:duration-150 motion-safe:ease-out-soft motion-safe:starting:scale-75 motion-safe:starting:opacity-0";

type Tab = "agent" | "cli";

const TABS: Tab[] = ["agent", "cli"];

const TAB_LABELS: Record<Tab, string> = {
  agent: ui.commandField.agentTab,
  cli: ui.commandField.cliTab,
};

export function DocsCommand({ data }: { data: CommandData }) {
  const [tab, setTab] = useState<Tab>("agent");
  const [copied, setCopied] = useState<Tab | null>(null);
  const panelRefs = useRef<Partial<Record<Tab, HTMLElement | null>>>({});
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const script = data.commands.join("\n");

  function selectText() {
    const node = panelRefs.current[tab];
    const selection = globalThis.getSelection();
    if (!node || !selection) {
      return;
    }
    selection.selectAllChildren(node);
  }

  async function copy() {
    const copying = tab;
    try {
      await navigator.clipboard.writeText(
        copying === "agent" ? data.prompt : script
      );
    } catch {
      // No clipboard access: select the text so the reader can copy it by hand.
      selectText();
      return;
    }
    setCopied(copying);
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

  let buttonLabel: string = ui.commandField.copied;
  if (copied === null) {
    buttonLabel =
      tab === "agent" ? ui.commandField.copyPrompt : ui.commandField.copy;
  }

  return (
    <div className="border-border bg-card flex w-full flex-col border">
      <div className="border-border flex border-b">
        <div
          role="tablist"
          aria-label={ui.commandField.tabsLabel}
          className="flex min-w-0 flex-1"
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
                // The inactive tab keeps a transparent underline, so a switch never moves the strip.
                "focus-visible:outline-ring motion-safe:ease-out-soft -mb-px cursor-pointer border-b-2 px-4 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 motion-safe:transition-colors motion-safe:duration-150",
                tab === name
                  ? "border-primary text-highlight"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={
            tab === "agent"
              ? ui.commandField.copyPromptLabel
              : interpolate(ui.commandField.copyLabel, { command: script })
          }
          data-pagefind-ignore=""
          className="bg-primary text-primary-foreground focus-visible:outline-ring press -mt-px -mr-px inline-flex min-w-36 shrink-0 cursor-pointer items-center justify-center gap-2 px-4 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {copied === null ? (
            <CopyIcon aria-hidden="true" className={ICON_SWAP} />
          ) : (
            <CheckIcon aria-hidden="true" className={ICON_SWAP} />
          )}
          <span aria-hidden="true">{buttonLabel}</span>
        </button>
      </div>
      <div className="grid grid-cols-1">
        {TABS.map((name) => (
          <div
            key={name}
            role="tabpanel"
            id={`${id}-${name}-panel`}
            aria-labelledby={`${id}-${name}-tab`}
            tabIndex={tab === name ? 0 : -1}
            className={cn(
              "focus-visible:outline-ring flex min-w-0 flex-col px-3 py-3 font-mono text-[0.8125rem] [grid-area:1/1] focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-4 sm:text-sm",
              name === "cli" && "overflow-x-auto",
              tab !== name && "invisible"
            )}
          >
            {name === "agent" ? (
              <span className="flex min-w-0 items-start gap-2">
                <span aria-hidden="true" className="text-highlight select-none">
                  &gt;
                </span>
                <span
                  ref={(node) => {
                    panelRefs.current.agent = node;
                  }}
                  className="text-foreground min-w-0 wrap-break-word"
                >
                  {data.prompt}
                </span>
              </span>
            ) : (
              <span
                ref={(node) => {
                  panelRefs.current.cli = node;
                }}
                className="flex flex-col"
              >
                {data.commands.map((command, index) => (
                  // oxlint-disable-next-line react/no-array-index-key -- a body may repeat a command
                  <span key={index} className="flex gap-2 whitespace-pre">
                    <span
                      aria-hidden="true"
                      className="text-highlight select-none"
                    >
                      $
                    </span>
                    <span className="text-foreground">{command}</span>
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
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
