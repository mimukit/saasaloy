import { CheckIcon, CopyIcon, SparkleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ui } from "@web/content/landing";
import { agentPrompt } from "@web/content/prompts";
import { interpolate } from "@web/lib/interpolate";
import { cn } from "@web/lib/utils";

// The compact copy control beside a module's `saasaloy add` command in the stages and the
// catalog: two small outlined buttons, "Prompt" and "CLI". Mockup round 1 of plan 0125,
// option B, approved 2026-11-25.
//
// Static HTML, no island. The group ships with `hidden`, so a reader without JavaScript
// sees the command and no dead control; the inline script in ../pages/index.astro shows
// it and copies each button's `data-copy-text`. The rest and copied labels share one
// grid cell, so the button keeps its width when it flips.

export interface CompactCopyProps {
  /** The module the prompt adds and the button names. */
  name: string;
  /** The command the CLI button copies. */
  command: string;
  className?: string;
}

function CopyButton({
  text,
  kind,
  label,
  icon,
  children,
}: {
  text: string;
  kind: "prompt" | "cli";
  label: string;
  icon: ReactNode;
  children: string;
}) {
  return (
    <button
      type="button"
      data-copy-text={text}
      data-copy-kind={kind}
      aria-label={label}
      className="group border-border bg-card text-highlight hover:bg-muted data-copied:border-primary data-copied:bg-primary data-copied:text-primary-foreground focus-visible:outline-ring motion-safe:ease-out-soft inline-grid h-7 shrink-0 cursor-pointer items-center border px-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-safe:duration-150"
    >
      <span
        aria-hidden="true"
        className="inline-flex items-center gap-1.5 [grid-area:1/1] group-data-copied:invisible"
      >
        {icon}
        {children}
      </span>
      <span
        aria-hidden="true"
        className="invisible inline-flex items-center gap-1.5 [grid-area:1/1] group-data-copied:visible"
      >
        <CheckIcon className="size-3.5" />
        {ui.commandField.copied}
      </span>
    </button>
  );
}

export function CompactCopy({ name, command, className }: CompactCopyProps) {
  return (
    <span
      hidden
      data-copy-controls=""
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <CopyButton
        text={agentPrompt("add", { name })}
        kind="prompt"
        label={interpolate(ui.commandField.compactPromptLabel, { name })}
        icon={<SparkleIcon className="size-3.5" />}
      >
        {ui.commandField.compactPrompt}
      </CopyButton>
      <CopyButton
        text={command}
        kind="cli"
        label={interpolate(ui.commandField.compactCliLabel, { name })}
        icon={<CopyIcon className="size-3.5" />}
      >
        {ui.commandField.compactCli}
      </CopyButton>
    </span>
  );
}
