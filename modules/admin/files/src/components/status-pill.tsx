import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// The rounded-full pill the reference renders in a table's Status column ("Open" on a
// muted blue fill). Also the right shape for a single-value state anywhere else on a
// page — the overview's health result, a role, a plan tier.
//
// Two tones and no more. `open` is the muted blue keyed to --status-open, the token the
// admin stylesheet measured off the screenshots; `neutral` is the panel's own hover tone.
// Orange is deliberately absent: --accent-sort belongs to the active sort indicator and
// to an AI surface, and a pill that could be orange would put a third meaning on it.
//
// Mapping a domain value onto a tone is the caller's job, not this component's. A role,
// a health check and an invoice state all reach "which of these is the live one" by
// different rules, so the rule stays in the route that knows it.

export type StatusTone = "neutral" | "open";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  open: "bg-status-open text-status-open-foreground",
};

export function StatusPill({
  label,
  tone = "neutral",
  icon,
  className,
}: {
  label: string;
  tone?: StatusTone;
  /** An optional leading glyph, sized by this component rather than by the caller. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        "[&>svg]:size-3 [&>svg]:shrink-0",
        TONE_CLASS[tone],
        className
      )}
    >
      {icon}
      {label}
    </span>
  );
}
