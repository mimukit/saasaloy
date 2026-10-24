import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// The pill the reference renders in a table's Status column ("Open" on a
// muted blue fill). Also the right shape for a single-value state anywhere else on a
// page — the overview's health result, a role, an invoice state, a key that is on or off.
// A value that is not a state (a plan name, a flag type, a count) is a tag, and a tag
// stays a Badge.
//
// Five tones. `open` is the muted blue keyed to --status-open, the token the admin
// stylesheet measured off the screenshots; `neutral` is the panel's own hover tone. `ok`,
// `warn` and `bad` are a settled state, one waiting on someone, and a failure. They tint
// their fill the way Badge does (8 % on light, 16 % on dark) and set the text in the
// pair's foreground.
//
// Every tone but `neutral` reads a `status-*` pair of its own, never a shadcn role. A
// theme preset rewrites the shadcn roles, and it sets the red pair with another meaning,
// but no preset sets a `status-*` key, so a status keeps its colour under any preset.
// `neutral` reads `muted` and follows the preset on purpose. Orange is absent:
// --accent-sort belongs to the active sort indicator and to an AI surface.
//
// Mapping a domain value onto a tone is the caller's job, not this component's. A role,
// a health check and an invoice state all reach "which tone is this" by different rules,
// so the rule stays in the route that knows it.

export type StatusTone = "neutral" | "open" | "ok" | "warn" | "bad";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  open: "bg-status-open text-status-open-foreground",
  ok: "bg-status-ok/8 text-status-ok-foreground dark:bg-status-ok/16",
  warn: "bg-status-warn/8 text-status-warn-foreground dark:bg-status-warn/16",
  bad: "bg-status-bad/8 text-status-bad-foreground dark:bg-status-bad/16",
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
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap",
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
